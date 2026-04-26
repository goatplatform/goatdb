// Binary commit format codec for GoatDB.
// Little-endian for all fields within a binary commit record.
// This file is bundled into the worker - ALL characters must be ASCII.
//
// DESIGN INTENT: Zero-copy as close as possible.
//   - All allocations on hot paths MUST be avoided -- no intermediate
//     temporary objects, no typed-array view allocations, no string
//     concatenation buffers.
//   - Manual UTF-8 codec (_writeStrBody / decodeStr) avoids hidden
//     allocations for short strings. Strings longer than 512 bytes fall
//     back to TextDecoder (O(n^2) concat is worse at that scale).
//   - No buf.subarray() on decode hot paths; binaryContentsRange() returns
//     offsets so callers index bytes[] directly without a view allocation.
//   - Encode uses a pooled BinaryCommitWriter with pre-allocated buffers
//     to avoid per-call allocation.
//   - buf.slice() on encode output is the only copy -- required because
//     callers cache bytes long-term.

import { assert } from '../../error.ts';
import type { Commit } from '../../../repo/commit.ts';

// Used only by decodeStr as a fallback for long strings (>512 bytes).
const _gTextDecoder = new TextDecoder();

export const BINARY_MAGIC = 0x47;
const BINARY_VERSION = 0x01;
// magic(1) + version(1) + flags(2) + timestamp(8) + age(4) + reserved(4) + buildVersion(4) + offsets(6x2) = 36
export const HEADER_SIZE = 36;
// Header layout (36 bytes, little-endian):
//   [0]      u8   magic (0x47 'G')
//   [1]      u8   version
//   [2..3]   u16  flags
//   [4..11]  f64  timestamp
//   [12..15] i32  age (-1 = unset)
//   [16..19] u32  reserved
//   [20..23] u32  buildVersion
//   [24..25] u16  keyOffset
//   [26..27] u16  sessionOffset
//   [28..29] u16  orgIdOffset
//   [30..31] u16  schemaIdOffset
//   [32..33] u16  afterFixedOffset
//   [34..35] u16  contentsOffset

// Flag bits
const FLAG_SIGNATURE = 1 << 0;
const FLAG_MERGE_BASE = 1 << 1;
const FLAG_MERGE_LEADER = 1 << 2;
const FLAG_REVERT = 1 << 3;
const FLAG_CONNECTION_ID = 1 << 4;
// Delta base commit ID, stored as a u16-len-prefixed conditional string.
// Replaces the fragile JSON byte-pattern scan used in earlier versions.
const FLAG_DELTA_BASE = 1 << 5;
const FLAG_PARENTS = 1 << 6;
const FLAG_IS_DOCUMENT = 1 << 7;

// Shared typed-array alias for float64 read/write without DataView allocation.
// NOTE: relies on the host CPU being little-endian (x86/ARM). On a big-endian
// platform (e.g. IBM POWER) the bytes would be reversed and values would be
// wrong. No GoatDB deployment targets BE hardware; acceptable known limitation.
const _f64 = new Float64Array(1);
const _f64u8 = new Uint8Array(_f64.buffer);
// Fail fast on big-endian hardware rather than silently producing wrong data.
// Write 1.0 in LE via DataView; if the CPU is LE, _f64[0] will also be 1.0.
new DataView(_f64.buffer).setFloat64(0, 1.0, true);
if (_f64[0] !== 1.0) {
  throw new Error('GoatDB binary format requires little-endian CPU');
}

export function readFloat64LE(buf: Uint8Array, offset: number): number {
  for (let i = 0; i < 8; i++) _f64u8[i] = buf[offset + i];
  return _f64[0];
}

export function writeFloat64LE(
  buf: Uint8Array,
  offset: number,
  val: number,
): void {
  _f64[0] = val;
  for (let i = 0; i < 8; i++) buf[offset + i] = _f64u8[i];
}

// Read i32-LE preserving sign bit (no >>> 0)
export function readI32LE(buf: Uint8Array, offset: number): number {
  return (
    buf[offset] |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    (buf[offset + 3] << 24)
  );
}

// Write a u16-LE at position in buf
export function writeU16(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
}

// Write a u32-LE at position in buf
export function writeU32(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
  buf[offset + 2] = (val >> 16) & 0xff;
  buf[offset + 3] = (val >>> 24) & 0xff;
}

// ============================================================================
// BinaryCommitWriter - growable buffer with back-patching for single-pass writes
// ============================================================================

class BinaryCommitWriter {
  _buf: Uint8Array;
  _pos: number;

