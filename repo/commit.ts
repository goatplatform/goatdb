import type {
  Encodable,
  Encoder,
  Equatable,
  ReadonlyCoreObject,
} from '../base/core-types/base.ts';
import { Item } from '../cfds/base/item.ts';
import { Edit } from '../cfds/base/edit.ts';
import type {
  ConstructorDecoderConfig,
  Decodable,
  Decoder,
} from '../base/core-types/encoding/types.ts';
import { isDecoderConfig } from '../base/core-types/encoding/utils.ts';
import { uniqueId } from '../base/common.ts';
import { coreValueEquals } from '../base/core-types/equals.ts';
import { assert, notReached } from '../base/error.ts';
import type { Schema } from '../cfds/base/schema.ts';
import type { VersionNumber } from '../base/version-number.ts';
import { getGoatConfig } from '../base/config.ts';
import { type Comparable, coreValueCompare } from '../base/core-types/index.ts';
import type { ReadonlyJSONObject } from '../base/interfaces.ts';
import {
  JSONCyclicalDecoder,
  JSONCyclicalEncoder,
} from '../base/core-types/encoding/json.ts';
import {
  binaryCheckVersion,
  binaryExtractId,
  binaryIsDocumentCommit,
  binaryReadParentsAndAncestors,
  binaryReadStringField,
  commitToBinary,
  COND_MASK,
  CONDITIONAL_FIELD_ORDER,
  decodeStr,
  HEADER_SIZE,
  readFloat64LE,
  readI32LE,
  readU16,
  readU32,
  skipParentsAndAncestors,
} from '../base/core-types/encoding/binary-commit.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { log } from '../logging/log.ts';

let _monoLastTimestamp: number | undefined;
let _nowFn: () => number = Date.now;

/** @internal Override the clock function for testing. */
export function setMonotonicNowFn(fn: () => number): void {
  _nowFn = fn;
}

/** @internal Reset monotonic state (clock and timestamp) for testing. */
export function resetMonotonicState(): void {
  _monoLastTimestamp = undefined;
  _nowFn = Date.now;
}

function nextFloat64(value: number): number {
  // Defensive: callers already validate; this guards against direct misuse.
  assert(
    Number.isFinite(value) && value >= 0,
    'nextFloat64: non-finite or negative value',
  );
  if (value < 2 ** -1022) return value + Number.MIN_VALUE;
  return value + 2 ** (Math.floor(Math.log2(value)) - 52);
}

/** @internal Generate a strictly increasing timestamp in this runtime.
 *
 * Date.now() has 1ms resolution, so commits created in the same millisecond
 * would otherwise be ordered by their random IDs. A stalled or regressed
 * clock advances to the next representable float64 value instead. This can
 * move the timestamp ahead of wall time, but preserves local creation order.
 * Independent runtimes still use the commit ID as a deterministic tiebreaker.
 */
export function nextMonotonicTimestamp(): number {
  const now = _nowFn();
  assert(
    Number.isFinite(now) && now >= 0,
    'nextMonotonicTimestamp: non-finite or negative clock',
  );
  if (_monoLastTimestamp === undefined || now > _monoLastTimestamp) {
    _monoLastTimestamp = now;
  } else {
    _monoLastTimestamp = nextFloat64(_monoLastTimestamp);
  }
  return _monoLastTimestamp;
}

export type CommitResolver = (commitId: string) => Commit;

const gTextDecoder = new TextDecoder();
const gTextEncoder = new TextEncoder();

export interface DocContents extends ReadonlyCoreObject {
  readonly record: Item;
}

export interface DeltaContents extends ReadonlyCoreObject {
  readonly base: string;
  readonly edit: Edit;
}

export type CommitContents = DocContents | DeltaContents;

// NOTE: When adding fields to a commit, support must also be explicitly added
// in:
// 1. /auth/session.ts > signCommit()
// 2. /repo/repo.ts -> Repository.deltaCompressIfNeeded()
export interface CommitConfig {
  id?: string;
  session: string;
  orgId: string;
  key: string;
  contents: Item | CommitContents;
  parents?: string | Iterable<string>;
  ancestors?: string[];
  timestamp?: Date | number;
  buildVersion?: VersionNumber;
  signature?: string;
  mergeBase?: string;
  mergeLeader?: string;
  revert?: string;
  frozen?: true;
  registry?: DataRegistry;
}

