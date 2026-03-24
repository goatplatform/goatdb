// Shard file format: preallocated hash index + append-only commit log.
// Double meta-page header for crash safety. Open-addressing linear probe index.
//
// Layout:
//   [0..127]    Double header (2 x 64 bytes)
//   [128..]     Index region (INDEX_SLOT_SIZE x MAX_SLOTS bytes)
//   [logOffset] Commit log (4B BE len + binary commit payload)
// Note: logOffset is u32, limiting shard files to ~4GB.

import { assert } from '../base/error.ts';
import { crc32 } from '../base/crc32.ts';
import { cyrb64u64, SHARD_HASH_SEED } from '../base/hash.ts';
import {
  readFloat64LE,
  readU16,
  readU32,
  writeFloat64LE,
  writeU16,
  writeU32,
} from '../base/core-types/encoding/binary-commit.ts';

// -- Constants --

export const SHARD_MAGIC = 0x474f4154; // 'GOAT'
export const SHARD_VERSION = 1;
export const SHARD_HEADER_SIZE = 64;
export const SHARD_DOUBLE_HEADER_SIZE = 128;
export const INDEX_SLOT_SIZE = 64;
export const MAX_SLOTS = 150000;
export const MAX_SHARD_COMMITS = 100000;
export const SPLIT_THRESHOLD = 75000;
export const MIN_SHARD_COMMITS = 10000;
export const MAX_KEY_LEN = 39;
export const LOG_DELTA_MAX = 0xffffffff;
export const INDEX_REGION_OFFSET = 128;
export const INDEX_REGION_SIZE = MAX_SLOTS * INDEX_SLOT_SIZE;
export const DEFAULT_LOG_OFFSET = INDEX_REGION_OFFSET + INDEX_REGION_SIZE;

// -- Interfaces --

export interface ShardHeader {
  magic: number;
  version: number;
  flags: number;
  shardIdHigh: number;
  shardIdLow: number;
  rangeStart: number;
  rangeEnd: number;
  lastAge: number;
  generation: number;
  indexUsedCount: number;
  logOffset: number;
  createdAt: number;
  crc32: number;
}

export interface IndexSlot {
  idHashHigh: number;
  idHashLow: number;
  logDelta: number;
  commitLen: number;
  timestamp: number;
  key: string;
}

// -- Private u64 helpers (two u32 LE reads/writes, no BigInt) --

function readU64High(buf: Uint8Array, offset: number): number {
  return readU32(buf, offset + 4);
}

function readU64Low(buf: Uint8Array, offset: number): number {
  return readU32(buf, offset);
}

function writeU64(
  buf: Uint8Array,
  offset: number,
  high: number,
  low: number,
): void {
  writeU32(buf, offset, low);
  writeU32(buf, offset + 4, high);
}

// -- Header functions --

// CRC32 covers bytes 0..55 of a header copy (everything except crc32 + padding)
const HEADER_CRC_LEN = 56;

export function writeShardHeader(
  buf: Uint8Array,
  copyIndex: 0 | 1,
  header: ShardHeader,
): void {
  const base = copyIndex * SHARD_HEADER_SIZE;
  writeU32(buf, base + 0, header.magic);
  writeU16(buf, base + 4, header.version);
  writeU16(buf, base + 6, header.flags);
  writeU64(buf, base + 8, header.shardIdHigh, header.shardIdLow);
  writeFloat64LE(buf, base + 16, header.rangeStart);
  writeFloat64LE(buf, base + 24, header.rangeEnd);
  writeU32(buf, base + 32, header.lastAge);
  writeU32(buf, base + 36, header.generation);
  writeU32(buf, base + 40, header.indexUsedCount);
  writeU32(buf, base + 44, header.logOffset);
  writeFloat64LE(buf, base + 48, header.createdAt);
  // Compute CRC32 over bytes 0..55
  const checksum = crc32(buf, base, HEADER_CRC_LEN);
  writeU32(buf, base + 56, checksum);
  // Zero padding bytes 60..63
  buf[base + 60] = 0;
  buf[base + 61] = 0;
  buf[base + 62] = 0;
  buf[base + 63] = 0;
}

function readOneHeader(buf: Uint8Array, copyIndex: 0 | 1): ShardHeader | null {
  const base = copyIndex * SHARD_HEADER_SIZE;
  if (buf.length < base + SHARD_HEADER_SIZE) return null;
  const storedCrc = readU32(buf, base + 56);
  const computedCrc = crc32(buf, base, HEADER_CRC_LEN);
  if (storedCrc !== computedCrc) return null;
  return {
    magic: readU32(buf, base + 0),
    version: readU16(buf, base + 4),
    flags: readU16(buf, base + 6),
    shardIdHigh: readU64High(buf, base + 8),
    shardIdLow: readU64Low(buf, base + 8),
    rangeStart: readFloat64LE(buf, base + 16),
    rangeEnd: readFloat64LE(buf, base + 24),
    lastAge: readU32(buf, base + 32),
    generation: readU32(buf, base + 36),
    indexUsedCount: readU32(buf, base + 40),
    logOffset: readU32(buf, base + 44),
    createdAt: readFloat64LE(buf, base + 48),
    crc32: storedCrc,
  };
}

export function readShardHeader(buf: Uint8Array): ShardHeader {
  const h0 = readOneHeader(buf, 0);
  const h1 = readOneHeader(buf, 1);
  if (h0 !== null && h1 !== null) {
    return h1.generation >= h0.generation ? h1 : h0;
  }
  if (h0 !== null) return h0;
  if (h1 !== null) return h1;
  throw new Error('Both shard header copies are corrupt');
}

/**
 * Writes an updated header to the meta-page copy with the lower generation.
 * Mutates `header.generation` to one past the current maximum.
 */
