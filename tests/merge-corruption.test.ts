import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import { kMergeTestRegistry, kMergeTestSchemaV1 } from './merge-test-utils.ts';
import { Commit } from '../repo/commit.ts';
import { Item } from '../cfds/base/item.ts';
import { Edit } from '../cfds/base/edit.ts';
import { BloomFilter } from '../base/bloom.ts';
function makeItem(title: string): Item {
  return new Item(
    {
      schema: kMergeTestSchemaV1,
      data: { title, count: 0 },
    },
    kMergeTestRegistry,
  );
}

export default function setup() {
  TEST('MergeCorruption', 'valid delta commit not corrupted', async (ctx) => {
    const db = await ctx.createDB('corruption-valid', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      // Create item via normal GoatDB flow to get a properly formed commit chain
      const item = db.create('/merge-test/corr1', kMergeTestSchemaV1, {
        title: 'original',
      });
      await db.flush('/merge-test/corr1');

      // Modify to produce a delta commit
      item.set('title', 'modified');
      await db.flush('/merge-test/corr1');

      const repo = db.repository('/merge-test/corr1')!;
      const head = repo.headForKey(item.key);
      assertExists(head, 'head should exist');
      // Valid commit should not be corrupted
      assertEquals(
        repo.commitIsCorrupted(head!),
        false,
        'valid commit should not be corrupted',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'MergeCorruption',
    'src checksum mismatch detected',
    async (ctx) => {
      const db = await ctx.createDB('corruption-src', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();
        await db.open('/merge-test/corr2');
        const repo = db.repository('/merge-test/corr2')!;

        // Create base document commit
        const baseItem = makeItem('base');
        const baseCommit = new Commit({
          session: 'sess',
          orgId: 'test-org',
          key: 'k1',
          contents: baseItem,
          parents: [],
          ancestorsFilter: BloomFilter.empty,
          ancestorsCount: 0,
        });

        // Create a delta commit with WRONG srcChecksum
        const dstItem = makeItem('modified');
        const edit = new Edit({
          changes: baseItem.diff(dstItem),
          srcChecksum: 'wrong-src-checksum', // Deliberately wrong
          dstChecksum: dstItem.checksum,
        });
        const deltaCommit = new Commit({
          session: 'sess',
          orgId: 'test-org',
          key: 'k1',
          contents: { base: baseCommit.id, edit },
          parents: [baseCommit.id],
          ancestorsFilter: BloomFilter.empty,
          ancestorsCount: 1,
        });

        await repo.persistVerifiedCommits([baseCommit, deltaCommit]);
        assertTrue(
          repo.commitIsCorrupted(deltaCommit),
          'delta with wrong srcChecksum should be corrupted',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'MergeCorruption',
    'dst checksum mismatch detected',
    async (ctx) => {
      const db = await ctx.createDB('corruption-dst', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();
        await db.open('/merge-test/corr3');
        const repo = db.repository('/merge-test/corr3')!;

        // Create base document commit
        const baseItem = makeItem('base');
        const baseCommit = new Commit({
          session: 'sess',
          orgId: 'test-org',
          key: 'k1',
          contents: baseItem,
          parents: [],
          ancestorsFilter: BloomFilter.empty,
          ancestorsCount: 0,
        });

        // Create a delta commit with correct src but WRONG dstChecksum
        const dstItem = makeItem('modified');
        const edit = new Edit({
          changes: baseItem.diff(dstItem),
          srcChecksum: baseItem.checksum,
          dstChecksum: 'wrong-dst-checksum', // Deliberately wrong
        });
        const deltaCommit = new Commit({
          session: 'sess',
          orgId: 'test-org',
          key: 'k1',
          contents: { base: baseCommit.id, edit },
          parents: [baseCommit.id],
          ancestorsFilter: BloomFilter.empty,
          ancestorsCount: 1,
        });

        await repo.persistVerifiedCommits([baseCommit, deltaCommit]);
        assertTrue(
          repo.commitIsCorrupted(deltaCommit),
          'delta with wrong dstChecksum should be corrupted',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