export interface CommitSerializeOptions {
  signed?: boolean;
  local?: boolean;
}

// Three structures collaborate to cache serialized commit bytes without
// preventing GC:
//   COMMIT_BYTES  - id -> encoded Uint8Array (populated lazily on first toBytes() call)
//   COMMIT_REFS   - id -> WeakRef<Commit> (for interned/frozen commits only)
//   COMMIT_CLEANUP - FinalizationRegistry that removes COMMIT_BYTES entries
//
// When a Commit is GC'd, COMMIT_CLEANUP fires.  The `deref()` guard in the
// callback is the real safety net: if a *different* live Commit with the same
// id is still reachable via COMMIT_REFS (e.g. a frozen/interned copy), the
// bytes are kept.  Only when no live Commit holds that id are the bytes freed.
const COMMIT_BYTES_MAX = 10_000;
const COMMIT_BYTES = new Map<string, Uint8Array>();
// GC-reclaimable materialized form - populated only for frozen/interned commits
const COMMIT_REFS_MAX = 10_000;
const COMMIT_REFS = new Map<string, WeakRef<Commit>>();
const COMMIT_CLEANUP = new FinalizationRegistry<string>((id) => {
  if (!COMMIT_REFS.get(id)?.deref()) {
    COMMIT_BYTES.delete(id);
    COMMIT_REFS.delete(id);
  }
});

function internCommitRef(id: string, commit: Commit): void {
  COMMIT_REFS.set(id, new WeakRef(commit));
  COMMIT_CLEANUP.register(commit, id);
  // FIFO eviction (Map insertion order). COMMIT_REFS and COMMIT_BYTES evict
  // independently based on their own insertion order; this is harmless since
  // both are soft caches and a miss just triggers re-serialization.
  if (COMMIT_REFS.size > COMMIT_REFS_MAX) {
    const oldId = COMMIT_REFS.keys().next().value!;
    COMMIT_REFS.delete(oldId);
    COMMIT_BYTES.delete(oldId);
  }
}

export const CONNECTION_ID = uniqueId();

export interface CommitDecoderConfig<T = object>
  extends ConstructorDecoderConfig<T> {
  orgId: string;
}

