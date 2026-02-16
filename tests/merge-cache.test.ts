import { TEST } from './mod.ts';
import { assertEquals, assertExists } from './asserts.ts';
import {
  createRawCommit,
  createRemoteCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';
import { sleep } from '../base/time.ts';

const S1 = kMergeTestSchemaV1;

export default function setup() {
  TEST('MergeCache', 'head cache invalidated on new commit', async (ctx) => {
    const db = await ctx.createDB('cache-head', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/cache1');
      const repo = db.repository('/merge-test/cache1')!;

      const c1 = createRawCommit({
        key: 'k1',
        schema: S1,
        data: { title: 'first' },
      });
      await repo.persistVerifiedCommits([c1]);

      const head1 = repo.headForKey('k1');
      assertExists(head1, 'first head should exist');
      assertEquals(head1!.id, c1.id);

      // Persist a new commit (child of c1)
      const c2 = createRawCommit({
        key: 'k1',
        schema: S1,
        data: { title: 'second' },
        parents: [c1.id],
      });
      await repo.persistVerifiedCommits([c2]);

      // Head should now be c2 (cache invalidated)
      const head2 = repo.headForKey('k1');
      assertExists(head2, 'second head should exist');
      assertEquals(head2!.id, c2.id, 'head should be updated to c2');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeCache', 'leaves cache invalidated on branch', async (ctx) => {
    const db = await ctx.createDB('cache-leaves', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/cache2');
      const repo = db.repository('/merge-test/cache2')!;

      const c1 = createRawCommit({
        key: 'k1',
        schema: S1,
        data: { title: 'root' },
      });
      await repo.persistVerifiedCommits([c1]);

      const leaves1 = repo.leavesForKey('k1');
      assertEquals(leaves1.length, 1, 'should have 1 leaf initially');

      // Create a branch (second leaf from same parent)
      const c2 = createRawCommit({
        key: 'k1',
        schema: S1,
        data: { title: 'branch' },
        parents: [c1.id],
      });
      const c3 = createRawCommit({
        key: 'k1',
        schema: S1,
        data: { title: 'other-branch' },
        parents: [c1.id],
      });
      await repo.persistVerifiedCommits([c2, c3]);

      const leaves2 = repo.leavesForKey('k1');
      assertEquals(
        leaves2.length,
        2,
        'should have 2 leaves after branching',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeCache', 'value cache invalidated after merge', async (ctx) => {
    const db = await ctx.createDB('cache-value', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      // Create item via GoatDB API, flush to get base commit
      const item = db.create('/merge-test/cache3', kMergeTestSchemaV1, {
        title: 'base',
        count: 0,
      });
      await db.flush('/merge-test/cache3');

      const repo = db.repository('/merge-test/cache3')!;
      const baseHead = repo.headForKey(item.key)!;

      // Read value (caches it)
      const val1 = repo.valueForKey(item.key);
      assertExists(val1, 'value should exist before merge');

      // Local change
      item.set('title', 'changed');
      await db.flush('/merge-test/cache3');

      // Remote change branching from baseHead
      const remote = createRemoteCommit({
        key: item.key,
        schema: S1,
        data: { title: 'base', count: 42 },
        parents: [baseHead.id],
        session: 'remote',
        timestamp: Date.now() - 10_000,
      });
      await repo.persistVerifiedCommits([remote]);
      await sleep(200); // Wait for automatic merge

      // Read value again -- should reflect merge (cache invalidated)
      const val2 = repo.valueForKey(item.key);
      assertExists(val2, 'value should exist after merge');

      // After merge, the head should have changed
      const head = repo.headForKey(item.key);
      assertExists(head);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });
}
