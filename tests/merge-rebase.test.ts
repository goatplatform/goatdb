import { TEST } from './mod.ts';
import { assertEquals, assertExists } from './asserts.ts';
import { kMergeTestRegistry, kMergeTestSchemaV1 } from './merge-test-utils.ts';

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