  constructor(initialCapacity: number) {
    this._buf = new Uint8Array(initialCapacity);
    this._pos = 0;
  }

  reset(): void {
    this._pos = 0;
  }

  _ensureCapacity(needed: number): void {
    const required = this._pos + needed;
    if (required <= this._buf.length) return;
    let newCap = this._buf.length * 2;
    while (newCap < required) newCap *= 2;
    const newBuf = new Uint8Array(newCap);
    newBuf.set(this._buf);
    this._buf = newBuf;
  }

  // Write UTF-8 bytes for s starting at current _pos. Returns byte count written.
  // No subarray allocation; ASCII fast path, manual UTF-8 fallback.
  private _writeStrBody(s: string): number {
    this._ensureCapacity(s.length);
    const start = this._pos;
    let i = 0;
    for (; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 127) break;
      this._buf[this._pos++] = c;
    }
    if (i < s.length) {
      this._ensureCapacity((s.length - i) * 4);
      for (; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) {
          this._buf[this._pos++] = c;
        } else if (c < 0x800) {
          this._buf[this._pos++] = 0xC0 | (c >> 6);
          this._buf[this._pos++] = 0x80 | (c & 0x3F);
        } else if (c >= 0xD800 && c <= 0xDBFF) {
          // Surrogate pair: decode to codepoint, emit 4-byte sequence
          const lo = s.charCodeAt(++i);
          if (Number.isNaN(lo) || lo < 0xDC00 || lo > 0xDFFF) {
            // Lone high surrogate -- emit U+FFFD replacement
            this._buf[this._pos++] = 0xEF;
            this._buf[this._pos++] = 0xBF;
            this._buf[this._pos++] = 0xBD;
            --i; // re-process `lo` in next iteration
            continue;
          }
          const cp = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
          this._buf[this._pos++] = 0xF0 | (cp >> 18);
          this._buf[this._pos++] = 0x80 | ((cp >> 12) & 0x3F);
          this._buf[this._pos++] = 0x80 | ((cp >> 6) & 0x3F);
          this._buf[this._pos++] = 0x80 | (cp & 0x3F);
        } else if (c >= 0xDC00 && c <= 0xDFFF) {
          // Lone low surrogate -- emit U+FFFD replacement
          this._buf[this._pos++] = 0xEF;
          this._buf[this._pos++] = 0xBF;
          this._buf[this._pos++] = 0xBD;
        } else {
          this._buf[this._pos++] = 0xE0 | (c >> 12);
          this._buf[this._pos++] = 0x80 | ((c >> 6) & 0x3F);
          this._buf[this._pos++] = 0x80 | (c & 0x3F);
        }
      }
    }
    return this._pos - start;
  }

  // Write a u16-LE length-prefixed string. Advances _pos.
  writeLenPrefixedStr(s: string): void {
    const lenOffset = this._pos;
    this._ensureCapacity(2);
    this._pos += 2;
    const byteLen = this._writeStrBody(s);
    assert(byteLen <= 65535, 'String too long for u16 length prefix');
    writeU16(this._buf, lenOffset, byteLen);
  }

  // Write a 1-byte length-prefixed string (for parent/ancestor IDs, max 255 bytes).
  writeByteLenPrefixedStr(s: string): void {
    const lenOffset = this._pos;
    this._ensureCapacity(1);
    this._pos += 1;
    const byteLen = this._writeStrBody(s);
    assert(
      byteLen <= 255,
      'Parent/ancestor ID too long for byte-length prefix',
    );
    this._buf[lenOffset] = byteLen;
  }
}

// Pooled writers avoid per-call allocation. Max 4 retained; oversized
// writers (>64KB) are discarded. Unlike ScratchPool (stack-based,
// reentrant), this pool needs a size cap and oversized-entry discard.
const POOL_MAX = 4;
const COMMIT_WRITER_POOL: BinaryCommitWriter[] = [];

// Read u16-LE from buf at offset
export function readU16(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

// Read u32-LE from buf at offset
export function readU32(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  );
}

