import { assertEquals, assertThrows, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import { crc32 } from '../base/crc32.ts';
import { cyrb64, cyrb64u64, SHARD_HASH_SEED } from '../base/hash.ts';
import {
  commitIdHash,
  DEFAULT_LOG_OFFSET,
  INDEX_REGION_OFFSET,
  INDEX_SLOT_SIZE,
  indexInsert,
  indexLookup,
  MAX_KEY_LEN,
  MAX_SLOTS,
  readIndexSlot,
  readShardHeader,
  SHARD_DOUBLE_HEADER_SIZE,
  SHARD_HEADER_SIZE,
  SHARD_MAGIC,
  SHARD_VERSION,
  updateShardHeader,
  writeIndexSlot,
  writeShardHeader,
} from '../repo/shard-format.ts';
import type { IndexSlot, ShardHeader } from '../repo/shard-format.ts';
import { itemPathIsValid } from '../db/path.ts';

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
    logOffset: DEFAULT_LOG_OFFSET,
    createdAt: 1700000000000,
    crc32: 0,
    ...overrides,
  };
}

function makeSlot(overrides?: Partial<IndexSlot>): IndexSlot {
  return {
    idHashHigh: 0xdeadbeef,
    idHashLow: 0xcafebabe,
    logDelta: 1024,
    commitLen: 256,
    timestamp: 1700000000000,
    key: 'test',
    ...overrides,
  };
}