// ---------------------------------------------------------------------------
// Abstract Commit base class
// ---------------------------------------------------------------------------
export abstract class Commit
  implements Encodable, Decodable, Equatable, Comparable {
  abstract readonly orgId: string;
  abstract readonly registry: DataRegistry;

  abstract get id(): string;
  abstract get key(): string;
  abstract get session(): string;
  abstract get parents(): string[];
  abstract get ancestors(): string[];
  abstract get timestamp(): number;
  abstract get contents(): CommitContents;
  abstract get buildVersion(): VersionNumber;
  abstract get signature(): string | undefined;
  abstract get mergeBase(): string | undefined;
  abstract get mergeLeader(): string | undefined;
  abstract get revert(): string | undefined;
  // "Structurally frozen": no new fields, no re-parenting, no content mutation.
  // Does NOT preclude the one-time local `age` write -- age is a transport-layer
  // annotation (local monotonic ordering) and is not part of commit identity.
  abstract get frozen(): boolean;
  abstract get connectionId(): string;
  // Returns the stored connectionId without the CONNECTION_ID fallback.
  // Use this in encode paths to avoid serializing a fallback cid into remote commits.
  abstract get rawConnectionId(): string | undefined;
  abstract get age(): number | undefined;
  abstract set age(v: number);
  abstract get schemaNamespace(): string | undefined;
  abstract get isDocumentCommit(): boolean;
  abstract get deltaBaseId(): string | undefined;

  static get connectionId(): string {
    return CONNECTION_ID;
  }

  get record(): Item | undefined {
    const c = this.contents;
    return commitContentsIsDocument(c) ? c.record : undefined;
  }

  get contentsChecksum(): string {
    // Subclasses cache this; base implementation always computes
    const contents = this.contents;
    return commitContentsIsDocument(contents)
      ? contents.record.checksum
      : contents.edit.dstChecksum;
  }

  get scheme(): Schema | undefined {
    const contents = this.contents;
    if (commitContentsIsDelta(contents)) {
      return contents.edit.scheme;
    }
    return contents.record.schema;
  }

  get createdLocally(): boolean {
    return this.connectionId === CONNECTION_ID;
  }

  serialize(encoder: Encoder, opts?: CommitSerializeOptions): void {
    encoder.set('ver', this.buildVersion);
    encoder.set('id', this.id);
    encoder.set('k', this.key);
    encoder.set('s', this.session);
    encoder.set('ts', this.timestamp);
    encoder.set('org', this.orgId);
    const parents = this.parents;
    if (parents.length > 0) {
      encoder.set('p', parents);
    }
    if (this.ancestors.length > 0) {
      encoder.set('a', this.ancestors);
    }
    const contentsEncoder = encoder.newEncoder();
    commitContentsSerialize(this.contents, contentsEncoder);
    encoder.set('c', contentsEncoder.getOutput());
    if (this.signature && opts?.signed !== false) {
      encoder.set('sig', this.signature);
    }
    if (this.mergeBase) {
      encoder.set('mb', this.mergeBase);
    }
    if (this.mergeLeader) {
      encoder.set('ml', this.mergeLeader);
    }
    if (this.revert) {
      encoder.set('revert', this.revert);
    }
    if (this.rawConnectionId !== undefined) {
      encoder.set('cid', this.rawConnectionId);
    }
    if (opts?.local === true && this.age !== undefined) {
      encoder.set('age', this.age);
    }
  }

  toJS(opts?: CommitSerializeOptions): ReadonlyJSONObject {
    return JSONCyclicalEncoder.serialize(this, opts);
  }

  // Returns the binary encoding of this commit. The returned Uint8Array MAY be
  // a view into a shared buffer (e.g. the scan buffer from fromBinaryScanResult).
  // Callers must NOT transfer, detach, or mutate the underlying ArrayBuffer.
  // Use buf.slice() when an independently owned copy is required.
  toBytes(): Uint8Array {
    let bytes = COMMIT_BYTES.get(this.id);
    if (!bytes) {
      const contentsEncoder = new JSONCyclicalEncoder();
      commitContentsSerialize(this.contents, contentsEncoder);
      const contentsBytes = gTextEncoder.encode(
        JSON.stringify(contentsEncoder.getOutput()),
      );
      bytes = commitToBinary(
        this,
        contentsBytes,
        commitContentsIsDocument(this.contents),
      );
      if (this.frozen) {
        COMMIT_BYTES.set(this.id, bytes);
        if (!COMMIT_REFS.has(this.id)) {
          internCommitRef(this.id, this);
        }
        // FIFO eviction (Map insertion order). The two caches evict
        // independently; a miss is harmless and triggers re-serialization.
        // FinalizationRegistry may later delete the same key — that is a
        // benign no-op (Map.delete on a missing key is safe).
        if (COMMIT_BYTES.size > COMMIT_BYTES_MAX) {
          const oldest = COMMIT_BYTES.keys().next().value!;
          COMMIT_BYTES.delete(oldest);
          COMMIT_REFS.delete(oldest);
        }
      }
    }
    return bytes;
  }

  // deno-lint-ignore no-unused-vars
  deserialize(decoder: Decoder): void {
    throw new Error('deserialize() not supported on abstract Commit');
  }

  isEqual(other: Commit): boolean {
    if (this.id !== other.id) {
      return false;
    }
    // Invariant: same ID must mean same content. Violation indicates
    // corruption or a malicious peer.
    if (!compareCommitsByValue(this, other)) {
      throw new Error(
        `Commit integrity violation: id ${this.id} has divergent content`,
      );
    }
    return true;
  }

  compare(other: Commit): number {
    const dt = this.timestamp - other.timestamp;
    if (dt !== 0) {
      return dt;
    }
    return coreValueCompare(this.key, other.key);
  }

  // Static factory: create a new FieldCommit
  static create(
    config: CommitConfig,
    registry?: DataRegistry,
  ): FieldCommit {
    return new FieldCommit(config, registry);
  }

  static fromJS(
    orgId: string,
    decoder: Decoder,
    registry: DataRegistry,
  ): Commit {
    const id = decoder.get('id') as string;
    const ref = COMMIT_REFS.get(id);
    let result = ref?.deref();
    if (!result) {
      result = new FieldCommit({ decoder, orgId }, registry);
      (result as FieldCommit).setFrozen(true);
      internCommitRef(id, result);
    }
    return result;
  }

  static fromBinaryBytesArr(
    orgId: string,
    arr: readonly Uint8Array[],
    registry: DataRegistry,
  ): Commit[] {
    const result: Commit[] = [];
    for (const bytes of arr) {
      const id = binaryExtractId(bytes);
      assert(
        typeof id === 'string' && id.length > 0,
        'Binary commit blob has empty id field',
      );
      const ref = COMMIT_REFS.get(id);
      let c = ref?.deref();
      if (!c) {
        c = new BinaryCommit(bytes, id, orgId, registry);
        internCommitRef(id, c);
      }
      result.push(c);
    }
    return result;
  }

  static fromBinaryScanResult(
    orgId: string,
    buffer: Uint8Array,
    offsets: Uint32Array,
    registry: DataRegistry,
  ): Commit[] {
    assert(offsets.length % 2 === 0, 'offsets must be (offset, length) pairs');
    const result: Commit[] = [];
    for (let i = 0; i < offsets.length; i += 2) {
      const offset = offsets[i];
      const len = offsets[i + 1];
      // Pass buffer + offset/len directly — no subarray() allocation per record.
      const id = binaryExtractId(buffer, len, offset);
      assert(
        typeof id === 'string' && id.length > 0,
        'Binary commit blob has empty id field',
      );
      const ref = COMMIT_REFS.get(id);
      let c = ref?.deref();
      if (!c) {
        c = new BinaryCommit(buffer, id, orgId, registry, offset, len);
        internCommitRef(id, c);
      }
      result.push(c);
    }
    return result;
  }

  static fromJSArr(
    orgId: string,
    arr: readonly ReadonlyJSONObject[],
    registry: DataRegistry,
  ): Commit[] {
    const result: Commit[] = [];
    for (const obj of arr) {
      const id = obj.id;
      assert(
        typeof id === 'string',
        'JSONL commit object missing string id field',
      );
      const ref = COMMIT_REFS.get(id);
      let c = ref?.deref();
      if (!c) {
        const decoder = JSONCyclicalDecoder.get(obj);
        c = new FieldCommit({ decoder, orgId }, registry);
        (c as FieldCommit).setFrozen(true);
        (c as FieldCommit).setCachedJS(obj);
        decoder.finalize();
        internCommitRef(id, c);
      }
      result.push(c);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// FieldCommit: traditional field storage (JSONL, programmatic creation)
// ---------------------------------------------------------------------------
export class FieldCommit extends Commit {
  readonly orgId: string;
  readonly registry: DataRegistry;
  private _buildVersion!: VersionNumber;
  private _id!: string;
  private _session!: string;
  private _key!: string;
  private _parents: string[] = [];
  private _ancestors: string[] = [];
  private _timestamp!: number;
  private _contents?: CommitContents;
  private _signature?: string;
  private _mergeBase?: string;
  private _mergeLeader?: string;
  private _revert?: string;
  private _cachedChecksum?: string;
  private _cachedJS?: ReadonlyJSONObject;
  private _frozen: boolean = false;
  private _connectionId?: string;
  private _age?: number;

  constructor(
    config: CommitConfig | CommitDecoderConfig,
    registry?: DataRegistry,
  ) {
    super();
    this.registry = registry || DataRegistry.default;
    if (isDecoderConfig(config)) {
      this.orgId = config.orgId;
      this._deserialize(config.decoder);
    } else {
      let { parents, contents } = config;
      if (typeof parents === 'string') {
        parents = [parents];
      } else if (!parents) {
        parents = [];
      } else {
        parents = Array.from(parents);
      }
      if (contents instanceof Item) {
        contents = {
          record: contents,
        };
      }

      this._id = config.id || uniqueId();
      this._session = config.session;
      this.orgId = config.orgId;
      this._key = config.key;
      // Array.from() in the else branch above guarantees string[] at runtime;
      // cast avoids a redundant allocation that tsup's DTS emitter can't elide.
      this._parents = parents as string[];
      assert(
        this._parents.length <= 255,
        `Parent count (${this._parents.length}) exceeds u8 limit of 255`,
      );
      this._ancestors = config.ancestors ?? [];
      assert(
        this._ancestors.length <= 255,
        `Ancestor count (${this._ancestors.length}) exceeds u8 limit of 255`,
      );
      let ts = config.timestamp;
      if (ts instanceof Date) {
        ts = ts.getTime();
      }
      this._timestamp = ts || Date.now();
      this._contents = commitContentsClone(contents);
      // Actively ensure nobody tries to mutate our record. Commits must be
      // immutable.
      if (commitContentsIsDocument(this._contents)) {
        this._contents.record.lock();
      }
      this._buildVersion = config.buildVersion || getGoatConfig().version;
      this._signature = config.signature;
      this._mergeBase = config.mergeBase;
      this._mergeLeader = config.mergeLeader;
      this._revert = config.revert;
      this._frozen = config.frozen === true;
    }
  }

  get id(): string {
    return this._id;
  }
  get key(): string {
    return this._key;
  }
  get session(): string {
    return this._session;
  }
  get parents(): string[] {
    return this._parents;
  }
  get ancestors(): string[] {
    return this._ancestors;
  }
  get timestamp(): number {
    return this._timestamp;
  }
  get contents(): CommitContents {
    assert(
      this._contents !== undefined,
      'FieldCommit: contents not initialized',
    );
    return this._contents;
  }
  get buildVersion(): VersionNumber {
    return this._buildVersion;
  }
  get signature(): string | undefined {
    return this._signature;
  }
  get mergeBase(): string | undefined {
    return this._mergeBase;
  }
  get mergeLeader(): string | undefined {
    return this._mergeLeader;
  }
  get revert(): string | undefined {
    return this._revert;
  }
  get frozen(): boolean {
    return this._frozen;
  }
  get connectionId(): string {
    return this._connectionId ?? CONNECTION_ID;
  }
  get rawConnectionId(): string | undefined {
    return this._connectionId;
  }
  get age(): number | undefined {
    return this._age;
  }
  set age(v: number) {
    assert(this._age === undefined);
    this._age = v;
    // _cachedJS intentionally not cleared: age is a transport-layer annotation,
    // not part of commit identity.
  }
  get schemaNamespace(): string | undefined {
    return this.scheme?.ns ?? undefined;
  }
  get isDocumentCommit(): boolean {
    return this._contents !== undefined &&
      commitContentsIsDocument(this._contents);
  }
  get deltaBaseId(): string | undefined {
    return this._contents !== undefined && commitContentsIsDelta(this._contents)
      ? this._contents.base
      : undefined;
  }

  override get contentsChecksum(): string {
    if (!this._cachedChecksum) {
      this._cachedChecksum = super.contentsChecksum;
    }
    return this._cachedChecksum;
  }

  override toJS(opts?: CommitSerializeOptions): ReadonlyJSONObject {
    if (!opts) {
      if (this._cachedJS) return this._cachedJS;
      this._cachedJS = JSONCyclicalEncoder.serialize(this);
      return this._cachedJS;
    }
    return JSONCyclicalEncoder.serialize(this, opts);
  }

  override deserialize(decoder: Decoder): void {
    this._deserialize(decoder);
  }

  private _deserialize(decoder: Decoder): void {
    assert(!this._frozen);
    this._buildVersion = decoder.get<number>('ver')!;
    this._id = decoder.get<string>('id')!;
    assert(this._id !== undefined, 'commit: missing required field "id"');
    this._key = decoder.get<string>('k')!;
    assert(this._key !== undefined, 'commit: missing required field "k"');
    this._session = decoder.get<string>('s')!;
    assert(this._session !== undefined, 'commit: missing required field "s"');
    this._timestamp = decoder.get<number>('ts') ?? Date.now();
    this._parents = decoder.get<string[]>('p') || [];
    this._ancestors = decoder.get<string[]>('a') || []; // Replaces old bloom fields 'af'/'ac'
    if (decoder.has('af')) {
      log({
        severity: 'WARNING',
        error: 'StorageError',
        message:
          'Commit uses legacy Bloom filter fields (af/ac); ancestors will be empty until re-merged. Re-write the commit to upgrade.',
      });
    }
    const contentsDecoder = decoder.getDecoder('c');
    this._contents = commitContentsDeserialize(
      contentsDecoder,
      this.registry,
    );
    contentsDecoder.finalize?.();
    this._signature = decoder.get<string | undefined>('sig');
    this._mergeBase = decoder.get<string | undefined>('mb');
    this._mergeLeader = decoder.get<string | undefined>('ml');
    this._revert = decoder.get<string | undefined>('revert');
    this._cachedChecksum = undefined;
    this._cachedJS = undefined;
    this._connectionId = decoder.get<string>('cid');
    this._age = decoder.get<number>('age');
  }

  /** @internal Called from Commit static factories which cannot access protected members on a subclass instance via a typed reference (TypeScript limitation). */
  setFrozen(v: boolean): void {
    // Prevent unfreezing a commit whose bytes are cached — callers rely on
    // COMMIT_BYTES being consistent with the frozen commit's field values.
    assert(
      v === true || !COMMIT_BYTES.has(this._id),
      'setFrozen: cannot unfreeze a commit with cached bytes',
    );
    this._frozen = v;
  }
  /** @internal */
  setCachedJS(v: ReadonlyJSONObject): void {
    this._cachedJS = v;
  }
}

// ---------------------------------------------------------------------------
// BinaryCommit: compact buffer-backed implementation (.goat loading)
// ---------------------------------------------------------------------------
/**
 * Buffer-backed read path for the .goat binary format -- designed for
 * zero-copy decode.
 *
 * - `_buf` holds the shared backing buffer (may be a multi-record scan buffer).
 * - `_baseOffset` is the byte offset of this record within `_buf`.
 * - `_len` is the byte length of this record.
 * - `toBytes()` returns a subarray view only when base/len differ from the
 *   full buffer; for fromBinaryBytesArr the buffer IS the record (no alloc).
 * - Fields are decoded lazily from the buffer on first access, then cached --
 *   no eager deserialization.
 * - The `age` setter patches the backing buffer in-place to avoid re-encoding.
 * - NO intermediate objects or temporary allocations on the read path.
 */
export class BinaryCommit extends Commit {
  readonly orgId: string;
  readonly registry: DataRegistry;
  private _buf: Uint8Array;
  private _baseOffset: number;
  private _len: number;
  private _flags: number;
  private _id: string;

  // Lazy string caches (bytes -> string must be cached)
  private _key?: string;
  private _session?: string;
  private _parents?: string[];
  private _ancestors?: string[];

  // Conditional fields loaded in a single pass to avoid redundant buffer walks
  private _conditionalFieldsLoaded = false;
  private _signature?: string;
  private _mergeBase?: string;
  private _mergeLeader?: string;
  private _revert?: string;
  private _connectionId?: string;
  private _deltaBase?: string;

  private _contents?: CommitContents;

  private _timestamp: number;
  private _buildVersion: VersionNumber;
  private _cachedChecksum?: string;
  private _age?: number;
  private _view?: Uint8Array;
  private _schemaNamespace?: string;
  private _schemaNamespaceLoaded = false;

  constructor(
    buf: Uint8Array,
    id: string,
    orgId: string,
    registry: DataRegistry,
    baseOffset = 0,
    len?: number,
  ) {
    super();
    this._buf = buf;
    this._baseOffset = baseOffset;
    this._len = len ?? buf.length - baseOffset;
    binaryCheckVersion(buf, baseOffset);
    this._id = id;
    this.orgId = orgId;
    this.registry = registry;
    this._flags = readU16(buf, baseOffset + 2);
    // Cache numeric header fields (avoids per-access DataView allocation)
    this._timestamp = readFloat64LE(buf, baseOffset + 4);
    const age = readI32LE(buf, baseOffset + 12);
    this._age = age !== -1 ? age : undefined;
    this._buildVersion = readU32(buf, baseOffset + 20) as VersionNumber;
    const recordEnd = baseOffset + this._len;
    const binaryOrgId = binaryReadStringField(buf, 3, baseOffset, recordEnd);
    assert(
      binaryOrgId === orgId,
      `BinaryCommit orgId mismatch: binary has "${binaryOrgId}", expected "${orgId}"`,
    );
  }

  get id(): string {
    return this._id;
  }
  private _assertAlive(): void {
    assert(
      !(this._buf.buffer as ArrayBuffer).detached,
      'BinaryCommit: backing ArrayBuffer detached',
    );
  }

  get key(): string {
    this._assertAlive();
    return (this._key ??= binaryReadStringField(
      this._buf,
      1,
      this._baseOffset,
      this._baseOffset + this._len,
    ));
  }
  get session(): string {
    this._assertAlive();
    return (this._session ??= binaryReadStringField(
      this._buf,
      2,
      this._baseOffset,
      this._baseOffset + this._len,
    ));
  }

  get timestamp(): number {
    return this._timestamp;
  }
  get buildVersion(): VersionNumber {
    return this._buildVersion;
  }

  private _loadParentsAndAncestors(): void {
    if (this._parents !== undefined && this._ancestors !== undefined) return;
    this._assertAlive();
    const { parents, ancestors } = binaryReadParentsAndAncestors(
      this._buf,
      this._flags,
      this._baseOffset,
      this._baseOffset + this._len,
    );
    this._parents ??= parents;
    this._ancestors ??= ancestors;
  }

  get parents(): string[] {
    this._loadParentsAndAncestors();
    return this._parents!;
  }

  get ancestors(): string[] {
    this._loadParentsAndAncestors();
    return this._ancestors!;
  }

  get contents(): CommitContents {
    if (this._contents === undefined) {
      this._assertAlive();
      // Inlined from binaryContentsRange() to avoid a [start, end] tuple
      // allocation on this hot path. The canonical implementation remains in
      // binary-commit.ts for external / test use.
      const cStart = this._baseOffset +
        readU16(this._buf, this._baseOffset + 34);
      const cEnd = this._baseOffset + this._len;
      assert(
        cStart >= this._baseOffset + HEADER_SIZE && cStart < cEnd,
        'binary: contentsOffset out of bounds',
      );
      const obj = JSON.parse(
        gTextDecoder.decode(this._buf.subarray(cStart, cEnd)),
      );
      const contentsDecoder = JSONCyclicalDecoder.get(obj);
      this._contents = commitContentsDeserialize(
        contentsDecoder,
        this.registry,
      );
      contentsDecoder.finalize();
    }
    return this._contents;
  }

  get deltaBaseId(): string | undefined {
    if (this.isDocumentCommit) return undefined;
    if (this._contents !== undefined) {
      return (this._contents as DeltaContents).base;
    }
    this._loadConditionalFields();
    return this._deltaBase;
  }

  // Walk the conditional fields section once, assigning directly to private
  // fields. Zero allocation beyond the decoded strings (unavoidable in JS).
  private _loadConditionalFields(): void {
    if (this._conditionalFieldsLoaded) return;
    this._assertAlive();
    this._conditionalFieldsLoaded = true;
    // Skip buffer walk entirely when no conditional fields are present
    // (the common case for simple non-merge, non-delta commits).
    if (!(this._flags & COND_MASK)) return;
    // skipParentsAndAncestors returns absolute position in the shared buffer.
    const recordEnd = this._baseOffset + this._len;
    let pos = skipParentsAndAncestors(
      this._buf,
      this._flags,
      this._baseOffset,
      recordEnd,
    );
    for (const [name, bit] of CONDITIONAL_FIELD_ORDER) {
      if (!(this._flags & bit)) continue;
      if (pos + 2 > recordEnd) {
        throw new Error('binary: truncated conditional field length');
      }
      const len = readU16(this._buf, pos);
      pos += 2;
      if (pos + len > recordEnd) {
        throw new Error('binary: conditional field exceeds record bounds');
      }
      const val = decodeStr(this._buf, pos, len);
      pos += len;
      switch (name) {
        case 'signature':
          this._signature = val;
          break;
        case 'mergeBase':
          this._mergeBase = val;
          break;
        case 'mergeLeader':
          this._mergeLeader = val;
          break;
        case 'revert':
          this._revert = val;
          break;
        case 'connectionId':
          this._connectionId = val;
          break;
        case 'deltaBase':
          this._deltaBase = val;
          break;
        default:
          notReached(`unknown conditional field: ${name}`);
      }
    }
  }

  get signature(): string | undefined {
    this._loadConditionalFields();
    return this._signature;
  }
  get mergeBase(): string | undefined {
    this._loadConditionalFields();
    return this._mergeBase;
  }
  get mergeLeader(): string | undefined {
    this._loadConditionalFields();
    return this._mergeLeader;
  }
  get revert(): string | undefined {
    this._loadConditionalFields();
    return this._revert;
  }
  get connectionId(): string {
    this._loadConditionalFields();
    return this._connectionId ?? CONNECTION_ID;
  }
  get rawConnectionId(): string | undefined {
    this._loadConditionalFields();
    return this._connectionId;
  }

  get frozen(): boolean {
    return true; // binary-loaded commits are always frozen
  }

  get age(): number | undefined {
    return this._age;
  }
  set age(v: number) {
    assert(this._age === undefined);
    this._assertAlive();
    this._age = v;
    // Patch the backing buffer in-place so toBytes() reflects the new age.
    // fromBinaryScanResult path: safe because each commit occupies a
    //   non-overlapping region, the buffer is transferred via postMessage so
    //   the worker cannot reuse it, and no code reads the raw buffer after.
    // fromBinaryBytesArr path: safe because _buf is a fresh owned buffer.
    // The assert above prevents double-assignment in both paths.
    // Age field is at header offset 12, 4-byte LE.
    const o = this._baseOffset + 12;
    this._buf[o] = v & 0xff;
    this._buf[o + 1] = (v >> 8) & 0xff;
    this._buf[o + 2] = (v >> 16) & 0xff;
    this._buf[o + 3] = (v >>> 24) & 0xff;
  }

  get schemaNamespace(): string | undefined {
    if (!this._schemaNamespaceLoaded) {
      this._assertAlive();
      this._schemaNamespaceLoaded = true;
      const schemaId = binaryReadStringField(
        this._buf,
        4,
        this._baseOffset,
        this._baseOffset + this._len,
      );
      if (schemaId !== '') {
        const slash = schemaId.indexOf('/');
        this._schemaNamespace = slash >= 0
          ? schemaId.slice(0, slash)
          : schemaId;
      }
    }
    return this._schemaNamespace;
  }
  get isDocumentCommit(): boolean {
    return binaryIsDocumentCommit(this._flags);
  }

  override get contentsChecksum(): string {
    if (!this._cachedChecksum) {
      this._cachedChecksum = super.contentsChecksum;
    }
    return this._cachedChecksum;
  }

  // Return the backing bytes for this record.
  // For fromBinaryBytesArr: _buf IS the record; returned directly when
  //   _baseOffset === 0 && _len === _buf.length (no alloc).
  // For fromBinaryScanResult: _buf is a shared scan buffer; return a subarray
  //   view scoped to [_baseOffset, _baseOffset+_len] (one-time view alloc).
  // OWNERSHIP NOTE: _buf may be transferred worker->main via postMessage
  // (Transferable). Any future transfer back to a worker will corrupt live
  // BinaryCommit objects. Callers must NOT transfer the underlying ArrayBuffer.
  override toBytes(): Uint8Array {
    this._assertAlive();
    if (this._baseOffset === 0 && this._len === this._buf.length) {
      return this._buf;
    }
    return (this._view ??= this._buf.subarray(
      this._baseOffset,
      this._baseOffset + this._len,
    ));
  }
}

export function commitContentsIsDelta(c: CommitContents): c is DeltaContents {
  return typeof c.base === 'string';
}

export function commitContentsIsDocument<S extends Schema>(
  c: CommitContents,
): c is DocContents {
  return c.record instanceof Item;
}

export function commitContentsSerialize(
  c: CommitContents,
  encoder: Encoder,
): void {
  if (commitContentsIsDocument(c)) {
    const recEncoder = encoder.newEncoder();
    c.record.serialize(recEncoder);
    encoder.set('r', recEncoder.getOutput());
  } else {
    encoder.set('b', c.base);
    const editEncoder = encoder.newEncoder();
    c.edit.serialize(editEncoder);
    encoder.set('e', editEncoder.getOutput());
  }
}

export function commitContentsDeserialize(
  decoder: Decoder,
  registry: DataRegistry,
): CommitContents {
  if (decoder.has('r')) {
    const recordDecoder = decoder.getDecoder('r');
    const record = new Item({ decoder: recordDecoder }, registry);
    recordDecoder.finalize?.();
    record.lock();
    return {
      record: record,
    };
  } else {
    assert(decoder.has('e'), 'Commit has no contents');
    const editDecoder = decoder.getDecoder('e');
    const r = {
      base: decoder.get<string>('b')!,
      edit: new Edit({ decoder: editDecoder }),
    };
    editDecoder.finalize?.();
    return r;
  }
}

function compareCommitsByValue(c1: Commit, c2: Commit): boolean {
  return (
    c1.id === c2.id &&
    c1.buildVersion === c2.buildVersion &&
    c1.key === c2.key &&
    c1.session === c2.session &&
    coreValueEquals(c1.timestamp, c2.timestamp) &&
    coreValueEquals(c1.parents, c2.parents) &&
    coreValueEquals(c1.ancestors, c2.ancestors) &&
    coreValueEquals(c1.contents, c2.contents)
  );
}

function commitContentsClone(contents: CommitContents): CommitContents {
  if (commitContentsIsDelta(contents)) {
    return {
      base: contents.base,
      edit: contents.edit.clone(),
    };
  }
  const record = contents.record.clone();
  record.normalize();
  return {
    record,
  };
}