// Decode UTF-8 bytes to string.
// Two-tier strategy:
// 1. ASCII fast path (IDs, keys, sessions are all ASCII): scan for any byte
//    >= 0x80; if pure ASCII, call String.fromCharCode.apply on a subarray
//    view. One subarray view allocation replaces N per-char string
//    concatenation allocations -- net reduction in GC pressure.
// 2. Non-ASCII / long-string fallback: delegate to TextDecoder (same as the
//    existing >512 path). Eliminates the manual multi-byte UTF-8 decode loop.
// All three paths use buf.subarray() -- a view, not a copy. These are the
// justified exceptions to the zero-copy rule: one view replaces N allocations.
export function decodeStr(
  buf: Uint8Array,
  offset: number,
  len: number,
): string {
  if (len === 0) return '';
  if (len > 512) {
    // Long string: one subarray view; avoids O(n) manual decode for large fields
    return _gTextDecoder.decode(buf.subarray(offset, offset + len));
  }
  const end = offset + len;
  // Check for non-ASCII bytes
  let isAscii = true;
  for (let i = offset; i < end; i++) {
    if (buf[i] >= 0x80) {
      isAscii = false;
      break;
    }
  }
  if (isAscii) {
    // One view (no copy); apply treats TypedArray as array-like.
    // The len <= 512 guard above also keeps us safely under V8/SpiderMonkey
    // Function.prototype.apply argument-count limits (~65536).
    return String.fromCharCode.apply(
      null,
      buf.subarray(offset, end) as unknown as number[],
    );
  }
  // Non-ASCII short string: one subarray view for TextDecoder
  return _gTextDecoder.decode(buf.subarray(offset, end));
}

export function binaryIsDocumentCommit(flags: number): boolean {
  return (flags & FLAG_IS_DOCUMENT) !== 0;
}

export function commitToBinary(
  commit: Commit,
  contentsBytes: Uint8Array,
  isDocument: boolean,
): Uint8Array {
  // Null-schema commits must never be serialized to binary
  const scheme = commit.scheme;
  assert(
    scheme !== undefined && scheme.ns !== null,
    'commitToBinary: commit has null/undefined scheme',
  );
  // Get a pooled writer (or allocate a new one)
  const w = COMMIT_WRITER_POOL.length > 0
    ? COMMIT_WRITER_POOL.pop()!
    : new BinaryCommitWriter(4096);
  try {
    w.reset();

    // Reserve header space (will back-patch offsets after writing fields)
    w._ensureCapacity(HEADER_SIZE);
    w._pos = HEADER_SIZE;

    // -- Write fixed string fields, recording offsets for back-patching --
    // id starts right after header (no offset stored, always at HEADER_SIZE)
    w.writeLenPrefixedStr(commit.id);
    const keyOffset = w._pos;
    w.writeLenPrefixedStr(commit.key);
    const sessionOffset = w._pos;
    w.writeLenPrefixedStr(commit.session);
    const orgIdOffset = w._pos;
    w.writeLenPrefixedStr(commit.orgId);
    const schemaIdOffset = w._pos;
    w.writeLenPrefixedStr(scheme.ns + '/' + scheme.version);
    const afterFixedOffset = w._pos;

    // -- Compute flags --
    const parents = commit.parents;
    const ancestors = commit.ancestors;
    const hasParentsOrAncestors = parents.length > 0 || ancestors.length > 0;
    const sigStr = commit.signature;
    const mbStr = commit.mergeBase;
    const mlStr = commit.mergeLeader;
    const revStr = commit.revert;
    const cidStr = commit.rawConnectionId;
    const deltaBaseStr = isDocument ? undefined : commit.deltaBaseId;

    let flags = 0;
    if (sigStr !== undefined) flags |= FLAG_SIGNATURE;
    if (mbStr !== undefined) flags |= FLAG_MERGE_BASE;
    if (mlStr !== undefined) flags |= FLAG_MERGE_LEADER;
    if (revStr !== undefined) flags |= FLAG_REVERT;
    if (cidStr !== undefined) flags |= FLAG_CONNECTION_ID;
    if (deltaBaseStr !== undefined) flags |= FLAG_DELTA_BASE;
    if (hasParentsOrAncestors) flags |= FLAG_PARENTS;
    if (isDocument) flags |= FLAG_IS_DOCUMENT;

    // -- Parents + Ancestors (combined section) --
    if (hasParentsOrAncestors) {
      assert(parents.length <= 255, 'Parent count exceeds 1-byte limit');
      assert(ancestors.length <= 255, 'Ancestor count exceeds 1-byte limit');
      w._ensureCapacity(2);
      w._buf[w._pos++] = parents.length;
      w._buf[w._pos++] = ancestors.length;
      for (let i = 0; i < parents.length; i++) {
        w.writeByteLenPrefixedStr(parents[i]);
      }
      for (let i = 0; i < ancestors.length; i++) {
        w.writeByteLenPrefixedStr(ancestors[i]);
      }
    }

    // -- Conditional strings in flag bit order --
    if (sigStr !== undefined) w.writeLenPrefixedStr(sigStr);
    if (mbStr !== undefined) w.writeLenPrefixedStr(mbStr);
    if (mlStr !== undefined) w.writeLenPrefixedStr(mlStr);
    if (revStr !== undefined) w.writeLenPrefixedStr(revStr);
    if (cidStr !== undefined) w.writeLenPrefixedStr(cidStr);
    if (deltaBaseStr !== undefined) w.writeLenPrefixedStr(deltaBaseStr);

    // -- Contents (no length prefix, extends to end) --
    const contentsOffset = w._pos;
    assert(
      contentsOffset <= 0xFFFF,
      'Commit header+fields exceed u16 offset limit',
    );
    w._ensureCapacity(contentsBytes.length);
    w._buf.set(contentsBytes, w._pos);
    w._pos += contentsBytes.length;

    // -- Back-patch the 36-byte header --
    const buf = w._buf;
    buf[0] = BINARY_MAGIC;
    buf[1] = BINARY_VERSION;
    writeU16(buf, 2, flags);
    // writeFloat64LE inline
    _f64[0] = commit.timestamp;
    for (let i = 0; i < 8; i++) buf[4 + i] = _f64u8[i];
    // age=-1 means "not assigned" -- round-trips as undefined in BinaryCommit.
    const age = commit.age ?? -1;
    buf[12] = age & 0xff;
    buf[13] = (age >> 8) & 0xff;
    buf[14] = (age >> 16) & 0xff;
    buf[15] = (age >>> 24) & 0xff;
    writeU32(buf, 16, 0); // reserved (was ancestorsCount, available for reuse)
    writeU32(buf, 20, commit.buildVersion as number);
    // Offset table
    writeU16(buf, 24, keyOffset);
    writeU16(buf, 26, sessionOffset);
    writeU16(buf, 28, orgIdOffset);
    writeU16(buf, 30, schemaIdOffset);
    writeU16(buf, 32, afterFixedOffset);
    writeU16(buf, 34, contentsOffset);

    // Slice result (must copy - callers cache the bytes long-term)
    return buf.slice(0, w._pos);
  } finally {
    // Return writer to pool (discard oversized buffers to avoid memory waste)
    if (COMMIT_WRITER_POOL.length < POOL_MAX && w._buf.length <= 65536) {
      COMMIT_WRITER_POOL.push(w);
    }
  }
}

