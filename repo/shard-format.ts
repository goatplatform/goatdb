// Shard file format: preallocated ID pool + hash index + append-only commit log.
// Double meta-page header for crash safety. Open-addressing linear probe index.
//
// Layout:
//   [0..127]              Double header (2 x 64 bytes)
//   [128..POOL_END-1]     ID Pool: MAX_POOL x 80B entries
//   [POOL_END..IDX_END-1] Hash Index: MAX_SLOTS x 32B slots
//   [IDX_END..]           Commit log (4B BE len + binary commit payload)
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

// -- Format-invariant constants --

export const SHARD_MAGIC = 0x474f4154; // 'GOAT'
export const SHARD_VERSION = 1;
export const SHARD_HEADER_SIZE = 64;
export const SHARD_DOUBLE_HEADER_SIZE = 128;
export const COMMIT_ID_LEN = 24;
export const POOL_ENTRY_SIZE = 80;
export const INDEX_SLOT_SIZE = 32;
export const MAX_KEY_LEN = 39;
export const LOG_DELTA_MAX = 0xffffffff;
export const POOL_NONE = 0xffffffff;
export const INDEX_OVERFLOW_FLAG = 1; // bit0 of flags byte

// -- Configurable shard sizing --

export interface ShardConfig {
  // User knobs
  maxCommits: number;
  splitThreshold: number;
  minCommits: number;
  // Derived (internal)
  maxPool: number;
  poolSplitThreshold: number;
  maxSlots: number;
  poolRegionOffset: number;
  poolRegionSize: number;
  indexRegionOffset: number;
  indexRegionSize: number;
  defaultLogOffset: number;
}

export function makeShardConfig(opts?: {
  maxCommits?: number;
  splitThreshold?: number;
  minCommits?: number;
}): ShardConfig {
  const maxCommits = opts?.maxCommits ?? 100_000;
  const splitThreshold = opts?.splitThreshold ?? Math.floor(maxCommits * 0.75);
  const minCommits = opts?.minCommits ?? Math.floor(maxCommits * 0.1);
  const maxPool = Math.floor(maxCommits * 2.5);
  const poolSplitThreshold = Math.floor(maxPool * 0.75);
  const maxSlots = Math.floor(maxCommits * 1.5);
  const poolRegionOffset = SHARD_DOUBLE_HEADER_SIZE;
  const poolRegionSize = maxPool * POOL_ENTRY_SIZE;
  const indexRegionOffset = poolRegionOffset + poolRegionSize;
  const indexRegionSize = maxSlots * INDEX_SLOT_SIZE;
  const defaultLogOffset = indexRegionOffset + indexRegionSize;
  return {
    maxCommits,
    splitThreshold,
    minCommits,
    maxPool,
    poolSplitThreshold,
    maxSlots,
    poolRegionOffset,
    poolRegionSize,
    indexRegionOffset,
    indexRegionSize,
    defaultLogOffset,
  };
}

export const SERVER_SHARD_CONFIG = makeShardConfig();
export const BROWSER_SHARD_CONFIG = makeShardConfig({ maxCommits: 25_000 });

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
  poolUsedCount: number;
  crc32: number;
}

export interface PoolEntry {
  id: string; // 24-byte ASCII commit ID
  parent0: number; // pool index or POOL_NONE
  parent1: number; // pool index or POOL_NONE
  ancestor0: number; // pool index or POOL_NONE
  ancestor1: number; // pool index or POOL_NONE
  key: string; // up to 39 ASCII bytes (empty for foreign refs)
}

export interface IndexSlot {
  poolIdx: number; // u32 (POOL_NONE = empty)
  logDelta: number; // u32
  commitLen: number; // u32
  timestamp: number; // f64
  flags: number; // u8 (bit0 = has_overflow)
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

// CRC32 covers bytes 0..59 of a header copy (everything except crc32 field)
const HEADER_CRC_LEN = 60;

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
  writeU32(buf, base + 56, header.poolUsedCount);
  // Compute CRC32 over bytes 0..59
  const checksum = crc32(buf, base, HEADER_CRC_LEN);
  writeU32(buf, base + 60, checksum);
}

export function readShardHeader(buf: Uint8Array): ShardHeader {
  const h0 = readOneHeader(buf, 0);
  const h1 = readOneHeader(buf, 1);
  if (h0 !== null && h1 !== null) {
    // Equal generations only occur during initial setup; copy 1 is chosen
    // arbitrarily. updateShardHeader always produces distinct generations.
    return h1.generation >= h0.generation ? h1 : h0;
  }
  if (h0 !== null) return h0;
  if (h1 !== null) return h1;
  throw new Error('Both shard header copies are corrupt');
}

