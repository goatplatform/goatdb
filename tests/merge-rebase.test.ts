import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import {
  createRemoteCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
  kMergeTestSchemaV2,
} from './merge-test-utils.ts';
import { sleep } from '../base/time.ts';

export default function setup() {
  TEST('MergeRebase', 'no concurrent changes', async (ctx) => {
    const db = await ctx.createDB('rebase-noconcurrent', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      // Create an item
      const item = db.create('/merge-test/rebase1', kMergeTestSchemaV1, {
        title: 'original',
        count: 0,
      });
      await db.flush('/merge-test/rebase1');

      const repo = db.repository('/merge-test/rebase1')!;
      const head = repo.headForKey(item.key)!;

      // Clone and modify locally
      const localItem = head.record!.clone();
      localItem.set('title' as any, 'local-edit');

      // Rebase with no concurrent changes (head hasn't moved)
      const [rebased] = repo.rebase(item.key, localItem, head.id);
      assertEquals(
        rebased.get('title' as any),
        'local-edit',
        'rebased should have local edit',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeRebase', 'non-overlapping changes preserved', async (ctx) => {
    const db = await ctx.createDB('rebase-nonoverlap', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      // Create item
      const item = db.create('/merge-test/rebase2', kMergeTestSchemaV1, {
        title: 'original',
        count: 0,
      });
      await db.flush('/merge-test/rebase2');

      const repo = db.repository('/merge-test/rebase2')!;
      const headBeforeRemote = repo.headForKey(item.key)!;

      // Simulate remote change: update count via the item
      item.set('count', 99);
      await db.flush('/merge-test/rebase2');

      // Clone from the OLD head (before remote change) and modify title
      const localItem = headBeforeRemote.record!.clone();
      localItem.set('title' as any, 'local-title');

      // Rebase local changes on top of new head
      const [rebased] = repo.rebase(item.key, localItem, headBeforeRemote.id);
      assertEquals(
        rebased.get('title' as any),
        'local-title',
        'local title change preserved',
      );
      assertEquals(
        rebased.get('count' as any),
        99,
        'remote count change preserved',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'MergeRebase',
    'V1 item + V2 head does not crash on rebase',
    async (ctx) => {
      // Regression test: when a V1 ManagedItem encounters a V2 head
      // in the repo, repo.rebase() returns a doc with V2 schema.
      // The old code called this._item.get('tags') which asserted.
      const db = await ctx.createDB('rebase-v1v2', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();

        // Create a V1 item and flush to establish a base commit.
        const item = db.create(
          '/merge-test/rebase-v1v2',
          kMergeTestSchemaV1,
          { title: 'v1-original', count: 0 },
        );
        await db.flush('/merge-test/rebase-v1v2');

        const repo = db.repository('/merge-test/rebase-v1v2')!;
        const baseHead = repo.headForKey(item.key)!;

        // Simulate a remote peer with a V2 commit (has 'tags' field)
        // branching from the same base.
        const remoteV2 = createRemoteCommit({
          key: item.key,
          schema: kMergeTestSchemaV2,
          data: {
            title: 'v2-remote',
            count: 99,
            tags: new Set(['regression']),
          },
          parents: [baseHead.id],
          session: 'remote-v2-peer',
          timestamp: Date.now() - 10_000,
        });
        await repo.persistVerifiedCommits([remoteV2]);
        await sleep(200); // Let auto-merge and rebase handler run

        // The ManagedItem must still be usable with no crash.
        assertTrue(item.exists, 'item should exist after rebase');
        const title = item.get('title');
        assertTrue(typeof title === 'string', 'title readable');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('MergeRebase', 'conflicting changes local wins', async (ctx) => {
    const db = await ctx.createDB('rebase-conflict', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      const item = db.create('/merge-test/rebase3', kMergeTestSchemaV1, {
        title: 'original',
        count: 0,
      });
      await db.flush('/merge-test/rebase3');

      const repo = db.repository('/merge-test/rebase3')!;
      const headBeforeRemote = repo.headForKey(item.key)!;

      // Remote change to title
      item.set('title', 'remote-title');
      await db.flush('/merge-test/rebase3');

      // Local change to the same field from old head
      const localItem = headBeforeRemote.record!.clone();
      localItem.set('title' as any, 'local-title');

      // Rebase: local changes should take priority
      const [rebased] = repo.rebase(item.key, localItem, headBeforeRemote.id);
      assertEquals(
        rebased.get('title' as any),
        'local-title',
        'local change should win in rebase conflict',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });
}
