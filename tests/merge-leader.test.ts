import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import {
  createRemoteCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';
import { sleep } from '../base/time.ts';

const S1 = kMergeTestSchemaV1;

export default function setup() {
  TEST('MergeLeader', 'single active writer merges', async (ctx) => {
    const db = await ctx.createDB('leader-single', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      // Create item via GoatDB API, flush to get a base commit
      const item = db.create('/merge-test/leader1', kMergeTestSchemaV1, {
        title: 'base',
        count: 0,
      });
      await db.flush('/merge-test/leader1');

      const repo = db.repository('/merge-test/leader1')!;
      const baseHead = repo.headForKey(item.key)!;

      // Local change: update title
      item.set('title', 'updated');
      await db.flush('/merge-test/leader1');

      // Remote change branching from baseHead (same session simulates single writer)
      const remote = createRemoteCommit({
        key: item.key,
        schema: S1,
        data: { title: 'remote', count: 1 },
        parents: [baseHead.id],
        session: 'single-session',
        timestamp: Date.now() - 10_000,
      });
      await repo.persistVerifiedCommits([remote]);
      await sleep(200); // Wait for automatic merge

      // After automatic merge, leaves should be reduced
      const leaves = repo.leavesForKey(item.key);
      assertEquals(
        leaves.length,
        1,
        `after merge, should have exactly 1 leaf (got ${leaves.length})`,
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeLeader', 'deterministic leader election', async (ctx) => {
    const db = await ctx.createDB('leader-determ', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      // Create item via GoatDB API, flush to get a base commit
      const item = db.create('/merge-test/leader2', kMergeTestSchemaV1, {
        title: 'base',
        count: 0,
      });
      await db.flush('/merge-test/leader2');

      const repo = db.repository('/merge-test/leader2')!;
      const baseHead = repo.headForKey(item.key)!;

      // Local change
      item.set('title', 'local-change');
      await db.flush('/merge-test/leader2');

      // Remote change from a different session, branching from baseHead
      const remote = createRemoteCommit({
        key: item.key,
        schema: S1,
        data: { title: 'from-remote', count: 2 },
        parents: [baseHead.id],
        session: 'session-beta',
        timestamp: Date.now() - 10_000,
      });
      await repo.persistVerifiedCommits([remote]);
      await sleep(200); // Wait for automatic merge

      // Leader election should complete without errors.
      // The merged value should exist.
      const result = repo.valueForKey(item.key);
      assertExists(result, 'merged value should exist after leader election');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });
}
