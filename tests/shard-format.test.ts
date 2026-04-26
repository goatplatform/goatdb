import { assertEquals, assertThrows, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import { crc32 } from '../base/crc32.ts';
import { cyrb64, cyrb64u64, SHARD_HASH_SEED } from '../base/hash.ts';
import {
  BROWSER_SHARD_CONFIG,
  COMMIT_ID_LEN,
  INDEX_OVERFLOW_FLAG,
  INDEX_SLOT_SIZE,
  indexInsert,
  indexLookup,
  initIndexRegion,
  makeShardConfig,
  MAX_KEY_LEN,
  POOL_ENTRY_SIZE,
  POOL_NONE,
  poolEntryIsEmpty,
  readIndexSlot,
  readPoolEntry,
  readShardHeader,
  SERVER_SHARD_CONFIG,
  SHARD_DOUBLE_HEADER_SIZE,
  SHARD_HEADER_SIZE,
  SHARD_MAGIC,
  SHARD_VERSION,
  updateShardHeader,
  writeIndexSlot,
  writePoolEntry,
  writeShardHeader,
} from '../repo/shard-format.ts';
import type {
  IndexSlot,
  PoolEntry,
  ShardConfig,
  ShardHeader,
} from '../repo/shard-format.ts';
import { itemPathIsValid } from '../db/path.ts';

const cfg = SERVER_SHARD_CONFIG;

function makeHeader(overrides?: Partial<ShardHeader>): ShardHeader {
  return {
    magic: SHARD_MAGIC,
    version: SHARD_VERSION,
    flags: 0,
    shardIdHigh: 0x12345678,
    shardIdLow: 0xabcdef01,
    rangeStart: 0.0,
    rangeEnd: 1000.5,
    lastAge: 42,
    generation: 1,
    indexUsedCount: 0,
    logOffset: cfg.defaultLogOffset,
    createdAt: 1700000000000,
    poolUsedCount: 0,
    crc32: 0,
    ...overrides,
  };
}

function makeSlot(overrides?: Partial<IndexSlot>): IndexSlot {
  return {
    poolIdx: 0,
    logDelta: 1024,
    commitLen: 256,
    timestamp: 1700000000000,
    flags: 0,
    ...overrides,
  };
}

function makePoolEntry(overrides?: Partial<PoolEntry>): PoolEntry {
  return {
    id: 'abcdefghij1234567890abcd',
    parent0: POOL_NONE,
    parent1: POOL_NONE,
    ancestor0: POOL_NONE,
    ancestor1: POOL_NONE,
    key: 'test-key',
    ...overrides,
  };
}

// Allocate a buffer large enough for pool + index regions of the given config.
function allocBuf(c: ShardConfig = cfg): Uint8Array {
  const size = c.indexRegionOffset + c.maxSlots * INDEX_SLOT_SIZE;
  const buf = new Uint8Array(size);
  initIndexRegion(buf, c);
  return buf;
}

export default function setup(): void {
  // 1. CRC32 known vectors
  TEST('ShardFormat', 'crc32 known vectors', () => {
    // Empty buffer
    assertEquals(crc32(new Uint8Array(0), 0, 0), 0x00000000);
    // "123456789" canonical check value
    const input = new Uint8Array([
      0x31,
      0x32,
      0x33,
      0x34,
      0x35,
      0x36,
      0x37,
      0x38,
      0x39,
    ]);
    assertEquals(crc32(input, 0, 9), 0xcbf43926);
    // Offset/length subset
    assertEquals(
      crc32(input, 1, 3),
      crc32(
        new Uint8Array([0x32, 0x33, 0x34]),
        0,
        3,
      ),
    );
  });

  // 2. cyrb64u64 determinism
  TEST('ShardFormat', 'cyrb64u64 determinism', () => {
    const [h1, l1] = cyrb64u64('hello-world', SHARD_HASH_SEED);
    const [h2, l2] = cyrb64u64('hello-world', SHARD_HASH_SEED);
    assertEquals(h1, h2);
    assertEquals(l1, l2);
    // Different input produces different hash
    const [h3, l3] = cyrb64u64('different-key', SHARD_HASH_SEED);
    assertTrue(h1 !== h3 || l1 !== l3);
  });

  // 3. cyrb64u64 vs cyrb64 consistency
  TEST('ShardFormat', 'cyrb64u64 vs cyrb64 lane consistency', () => {
    const seed = SHARD_HASH_SEED;
    const str = 'test-consistency';
    const [high, low] = cyrb64u64(str, seed);
    const composite = cyrb64(str, seed);
    // cyrb64 returns: 4294967296 * (2097151 & h2) + (h1 >>> 0)
    // where h2 = high, h1 = low
    const reconstructed = 4294967296 * (2097151 & high) + (low >>> 0);
    assertEquals(composite, reconstructed);
  });

  // 4. Header round-trip (with poolUsedCount)
  TEST('ShardFormat', 'header round-trip', () => {
    const buf = allocBuf();
    const header = makeHeader({ poolUsedCount: 42 });
    writeShardHeader(buf, 0, header);
    writeShardHeader(buf, 1, header);
    const result = readShardHeader(buf);
    assertEquals(result.magic, header.magic);
    assertEquals(result.version, header.version);
    assertEquals(result.flags, header.flags);
    assertEquals(result.shardIdHigh, header.shardIdHigh);
    assertEquals(result.shardIdLow, header.shardIdLow);
    assertEquals(result.rangeStart, header.rangeStart);
    assertEquals(result.rangeEnd, header.rangeEnd);
    assertEquals(result.lastAge, header.lastAge);
    assertEquals(result.generation, header.generation);
    assertEquals(result.indexUsedCount, header.indexUsedCount);
    assertEquals(result.logOffset, header.logOffset);
    assertEquals(result.createdAt, header.createdAt);
    assertEquals(result.poolUsedCount, 42);
  });

  // 5. Header double meta-page: higher generation wins
  TEST('ShardFormat', 'header double meta-page higher gen wins', () => {
    const buf = allocBuf();
    writeShardHeader(buf, 0, makeHeader({ generation: 1, lastAge: 10 }));
    writeShardHeader(buf, 1, makeHeader({ generation: 2, lastAge: 20 }));
    const result = readShardHeader(buf);
    assertEquals(result.generation, 2);
    assertEquals(result.lastAge, 20);
  });

  // 6. Header CRC32 fallback on corruption
  TEST('ShardFormat', 'header crc32 fallback on corruption', () => {
    const buf = allocBuf();
    writeShardHeader(buf, 0, makeHeader({ generation: 1, lastAge: 10 }));
    writeShardHeader(buf, 1, makeHeader({ generation: 2, lastAge: 20 }));
    // Corrupt copy 1 (higher gen) by flipping a byte
    buf[SHARD_HEADER_SIZE + 5] ^= 0xff;
    const result = readShardHeader(buf);
    // Falls back to copy 0
    assertEquals(result.generation, 1);
    assertEquals(result.lastAge, 10);
  });

  // 7. Header both corrupt throws
  TEST('ShardFormat', 'header both corrupt throws', () => {
    const buf = allocBuf();
    writeShardHeader(buf, 0, makeHeader({ generation: 1 }));
    writeShardHeader(buf, 1, makeHeader({ generation: 2 }));
    // Corrupt both copies
    buf[5] ^= 0xff;
    buf[SHARD_HEADER_SIZE + 5] ^= 0xff;
    assertThrows(() => readShardHeader(buf));
  });

  // 8. updateShardHeader alternation
  TEST('ShardFormat', 'updateShardHeader alternation', () => {
    const buf = allocBuf();
    const h = makeHeader({ generation: 0 });
    // First update: both copies are empty/corrupt, writes to copy 0
    updateShardHeader(buf, h);
    let result = readShardHeader(buf);
    assertEquals(result.generation, 1);

    // Second update: writes to copy 1 (copy 0 has gen=1)
    h.lastAge = 99;
    updateShardHeader(buf, h);
    result = readShardHeader(buf);
    assertEquals(result.generation, 2);
    assertEquals(result.lastAge, 99);

    // Third update: writes to copy 0 (copy 1 has gen=2, copy 0 has gen=1)
    h.lastAge = 200;
    updateShardHeader(buf, h);
    result = readShardHeader(buf);
    assertEquals(result.generation, 3);
    assertEquals(result.lastAge, 200);
  });

  // 9. Pool entry round-trip (own commit with parents + ancestors)
  TEST('ShardFormat', 'pool entry round-trip', () => {
    const buf = allocBuf();
    const entry = makePoolEntry({
      parent0: 5,
      parent1: 10,
      ancestor0: 2,
      ancestor1: 8,
      key: 'my-item-key',
    });
    writePoolEntry(buf, 0, entry, cfg);
    const result = readPoolEntry(buf, 0, cfg);
    assertEquals(result.id, entry.id);
    assertEquals(result.parent0, 5);
    assertEquals(result.parent1, 10);
    assertEquals(result.ancestor0, 2);
    assertEquals(result.ancestor1, 8);
    assertEquals(result.key, 'my-item-key');
  });

  // 10. Pool entry with POOL_NONE edges
  TEST('ShardFormat', 'pool entry with POOL_NONE edges', () => {
    const buf = allocBuf();
    const entry = makePoolEntry();
    writePoolEntry(buf, 0, entry, cfg);
    const result = readPoolEntry(buf, 0, cfg);
    assertEquals(result.parent0, POOL_NONE);
    assertEquals(result.parent1, POOL_NONE);
    assertEquals(result.ancestor0, POOL_NONE);
    assertEquals(result.ancestor1, POOL_NONE);
  });

  // 11. Pool entry foreign ref (keyLen=0, all edges POOL_NONE)
  TEST('ShardFormat', 'pool entry foreign ref', () => {
    const buf = allocBuf();
    const entry = makePoolEntry({ key: '' });
    writePoolEntry(buf, 3, entry, cfg);
    const result = readPoolEntry(buf, 3, cfg);
    assertEquals(result.id, entry.id);
    assertEquals(result.key, '');
    assertEquals(result.parent0, POOL_NONE);
  });

  // 12. Pool entry max key length
  TEST('ShardFormat', 'pool entry max key length', () => {
    const buf = allocBuf();
    const maxKey = 'a'.repeat(MAX_KEY_LEN);
    const entry = makePoolEntry({ key: maxKey });
    writePoolEntry(buf, 0, entry, cfg);
    const result = readPoolEntry(buf, 0, cfg);
    assertEquals(result.key, maxKey);
    assertEquals(result.key.length, MAX_KEY_LEN);
  });

  // 13. Pool entry key exceeds MAX_KEY_LEN throws
  TEST('ShardFormat', 'pool entry key exceeds max throws', () => {
    const buf = allocBuf();
    const entry = makePoolEntry({ key: 'a'.repeat(MAX_KEY_LEN + 1) });
    assertThrows(() => writePoolEntry(buf, 0, entry, cfg));
  });

  // 14. poolEntryIsEmpty on fresh vs written entry
  TEST('ShardFormat', 'poolEntryIsEmpty', () => {
    const buf = allocBuf();
    assertTrue(poolEntryIsEmpty(buf, 0, cfg));
    writePoolEntry(buf, 0, makePoolEntry(), cfg);
    assertTrue(!poolEntryIsEmpty(buf, 0, cfg));
  });

  // 15. Pool entry ID length is exactly COMMIT_ID_LEN
  TEST('ShardFormat', 'pool entry id length', () => {
    const buf = allocBuf();
    assertEquals(COMMIT_ID_LEN, 24);
    const entry = makePoolEntry({ id: 'x'.repeat(24) });
    writePoolEntry(buf, 0, entry, cfg);
    const result = readPoolEntry(buf, 0, cfg);
    assertEquals(result.id.length, 24);
  });

  // 16. writePoolEntry rejects wrong-length commit IDs
  TEST('ShardFormat', 'writePoolEntry rejects wrong-length ID', () => {
    const buf = allocBuf();
    const short = makePoolEntry({ id: 'x'.repeat(23) });
    assertThrows(() => writePoolEntry(buf, 0, short, cfg));
    const long = makePoolEntry({ id: 'x'.repeat(25) });
    assertThrows(() => writePoolEntry(buf, 0, long, cfg));
  });

  // 17. Index slot round-trip (new 32B format)
  TEST('ShardFormat', 'index slot round-trip', () => {
    const buf = allocBuf();
    const slot = makeSlot({ poolIdx: 42, flags: 0 });
    writeIndexSlot(buf, 0, slot, cfg);
    const result = readIndexSlot(buf, 0, cfg);
    assertEquals(result.poolIdx, 42);
    assertEquals(result.logDelta, slot.logDelta);
    assertEquals(result.commitLen, slot.commitLen);
    assertEquals(result.timestamp, slot.timestamp);
    assertEquals(result.flags, 0);
  });

  // 18. Index slot flags byte round-trip (has_overflow set/clear)
  TEST('ShardFormat', 'index slot flags round-trip', () => {
    const buf = allocBuf();
    const slot = makeSlot({ poolIdx: 1, flags: INDEX_OVERFLOW_FLAG });
    writeIndexSlot(buf, 0, slot, cfg);
    const result = readIndexSlot(buf, 0, cfg);
    assertEquals(result.flags & INDEX_OVERFLOW_FLAG, INDEX_OVERFLOW_FLAG);

    // Clear flag
    const slot2 = makeSlot({ poolIdx: 2, flags: 0 });
    writeIndexSlot(buf, 1, slot2, cfg);
    const result2 = readIndexSlot(buf, 1, cfg);
    assertEquals(result2.flags & INDEX_OVERFLOW_FLAG, 0);
  });

  // 19. Index lookup through pool dereference
  TEST('ShardFormat', 'index lookup through pool dereference', () => {
    const buf = allocBuf();
    const commitId = 'commit-abc-1234567890abc';
    // Write pool entry at index 0
    writePoolEntry(buf, 0, makePoolEntry({ id: commitId, key: 'k' }), cfg);
    // Insert index slot pointing to pool entry 0
    const slot = makeSlot({ poolIdx: 0 });
    indexInsert(buf, slot, commitId, 0, cfg);

    // Lookup should find it
    const found = indexLookup(buf, commitId, cfg);
    assertTrue(found >= 0);
    const result = readIndexSlot(buf, found, cfg);
    assertEquals(result.poolIdx, 0);

    // Miss
    assertEquals(indexLookup(buf, 'nonexistent-id-000000000', cfg), -1);
  });

  // 20. Index insert + lookup end-to-end (multiple entries)
  TEST('ShardFormat', 'index insert lookup end-to-end', () => {
    const buf = allocBuf();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = 'id-' + String(i).padStart(20, '0') + '0';
      ids.push(id);
      writePoolEntry(buf, i, makePoolEntry({ id, key: 'key-' + i }), cfg);
      indexInsert(
        buf,
        makeSlot({ poolIdx: i, logDelta: i * 100 }),
        id,
        i,
        cfg,
      );
    }
    // All should be found
    for (let i = 0; i < ids.length; i++) {
      const found = indexLookup(buf, ids[i], cfg);
      assertTrue(found >= 0);
      const result = readIndexSlot(buf, found, cfg);
      assertEquals(result.poolIdx, i);
      assertEquals(result.logDelta, i * 100);
    }
  });

  // 21. Index collision resolution via pool dereference
  TEST('ShardFormat', 'index collision resolution', () => {
    const buf = allocBuf();
    // Insert multiple entries -- linear probing handles collisions
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = 'col-' + String(i).padStart(19, '0') + '0';
      ids.push(id);
      writePoolEntry(buf, i, makePoolEntry({ id, key: 'k' }), cfg);
      indexInsert(buf, makeSlot({ poolIdx: i, logDelta: i }), id, i, cfg);
    }
    for (let i = 0; i < ids.length; i++) {
      const found = indexLookup(buf, ids[i], cfg);
      assertTrue(found >= 0);
      assertEquals(readIndexSlot(buf, found, cfg).logDelta, i);
    }
  });

  // 22. Index load factors 0.1, 0.5, 0.66 -- all lookups succeed
  TEST('ShardFormat', 'index load factors', () => {
    // Use a smaller config for this test to keep memory reasonable
    const smallCfg = makeShardConfig({ maxCommits: 200 });
    for (const loadFraction of [0.1, 0.5, 0.66]) {
      const capacity = smallCfg.maxSlots; // 300
      const count = Math.floor(capacity * loadFraction);
      const buf = allocBuf(smallCfg);
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = 'lf-' + String(i).padStart(20, '0') + '0';
        ids.push(id);
        writePoolEntry(buf, i, makePoolEntry({ id, key: 'k' }), smallCfg);
        indexInsert(
          buf,
          makeSlot({ poolIdx: i, logDelta: i }),
          id,
          i,
          smallCfg,
        );
      }
      for (let i = 0; i < ids.length; i++) {
        const found = indexLookup(buf, ids[i], smallCfg);
        assertTrue(found >= 0);
        assertEquals(readIndexSlot(buf, found, smallCfg).logDelta, i);
      }
    }
  });

  // 23. Index insert beyond 0.67 throws
  TEST('ShardFormat', 'index insert beyond 0.67 throws', () => {
    const smallCfg = makeShardConfig({ maxCommits: 20 });
    const capacity = smallCfg.maxSlots; // 30
    const maxLoad = Math.floor(capacity * 2 / 3);
    const buf = allocBuf(smallCfg);
    for (let i = 0; i < maxLoad; i++) {
      const id = 'fill' + String(i).padStart(19, '0') + '0';
      writePoolEntry(buf, i, makePoolEntry({ id, key: 'k' }), smallCfg);
      indexInsert(buf, makeSlot({ poolIdx: i }), id, i, smallCfg);
    }
    const overflowId = 'overflow-id-000000000000';
    writePoolEntry(
      buf,
      maxLoad,
      makePoolEntry({ id: overflowId, key: 'k' }),
      smallCfg,
    );
    assertThrows(() =>
      indexInsert(
        buf,
        makeSlot({ poolIdx: maxLoad }),
        overflowId,
        maxLoad,
        smallCfg,
      )
    );
  });

  // 24. Duplicate commit ID insert throws
  TEST('ShardFormat', 'index insert duplicate id throws', () => {
    const buf = allocBuf();
    const id = 'dup-key-id-0000000000abc';
    writePoolEntry(buf, 0, makePoolEntry({ id, key: 'k' }), cfg);
    indexInsert(buf, makeSlot({ poolIdx: 0 }), id, 0, cfg);
    writePoolEntry(buf, 1, makePoolEntry({ id, key: 'k2' }), cfg);
    assertThrows(() => indexInsert(buf, makeSlot({ poolIdx: 1 }), id, 1, cfg));
  });

  // 25. itemPathIsValid rejects >39 char components
  TEST('ShardFormat', 'itemPathIsValid rejects long components', () => {
    assertEquals(
      itemPathIsValid('/sys/' + 'a'.repeat(39) + '/item'),
      true,
    );
    assertEquals(
      itemPathIsValid('/sys/' + 'a'.repeat(40) + '/item'),
      false,
    );
  });

  // 26. Constants chain consistency (via config properties)
  TEST('ShardFormat', 'constants chain consistency', () => {
    assertEquals(cfg.poolRegionOffset, SHARD_DOUBLE_HEADER_SIZE);
    assertEquals(
      cfg.indexRegionOffset,
      cfg.poolRegionOffset + cfg.poolRegionSize,
    );
    assertEquals(
      cfg.defaultLogOffset,
      cfg.indexRegionOffset + cfg.indexRegionSize,
    );
    assertEquals(cfg.poolRegionSize, cfg.maxPool * POOL_ENTRY_SIZE);
    assertEquals(cfg.indexRegionSize, cfg.maxSlots * INDEX_SLOT_SIZE);
    assertEquals(INDEX_SLOT_SIZE, 32);
    assertEquals(POOL_ENTRY_SIZE, 80);
    assertEquals(COMMIT_ID_LEN, 24);
    assertEquals(cfg.maxPool, 250000);
    assertEquals(
      cfg.defaultLogOffset,
      128 + 250000 * 80 + 150000 * 32,
    );
  });

  // 27. Pool split threshold
  TEST('ShardFormat', 'pool split threshold', () => {
    assertEquals(cfg.poolSplitThreshold, Math.floor(cfg.maxPool * 0.75));
    assertEquals(cfg.splitThreshold, 75000);
  });

  // 28. Full shard: pool full vs index full
  TEST('ShardFormat', 'full shard conditions', () => {
    // Pool full condition
    assertTrue(cfg.maxPool > cfg.maxCommits);
    assertTrue(cfg.poolSplitThreshold > cfg.splitThreshold);
    // Index full at 0.67 load
    const maxLoad = Math.floor(cfg.maxSlots * 2 / 3);
    assertEquals(maxLoad, 100000);
  });

  // 29. initIndexRegion marks all slots empty
  TEST('ShardFormat', 'initIndexRegion marks slots empty', () => {
    const smallCfg = makeShardConfig({ maxCommits: 34 });
    const buf = allocBuf(smallCfg);
    for (let i = 0; i < smallCfg.maxSlots; i++) {
      const base = smallCfg.indexRegionOffset + i * INDEX_SLOT_SIZE;
      // poolIdx should be POOL_NONE
      const poolIdx = (buf[base]) |
        (buf[base + 1] << 8) |
        (buf[base + 2] << 16) |
        ((buf[base + 3] << 24) >>> 0);
      assertEquals(poolIdx >>> 0, POOL_NONE);
    }
  });

  // 30. Pool entry multiple slots isolation
  TEST('ShardFormat', 'pool entries do not overlap', () => {
    const buf = allocBuf();
    const e0 = makePoolEntry({ id: 'aaaa1111222233334444aaaa', key: 'key-a' });
    const e1 = makePoolEntry({ id: 'bbbb5555666677778888bbbb', key: 'key-b' });
    writePoolEntry(buf, 0, e0, cfg);
    writePoolEntry(buf, 1, e1, cfg);
    const r0 = readPoolEntry(buf, 0, cfg);
    const r1 = readPoolEntry(buf, 1, cfg);
    assertEquals(r0.id, e0.id);
    assertEquals(r0.key, 'key-a');
    assertEquals(r1.id, e1.id);
    assertEquals(r1.key, 'key-b');
  });

  // 31. makeShardConfig produces correct derived values for server (100K)
  TEST('ShardFormat', 'makeShardConfig server defaults', () => {
    const c = makeShardConfig();
    assertEquals(c.maxCommits, 100_000);
    assertEquals(c.splitThreshold, 75_000);
    assertEquals(c.minCommits, 10_000);
    assertEquals(c.maxPool, 250_000);
    assertEquals(c.poolSplitThreshold, 187_500);
    assertEquals(c.maxSlots, 150_000);
    assertEquals(c.poolRegionOffset, SHARD_DOUBLE_HEADER_SIZE);
    assertEquals(c.poolRegionSize, 250_000 * POOL_ENTRY_SIZE);
    assertEquals(
      c.indexRegionOffset,
      SHARD_DOUBLE_HEADER_SIZE + 250_000 * POOL_ENTRY_SIZE,
    );
    assertEquals(c.indexRegionSize, 150_000 * INDEX_SLOT_SIZE);
  });

  // 32. makeShardConfig produces correct derived values for browser (25K)
  TEST('ShardFormat', 'makeShardConfig browser defaults', () => {
    const c = makeShardConfig({ maxCommits: 25_000 });
    assertEquals(c.maxCommits, 25_000);
    assertEquals(c.splitThreshold, 18_750);
    assertEquals(c.minCommits, 2_500);
    assertEquals(c.maxPool, 62_500);
    assertEquals(c.maxSlots, 37_500);
    assertEquals(c.poolRegionSize, 62_500 * POOL_ENTRY_SIZE);
    assertEquals(c.indexRegionSize, 37_500 * INDEX_SLOT_SIZE);
    // Total metadata ~6.2 MB
    const totalMeta = c.poolRegionSize + c.indexRegionSize;
    assertTrue(totalMeta < 7_000_000);
    assertTrue(totalMeta > 6_000_000);
  });

  // 33. Smaller config rejects out-of-bounds pool access
  TEST('ShardFormat', 'small config rejects out-of-bounds pool', () => {
    const smallCfg = makeShardConfig({ maxCommits: 10 });
    const buf = allocBuf(smallCfg);
    // maxPool = floor(10 * 2.5) = 25
    assertEquals(smallCfg.maxPool, 25);
    // Writing at index 24 should work, index 25 should fail
    writePoolEntry(buf, 24, makePoolEntry(), smallCfg);
    assertThrows(() => writePoolEntry(buf, 25, makePoolEntry(), smallCfg));
    assertThrows(() => readPoolEntry(buf, 25, smallCfg));
    assertThrows(() => poolEntryIsEmpty(buf, 25, smallCfg));
  });

  // 34. Smaller config rejects out-of-bounds index access
  TEST('ShardFormat', 'small config rejects out-of-bounds index', () => {
    const smallCfg = makeShardConfig({ maxCommits: 10 });
    const buf = allocBuf(smallCfg);
    // maxSlots = floor(10 * 1.5) = 15
    assertEquals(smallCfg.maxSlots, 15);
    assertThrows(() => readIndexSlot(buf, 15, smallCfg));
    assertThrows(() =>
      writeIndexSlot(buf, 15, makeSlot({ poolIdx: 0 }), smallCfg)
    );
  });

  // 35. SERVER_SHARD_CONFIG and BROWSER_SHARD_CONFIG are distinct
  TEST('ShardFormat', 'preset configs differ', () => {
    assertEquals(SERVER_SHARD_CONFIG.maxCommits, 100_000);
    assertEquals(BROWSER_SHARD_CONFIG.maxCommits, 25_000);
    assertTrue(
      SERVER_SHARD_CONFIG.defaultLogOffset >
        BROWSER_SHARD_CONFIG.defaultLogOffset,
    );
  });
}