export function binaryCheckVersion(bytes: Uint8Array, base = 0): void {
  assert(
    bytes.length - base >= HEADER_SIZE,
    `binary: buffer too short (${bytes.length - base} < ${HEADER_SIZE})`,
  );
  if (bytes[base] !== BINARY_MAGIC) {
    throw new Error(
      `Invalid binary commit: expected magic 0x${
        BINARY_MAGIC.toString(16)
      }, got 0x${bytes[base].toString(16)}`,
    );
  }
  const version = bytes[base + 1];
  if (version > BINARY_VERSION) {
    throw new Error(
      `Unsupported binary commit version ${version} (max: ${BINARY_VERSION})`,
    );
  }
}

// Caller is responsible for version validation (e.g. BinaryCommit constructor).
// byteLength is the record length (not the full buffer length) when base > 0.
export function binaryExtractId(
  bytes: Uint8Array,
  byteLength?: number,
  base = 0,
): string {
  const len0 = byteLength ?? bytes.length - base;
  if (HEADER_SIZE + 2 > len0) throw new Error('binary: truncated id field');
  const pos = base + HEADER_SIZE;
  const len = readU16(bytes, pos);
  if (HEADER_SIZE + 2 + len > len0) {
    throw new Error('binary: id field exceeds buffer');
  }
  return decodeStr(bytes, pos + 2, len);
}

export function binaryReadHeader(bytes: Uint8Array, base = 0): {
  timestamp: number;
  age: number;
  buildVersion: number;
  flags: number;
  contentsOffset: number;
} {
  assert(
    bytes.length >= base + HEADER_SIZE,
    'binary: buffer too short for header',
  );
  return {
    timestamp: readFloat64LE(bytes, base + 4),
    age: readI32LE(bytes, base + 12),
    buildVersion: readU32(bytes, base + 20),
    flags: readU16(bytes, base + 2),
    contentsOffset: readU16(bytes, base + 34),
  };
}

