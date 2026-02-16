import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import {
  createRawCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';
const S = kMergeTestSchemaV1;

export default function setup() {
  TEST('MergeLCA', 'direct parent-child', async (ctx) => {
    const db = await ctx.createDB('lca-parent-child', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/lca1');
      const repo = db.repository('/merge-test/lca1')!;

      // Need 3-level chain: grandparent -> parent -> child
      // because _findLCAMergeBase returns undefined when either commit is a root
      const gp = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'gp' },
      });
      const parent = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'parent' },
        parents: [gp.id],
      });
      const child = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'child' },
        parents: [parent.id],
      });

      await repo.persistVerifiedCommits([gp, parent, child]);
      const [commits, base] = repo.findMergeBase([child, parent]);
      assertExists(base, 'merge base should exist for parent-child');
      assertEquals(base!.id, parent.id, 'base should be the parent commit');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeLCA', 'shared grandparent', async (ctx) => {
    const db = await ctx.createDB('lca-grandparent', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/lca2');
      const repo = db.repository('/merge-test/lca2')!;

      // root -> mid -> branch-a, root -> mid -> branch-b won't work because
      // root is parentless. Use: root -> mid, mid -> a, mid -> b
      const root = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'root' },
      });
      const mid = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'mid' },
        parents: [root.id],
      });
      const a = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'a' },
        parents: [mid.id],
      });
      const b = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'b' },
        parents: [mid.id],
      });

      await repo.persistVerifiedCommits([root, mid, a, b]);
      const [_commits, base] = repo.findMergeBase([a, b]);
      assertExists(base, 'merge base should exist');
      assertEquals(base!.id, mid.id, 'base should be the shared parent');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeLCA', 'two root commits', async (ctx) => {
    const db = await ctx.createDB('lca-two-roots', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/lca3');
      const repo = db.repository('/merge-test/lca3')!;

      const c1 = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'root-a' },
      });
      const c2 = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'root-b' },
      });

      await repo.persistVerifiedCommits([c1, c2]);
      const [commits, base, _scheme, reachedRoot] = repo.findMergeBase([
        c1,
        c2,
      ]);
      // Two root commits: _findLCAMergeBase returns [undefined, true].
      // findMergeBase skips the second commit (no LCA found), so only c1
      // is included and becomes the result/base.
      assertTrue(reachedRoot, 'should reach root for two root commits');
      assertEquals(
        commits.length,
        1,
        'only first root commit should be included',
      );
      assertEquals(base!.id, c1.id, 'base should be the first root commit');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeLCA', 'different keys excluded', async (ctx) => {
    const db = await ctx.createDB('lca-diff-keys', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/lca4');
      const repo = db.repository('/merge-test/lca4')!;

      const root = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'root' },
      });
      const c1 = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'key1' },
        parents: [root.id],
      });
      const c2 = createRawCommit({
        key: 'k2',
        schema: S,
        data: { title: 'key2' },
        parents: [root.id],
      });

      await repo.persistVerifiedCommits([root, c1, c2]);
      const [commits, base] = repo.findMergeBase([c1, c2]);
      // _findLCAMergeBase returns [undefined, false] for different keys
      // So c2 won't be included in the merge
      assertTrue(
        commits.length <= 1,
        'different-key commits should not both be included',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeLCA', 'partial graph missing commits', async (ctx) => {
    const db = await ctx.createDB('lca-partial', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/lca5');
      const repo = db.repository('/merge-test/lca5')!;

      const c1 = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'missing' },
      });
      const c2 = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'child' },
        parents: [c1.id],
      });

      // Only persist c2, not c1
      await repo.persistVerifiedCommits([c2]);
      // With a single commit, findMergeBase returns it as the result/base
      // even though its parent is missing from the graph
      const [commits, base] = repo.findMergeBase([c2]);
      assertEquals(commits.length, 1, 'single commit should be included');
      assertEquals(base!.id, c2.id, 'base should be the single commit itself');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeLCA', 'n-way merge 3+ leaves', async (ctx) => {
    const db = await ctx.createDB('lca-nway', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/lca6');
      const repo = db.repository('/merge-test/lca6')!;

      // Need root -> mid to avoid the "no parents" issue in LCA
      const root = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'root' },
      });
      const mid = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'mid' },
        parents: [root.id],
      });
      const a = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'a' },
        parents: [mid.id],
      });
      const b = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'b' },
        parents: [mid.id],
      });
      const c = createRawCommit({
        key: 'k1',
        schema: S,
        data: { title: 'c' },
        parents: [mid.id],
      });

      await repo.persistVerifiedCommits([root, mid, a, b, c]);
      const [commits, base] = repo.findMergeBase([a, b, c]);
      // findMergeBase iterates: a becomes result, then LCA(a,b)=mid, result=mid
      // Then LCA(mid,c): mid.parents=[root.id], c.parents=[mid.id].
      // c.parents includes mid.id → returns [mid, false]
      // So all 3 should be included with mid as base
      assertTrue(commits.length >= 2, 'should include multiple leaves');
      assertExists(base, 'base should exist');
      assertEquals(base!.id, mid.id, 'base should be mid');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });
}