// Allocate a buffer large enough for headers + some index slots
function allocBuf(slots = 200): Uint8Array {
  return new Uint8Array(
    SHARD_DOUBLE_HEADER_SIZE + slots * INDEX_SLOT_SIZE,
  );
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

  // 4. Header round-trip
  TEST('ShardFormat', 'header round-trip', () => {
    const buf = allocBuf(0);
    const header = makeHeader();
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
  });

  // 5. Header double meta-page: higher generation wins
  TEST('ShardFormat', 'header double meta-page higher gen wins', () => {
    const buf = allocBuf(0);
    writeShardHeader(buf, 0, makeHeader({ generation: 1, lastAge: 10 }));
    writeShardHeader(buf, 1, makeHeader({ generation: 2, lastAge: 20 }));
    const result = readShardHeader(buf);
    assertEquals(result.generation, 2);
    assertEquals(result.lastAge, 20);
  });

  // 6. Header CRC32 fallback on corruption
  TEST('ShardFormat', 'header crc32 fallback on corruption', () => {
    const buf = allocBuf(0);
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
    const buf = allocBuf(0);
    writeShardHeader(buf, 0, makeHeader({ generation: 1 }));
    writeShardHeader(buf, 1, makeHeader({ generation: 2 }));
    // Corrupt both copies
    buf[5] ^= 0xff;
    buf[SHARD_HEADER_SIZE + 5] ^= 0xff;
    assertThrows(() => readShardHeader(buf));
  });

  // 8. updateShardHeader alternation
  TEST('ShardFormat', 'updateShardHeader alternation', () => {
    const buf = allocBuf(0);
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

  // 9. Index slot round-trip
  TEST('ShardFormat', 'index slot round-trip', () => {
    const buf = allocBuf();
    const slot = makeSlot();
    writeIndexSlot(buf, 0, slot);
    const result = readIndexSlot(buf, 0);
    assertEquals(result.idHashHigh, slot.idHashHigh);
    assertEquals(result.idHashLow, slot.idHashLow);
    assertEquals(result.logDelta, slot.logDelta);
    assertEquals(result.commitLen, slot.commitLen);
    assertEquals(result.timestamp, slot.timestamp);
    assertEquals(result.key, slot.key);
  });

  // 10. Index slot MAX_KEY_LEN boundary (39 bytes)
  TEST('ShardFormat', 'index slot max key length boundary', () => {
    const buf = allocBuf();
    const maxKey = 'a'.repeat(MAX_KEY_LEN); // 39 chars
    const slot = makeSlot({ key: maxKey });
    writeIndexSlot(buf, 0, slot);
    const result = readIndexSlot(buf, 0);
    assertEquals(result.key.length, MAX_KEY_LEN);
    assertEquals(result.key, maxKey);
  });

  // 11. Index slot empty key (0 bytes)
  TEST('ShardFormat', 'index slot empty key', () => {
    const buf = allocBuf();
    const slot = makeSlot({ key: '' });
    writeIndexSlot(buf, 0, slot);
    const result = readIndexSlot(buf, 0);
    assertEquals(result.key.length, 0);
    assertEquals(result.key, '');
  });

  // 12. Index lookup hit and miss
  TEST('ShardFormat', 'index lookup hit and miss', () => {
    const buf = allocBuf();
    const capacity = 200;
    const [h, l] = commitIdHash('commit-abc');
    const slot = makeSlot({ idHashHigh: h, idHashLow: l });
    writeIndexSlot(buf, (l >>> 0) % capacity, slot);

    // Hit
    const found = indexLookup(buf, h, l, capacity);
    assertTrue(found >= 0);
    const result = readIndexSlot(buf, found);
    assertEquals(result.idHashHigh, h);
    assertEquals(result.idHashLow, l);

    // Miss
    const [mh, ml] = commitIdHash('nonexistent');
    assertEquals(indexLookup(buf, mh, ml, capacity), -1);
  });

  // 13. Index collision resolution
  TEST('ShardFormat', 'index collision resolution', () => {
    const buf = allocBuf();
    const capacity = 200;
    // Force multiple entries into the same start slot by using
    // hashes that map to the same bucket
    const baseSlot = (0xcafe0000 >>> 0) % capacity;
    const entries: IndexSlot[] = [];
    for (let i = 0; i < 5; i++) {
      // Craft hashes that all land on the same start slot
      const fakeLow = baseSlot + i * capacity;
      const slot = makeSlot({
        idHashHigh: 0xaa000000 + i,
        idHashLow: fakeLow >>> 0,
        logDelta: i * 100,
      });
      entries.push(slot);
      indexInsert(buf, slot, i, capacity);
    }
    // All entries should be found
    for (const entry of entries) {
      const idx = indexLookup(
        buf,
        entry.idHashHigh,
        entry.idHashLow,
        capacity,
      );
      assertTrue(idx >= 0);
      const result = readIndexSlot(buf, idx);
      assertEquals(result.logDelta, entry.logDelta);
    }
  });

  // 14. Index load factors 0.1, 0.5, 0.67 -- all lookups succeed
  TEST('ShardFormat', 'index load factors', () => {
    for (const loadFraction of [0.1, 0.5, 0.66]) {
      const capacity = 300;
      const count = Math.floor(capacity * loadFraction);
      const buf = new Uint8Array(
        INDEX_REGION_OFFSET + capacity * INDEX_SLOT_SIZE,
      );
      const inserted: Array<[number, number]> = [];
      for (let i = 0; i < count; i++) {
        const [h, l] = commitIdHash('load-test-' + i);
        const slot = makeSlot({ idHashHigh: h, idHashLow: l, logDelta: i });
        indexInsert(buf, slot, i, capacity);
        inserted.push([h, l]);
      }
      // Verify all lookups succeed
      for (let i = 0; i < inserted.length; i++) {
        const [h, l] = inserted[i];
        const idx = indexLookup(buf, h, l, capacity);
        assertTrue(idx >= 0);
        const result = readIndexSlot(buf, idx);
        assertEquals(result.logDelta, i);
      }
    }
  });

  // 15. Index insert beyond 0.67 throws
  TEST('ShardFormat', 'index insert beyond 0.67 throws', () => {
    const capacity = 30;
    const maxLoad = Math.floor(capacity * 2 / 3); // 20
    const buf = new Uint8Array(
      INDEX_REGION_OFFSET + capacity * INDEX_SLOT_SIZE,
    );
    // Fill to max load
    for (let i = 0; i < maxLoad; i++) {
      const [h, l] = commitIdHash('fill-' + i);
      indexInsert(
        buf,
        makeSlot({ idHashHigh: h, idHashLow: l }),
        i,
        capacity,
      );
    }
    // One more should throw
    const [h, l] = commitIdHash('overflow');
    assertThrows(() =>
      indexInsert(
        buf,
        makeSlot({ idHashHigh: h, idHashLow: l }),
        maxLoad,
        capacity,
      )
    );
  });

  // 16. Duplicate idHash insert throws
  TEST('ShardFormat', 'index insert duplicate hash throws', () => {
    const buf = allocBuf();
    const capacity = 200;
    const [h, l] = commitIdHash('dup-key');
    const slot = makeSlot({ idHashHigh: h, idHashLow: l });
    indexInsert(buf, slot, 0, capacity);
    assertThrows(() => indexInsert(buf, slot, 1, capacity));
  });

  // 17. itemPathIsValid rejects >39 char components
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
}