function readOneHeader(buf: Uint8Array, copyIndex: 0 | 1): ShardHeader | null {
  const base = copyIndex * SHARD_HEADER_SIZE;
  if (buf.length < base + SHARD_HEADER_SIZE) return null;
  const storedCrc = readU32(buf, base + 60);
  const computedCrc = crc32(buf, base, HEADER_CRC_LEN);
  if (storedCrc !== computedCrc) return null;
  // Validate magic and version after CRC -- a random buffer with valid CRC
  // should not be accepted as a valid header.
  const magic = readU32(buf, base + 0);
  const version = readU16(buf, base + 4);
  if (magic !== SHARD_MAGIC || version !== SHARD_VERSION) return null;
  return {
    magic,
    version,
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
    poolUsedCount: readU32(buf, base + 56),
    crc32: storedCrc,
  };
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

// -- Pool entry functions --

// Pool entry layout (80 bytes):
//   [0..23]   24B  id (raw ASCII commit ID, zero-padded)
//   [24..27]  u32  parent0 (pool index or POOL_NONE)
//   [28..31]  u32  parent1 (pool index or POOL_NONE)
//   [32..35]  u32  ancestor0 (pool index or POOL_NONE)
//   [36..39]  u32  ancestor1 (pool index or POOL_NONE)
//   [40]      u8   keyLen (0..39; 0 for foreign refs)
//   [41..79]  39B  key (zero-padded ASCII)

/** Reads a pool entry at the given index. Returns zeroed fields for empty slots. */
export function readPoolEntry(
  buf: Uint8Array,
  poolIdx: number,
  cfg: ShardConfig,
): PoolEntry {
  assert(poolIdx >= 0 && poolIdx < cfg.maxPool, 'poolIdx out of bounds');
  const base = cfg.poolRegionOffset + poolIdx * POOL_ENTRY_SIZE;
  // Decode 24-byte ASCII id; null byte stops early (corruption tolerance:
  // a truncated id is still returned rather than reading into adjacent data)
  let id = '';
  for (let i = 0; i < COMMIT_ID_LEN; i++) {
    const b = buf[base + i];
    if (b === 0) break;
    id += String.fromCharCode(b);
  }
  const keyLen = buf[base + 40];
  let key = '';
  for (let i = 0; i < keyLen; i++) {
    key += String.fromCharCode(buf[base + 41 + i]);
  }
  return {
    id,
    parent0: readU32(buf, base + 24),
    parent1: readU32(buf, base + 28),
    ancestor0: readU32(buf, base + 32),
    ancestor1: readU32(buf, base + 36),
    key,
  };
}

/** Writes a pool entry at the given index. Zero-pads the key region. */
export function writePoolEntry(
  buf: Uint8Array,
  poolIdx: number,
  entry: PoolEntry,
  cfg: ShardConfig,
): void {
  assert(poolIdx >= 0 && poolIdx < cfg.maxPool, 'poolIdx out of bounds');
  const base = cfg.poolRegionOffset + poolIdx * POOL_ENTRY_SIZE;
  // Write 24-byte ASCII id (exact length required)
  assert(
    entry.id.length === COMMIT_ID_LEN,
    'Commit ID must be exactly 24 bytes',
  );
  for (let i = 0; i < COMMIT_ID_LEN; i++) {
    buf[base + i] = entry.id.charCodeAt(i);
  }
  writeU32(buf, base + 24, entry.parent0);
  writeU32(buf, base + 28, entry.parent1);
  writeU32(buf, base + 32, entry.ancestor0);
  writeU32(buf, base + 36, entry.ancestor1);
  // Write key
  const keyLen = entry.key.length;
  assert(keyLen <= MAX_KEY_LEN, 'Key exceeds MAX_KEY_LEN');
  buf[base + 40] = keyLen;
  for (let k = 0; k < keyLen; k++) {
    buf[base + 41 + k] = entry.key.charCodeAt(k);
  }
  for (let k = keyLen; k < MAX_KEY_LEN; k++) {
    buf[base + 41 + k] = 0;
  }
}

/** Returns true if the pool slot is unused (first id byte is null). */
export function poolEntryIsEmpty(
  buf: Uint8Array,
  poolIdx: number,
  cfg: ShardConfig,
): boolean {
  assert(poolIdx >= 0 && poolIdx < cfg.maxPool, 'poolIdx out of bounds');
  const base = cfg.poolRegionOffset + poolIdx * POOL_ENTRY_SIZE;
  // Empty entry: first byte of id is 0 (valid IDs are alphanumeric, never start with \0)
  return buf[base] === 0;
}

// -- Index slot functions --

// Index slot layout (32 bytes):
//   [0..3]    u32  poolIdx (POOL_NONE = empty)
//   [4..7]    u32  logDelta
//   [8..11]   u32  commitLen
//   [12..19]  f64  timestamp
//   [20]      u8   flags (bit0 = has_overflow)
//   [21..31]  11B  reserved (zeros)

export function readIndexSlot(
  buf: Uint8Array,
  slotIndex: number,
  cfg: ShardConfig,
): IndexSlot {
  assert(slotIndex >= 0 && slotIndex < cfg.maxSlots, 'slotIndex out of bounds');
  const base = cfg.indexRegionOffset + slotIndex * INDEX_SLOT_SIZE;
  return {
    poolIdx: readU32(buf, base),
    logDelta: readU32(buf, base + 4),
    commitLen: readU32(buf, base + 8),
    timestamp: readFloat64LE(buf, base + 12),
    flags: buf[base + 20],
  };
}

export function writeIndexSlot(
  buf: Uint8Array,
  slotIndex: number,
  slot: IndexSlot,
  cfg: ShardConfig,
): void {
  assert(slotIndex >= 0 && slotIndex < cfg.maxSlots, 'slotIndex out of bounds');
  const base = cfg.indexRegionOffset + slotIndex * INDEX_SLOT_SIZE;
  writeU32(buf, base, slot.poolIdx);
  writeU32(buf, base + 4, slot.logDelta);
  writeU32(buf, base + 8, slot.commitLen);
  writeFloat64LE(buf, base + 12, slot.timestamp);
  buf[base + 20] = slot.flags;
  // Zero reserved bytes 21..31
  for (let i = 21; i < 32; i++) {
    buf[base + i] = 0;
  }
}

// -- Index region initialization --

/**
 * Initializes the index region of a shard buffer so all slots read as empty
 * (poolIdx = POOL_NONE). Must be called on any freshly allocated buffer
 * before indexInsert/indexLookup.
 */
export function initIndexRegion(buf: Uint8Array, cfg: ShardConfig): void {
  for (let i = 0; i < cfg.maxSlots; i++) {
    const base = cfg.indexRegionOffset + i * INDEX_SLOT_SIZE;
    writeU32(buf, base, POOL_NONE);
  }
}

// -- Index lookup/insert (open-addressing linear probe) --

function slotIsEmpty(
  buf: Uint8Array,
  slotIndex: number,
  cfg: ShardConfig,
): boolean {
  const base = cfg.indexRegionOffset + slotIndex * INDEX_SLOT_SIZE;
  return readU32(buf, base) === POOL_NONE;
}

// Zero-copy byte-by-byte comparison of commitId against the 24-byte ASCII id
// stored in a pool entry, avoiding subarray allocation.
function poolIdEquals(
  buf: Uint8Array,
  poolIdx: number,
  commitId: string,
  cfg: ShardConfig,
): boolean {
  assert(
    commitId.length === COMMIT_ID_LEN,
    'commitId must be exactly 24 bytes',
  );
  const base = cfg.poolRegionOffset + poolIdx * POOL_ENTRY_SIZE;
  for (let i = 0; i < COMMIT_ID_LEN; i++) {
    if (buf[base + i] !== commitId.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Looks up a commit ID in the hash index via open-addressing linear probe.
 * Returns the slot index on hit, or -1 on miss.
 */
export function indexLookup(
  buf: Uint8Array,
  commitId: string,
  cfg: ShardConfig,
): number {
  const capacity = cfg.maxSlots;
  const [, low] = cyrb64u64(commitId, SHARD_HASH_SEED);
  let idx = (low >>> 0) % capacity;
  for (let probes = 0; probes < capacity; probes++) {
    if (slotIsEmpty(buf, idx, cfg)) return -1;
    const base = cfg.indexRegionOffset + idx * INDEX_SLOT_SIZE;
    const poolIdx = readU32(buf, base);
    if (poolIdEquals(buf, poolIdx, commitId, cfg)) return idx;
    idx = (idx + 1) % capacity;
  }
  return -1;
}

export function indexInsert(
  buf: Uint8Array,
  slot: IndexSlot,
  commitId: string,
  usedCount: number,
  cfg: ShardConfig,
): number {
  const capacity = cfg.maxSlots;
  // Load factor check: reject if adding would exceed 0.67
  const maxLoad = Math.floor((capacity * 2) / 3);
  assert(usedCount < maxLoad, 'Index load factor exceeds 0.67');
  assert(slot.poolIdx !== POOL_NONE, 'Cannot insert slot with POOL_NONE index');
  const [, low] = cyrb64u64(commitId, SHARD_HASH_SEED);
  let idx = (low >>> 0) % capacity;
  for (let probes = 0; probes < capacity; probes++) {
    if (slotIsEmpty(buf, idx, cfg)) {
      writeIndexSlot(buf, idx, slot, cfg);
      return idx;
    }
    const base = cfg.indexRegionOffset + idx * INDEX_SLOT_SIZE;
    const existingPoolIdx = readU32(buf, base);
    if (poolIdEquals(buf, existingPoolIdx, commitId, cfg)) {
      throw new Error('Duplicate commit ID in index');
    }
    idx = (idx + 1) % capacity;
  }
  // Should never reach here if load factor is enforced
  throw new Error('Index is full');
}