export function updateShardHeader(
  buf: Uint8Array,
  header: ShardHeader,
): void {
  const h0 = readOneHeader(buf, 0);
  const h1 = readOneHeader(buf, 1);
  // Write to the copy with lower generation (or copy 0 if both null/equal)
  let targetCopy: 0 | 1 = 0;
  if (h0 !== null && h1 !== null) {
    targetCopy = h0.generation <= h1.generation ? 0 : 1;
  } else if (h0 === null && h1 !== null) {
    targetCopy = 0;
  } else if (h1 === null && h0 !== null) {
    targetCopy = 1;
  }
  // Increment generation beyond both copies
  const maxGen = Math.max(
    h0 !== null ? h0.generation : 0,
    h1 !== null ? h1.generation : 0,
  );
  header.generation = maxGen + 1;
  writeShardHeader(buf, targetCopy, header);
}

// -- Index slot functions --

// Index slot layout (64 bytes):
//   [0..7]    u64  idHash (high at +4, low at +0)
//   [8..11]   u32  logDelta
//   [12..15]  u32  commitLen
//   [16..23]  f64  timestamp
//   [24]      u8   keyLen
//   [25..63]  39B  key (zero-padded ASCII)

export function readIndexSlot(buf: Uint8Array, slotIndex: number): IndexSlot {
  assert(slotIndex >= 0 && slotIndex < MAX_SLOTS, 'slotIndex out of bounds');
  const base = INDEX_REGION_OFFSET + slotIndex * INDEX_SLOT_SIZE;
  const keyLen = buf[base + 24];
  // Direct ASCII decode (no TextEncoder), keys are always ASCII [a-z0-9-_]
  let key = '';
  for (let i = 0; i < keyLen; i++) {
    key += String.fromCharCode(buf[base + 25 + i]);
  }
  return {
    idHashHigh: readU64High(buf, base),
    idHashLow: readU64Low(buf, base),
    logDelta: readU32(buf, base + 8),
    commitLen: readU32(buf, base + 12),
    timestamp: readFloat64LE(buf, base + 16),
    key,
  };
}

export function writeIndexSlot(
  buf: Uint8Array,
  slotIndex: number,
  slot: IndexSlot,
): void {
  assert(slotIndex >= 0 && slotIndex < MAX_SLOTS, 'slotIndex out of bounds');
  const base = INDEX_REGION_OFFSET + slotIndex * INDEX_SLOT_SIZE;
  writeU64(buf, base, slot.idHashHigh, slot.idHashLow);
  writeU32(buf, base + 8, slot.logDelta);
  writeU32(buf, base + 12, slot.commitLen);
  writeFloat64LE(buf, base + 16, slot.timestamp);
  const keyLen = slot.key.length;
  assert(keyLen <= MAX_KEY_LEN, 'Key exceeds MAX_KEY_LEN');
  buf[base + 24] = keyLen;
  // Direct byte-by-byte ASCII copy, zero-padded to 39 bytes
  let i = 0;
  for (; i < keyLen; i++) {
    buf[base + 25 + i] = slot.key.charCodeAt(i);
  }
  for (; i < MAX_KEY_LEN; i++) {
    buf[base + 25 + i] = 0;
  }
}

// -- Index lookup/insert (open-addressing linear probe) --

function slotIsEmpty(buf: Uint8Array, slotIndex: number): boolean {
  // Empty slot: idHash == 0 (both high and low)
  const base = INDEX_REGION_OFFSET + slotIndex * INDEX_SLOT_SIZE;
  return readU32(buf, base) === 0 && readU32(buf, base + 4) === 0;
}

export function indexLookup(
  buf: Uint8Array,
  idHashHigh: number,
  idHashLow: number,
  capacity: number,
): number {
  assert(
    idHashHigh !== 0 || idHashLow !== 0,
    'Cannot lookup zero hash (reserved for empty)',
  );
  let idx = (idHashLow >>> 0) % capacity;
  for (let probes = 0; probes < capacity; probes++) {
    if (slotIsEmpty(buf, idx)) return -1;
    const base = INDEX_REGION_OFFSET + idx * INDEX_SLOT_SIZE;
    const lo = readU32(buf, base);
    const hi = readU32(buf, base + 4);
    if (lo === idHashLow && hi === idHashHigh) return idx;
    idx = (idx + 1) % capacity;
  }
  return -1;
}

export function indexInsert(
  buf: Uint8Array,
  slot: IndexSlot,
  usedCount: number,
  capacity: number,
): number {
  // Load factor check: reject if adding would exceed 0.67
  const maxLoad = Math.floor(capacity * 2 / 3);
  assert(usedCount < maxLoad, 'Index load factor exceeds 0.67');
  assert(
    slot.idHashHigh !== 0 || slot.idHashLow !== 0,
    'Cannot insert zero hash (reserved for empty)',
  );
  let idx = (slot.idHashLow >>> 0) % capacity;
  for (let probes = 0; probes < capacity; probes++) {
    if (slotIsEmpty(buf, idx)) {
      writeIndexSlot(buf, idx, slot);
      return idx;
    }
    const base = INDEX_REGION_OFFSET + idx * INDEX_SLOT_SIZE;
    if (
      readU32(buf, base) === slot.idHashLow &&
      readU32(buf, base + 4) === slot.idHashHigh
    ) {
      throw new Error('Duplicate idHash in index');
    }
    idx = (idx + 1) % capacity;
  }
  // Should never reach here if load factor is enforced
  throw new Error('Index is full');
}

// -- Hash helper for commit IDs --

export function commitIdHash(id: string): [high: number, low: number] {
  return cyrb64u64(id, SHARD_HASH_SEED);
}