// Read one of the 5 always-present string fields (0=id, 1=key, 2=session, 3=orgId, 4=schemaId).
// Header-stored offsets are record-relative; add base to get absolute buffer position.
export function binaryReadStringField(
  bytes: Uint8Array,
  fieldIndex: number,
  base = 0,
  recordEnd?: number,
): string {
  const end = recordEnd ?? bytes.length;
  // id is always at HEADER_SIZE; fields 1-4 have record-relative offsets in header
  const pos = fieldIndex === 0
    ? base + HEADER_SIZE
    : base + readU16(bytes, base + 24 + (fieldIndex - 1) * 2);
  if (pos + 2 > end) {
    throw new Error('binary: truncated string field');
  }
  const len = readU16(bytes, pos);
  if (pos + 2 + len > end) {
    throw new Error('binary: string field exceeds record bounds');
  }
  return decodeStr(bytes, pos + 2, len);
}

// Reused for commits with no parents/ancestors to avoid allocation on the hot path.
// Both the inner arrays and the outer object are frozen to catch accidental mutation.
const EMPTY_PARENTS_RESULT: { parents: string[]; ancestors: string[] } = Object
  .freeze({
    parents: Object.freeze([] as string[]) as unknown as string[],
    ancestors: Object.freeze([] as string[]) as unknown as string[],
  }) as unknown as { parents: string[]; ancestors: string[] };

export function binaryReadParentsAndAncestors(
  bytes: Uint8Array,
  flags: number,
  base = 0,
  end?: number,
): { parents: string[]; ancestors: string[] } {
  if (!(flags & FLAG_PARENTS)) return EMPTY_PARENTS_RESULT;
  const recordEnd = end ?? bytes.length;
  let pos = base + readU16(bytes, base + 32); // afterFixedOffset (record-relative) from header
  if (pos + 2 > recordEnd) {
    throw new Error('binary: truncated parents/ancestors header');
  }
  const parentCount = bytes[pos++];
  const ancestorCount = bytes[pos++];
  const parents: string[] = [];
  for (let i = 0; i < parentCount; i++) {
    if (pos >= recordEnd) {
      throw new Error('binary: truncated parent entry');
    }
    const len = bytes[pos++];
    if (pos + len > recordEnd) {
      throw new Error('binary: parent string exceeds record bounds');
    }
    parents.push(decodeStr(bytes, pos, len));
    pos += len;
  }
  const ancestors: string[] = [];
  for (let i = 0; i < ancestorCount; i++) {
    if (pos >= recordEnd) {
      throw new Error('binary: truncated ancestor entry');
    }
    const len = bytes[pos++];
    if (pos + len > recordEnd) {
      throw new Error('binary: ancestor string exceeds record bounds');
    }
    ancestors.push(decodeStr(bytes, pos, len));
    pos += len;
  }
  return { parents, ancestors };
}

// Field order for conditional strings, matching write order in commitToBinary
export const CONDITIONAL_FIELD_ORDER: Array<[string, number]> = [
  ['signature', FLAG_SIGNATURE],
  ['mergeBase', FLAG_MERGE_BASE],
  ['mergeLeader', FLAG_MERGE_LEADER],
  ['revert', FLAG_REVERT],
  ['connectionId', FLAG_CONNECTION_ID],
  ['deltaBase', FLAG_DELTA_BASE],
];

export const COND_MASK = CONDITIONAL_FIELD_ORDER.reduce(
  (m: number, entry: [string, number]) => m | entry[1],
  0,
);

// Returns absolute buffer offset after parents + ancestors section.
export function skipParentsAndAncestors(
  bytes: Uint8Array,
  flags: number,
  base = 0,
  end?: number,
): number {
  let pos = base + readU16(bytes, base + 32); // afterFixedOffset (record-relative) from header
  if (flags & FLAG_PARENTS) {
    const recordEnd = end ?? bytes.length;
    if (pos + 2 > recordEnd) {
      throw new Error('binary: truncated parents/ancestors header');
    }
    const parentCount = bytes[pos++];
    const ancestorCount = bytes[pos++];
    const total = parentCount + ancestorCount;
    for (let i = 0; i < total; i++) {
      if (pos >= recordEnd) {
        throw new Error('binary: truncated parent/ancestor entry');
      }
      const len = bytes[pos++];
      if (pos + len > recordEnd) {
        throw new Error('binary: parent/ancestor string exceeds record bounds');
      }
      pos += len;
    }
  }
  return pos;
}

// Returns [contentsStart, contentsEnd) as absolute offsets into bytes.
export function binaryContentsRange(
  bytes: Uint8Array,
  base: number,
  recordLen?: number,
): [start: number, end: number] {
  const start = base + readU16(bytes, base + 34); // contentsOffset (record-relative) from header
  const end = recordLen !== undefined ? base + recordLen : bytes.length;
  assert(
    start >= base + HEADER_SIZE && start < end,
    'binary: contentsOffset out of bounds',
  );
  return [start, end];
}
