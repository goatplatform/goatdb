import { TEST } from './mod.ts';
import { AdjacencyList } from '../base/adj-list.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import {
  createRawCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
  waitForMerge,
} from './merge-test-utils.ts';

export default function setup() {
  TEST(
    'AncestorLeafDetection',
    'ancestor in-edge prevents leaf status',
    () => {
      const adj = new AdjacencyList();
      adj.addEdge('child', 'target', 'ancestor');
      assertTrue(
        adj.hasInEdges('target'),
        'target should have in-edges after ancestor edge added',
      );
    },
  );

  TEST(
    'AncestorLeafDetection',
    'ancestor-only in-edge prevents false leaf during partial sync',
    () => {
      const adj = new AdjacencyList();
      // Simulate: commit B exists, its parent C is missing,
      // but commit D has B in its ancestors array
      adj.addEdge('D', 'B', 'ancestor');
      // B has no parent in-edges (C not synced), only ancestor in-edge from D
      assertTrue(
        adj.hasInEdges('B'),
        'B must not be a leaf: ancestor edge from D prevents partition',
      );
    },
  );

  TEST('AncestorLeafDetection', 'parent in-edge prevents leaf status', () => {
    const adj = new AdjacencyList();
    adj.addEdge('child', 'target', 'parent');
    assertTrue(
      adj.hasInEdges('target'),
      'target should have in-edges after parent edge added',
    );
  });

  TEST('AncestorLeafDetection', 'no in-edges means leaf', () => {
    const adj = new AdjacencyList();
    // Only add an out-edge FROM target to something else
    adj.addEdge('target', 'other', 'parent');
    assertTrue(
      !adj.hasInEdges('target'),
      'target should have no in-edges when only out-edges exist',
    );
  });

  TEST(
    'AncestorLeafDetection',
    'removing parent keeps ancestor connectivity',
    () => {
      const adj = new AdjacencyList();
      adj.addEdge('child', 'target', 'parent');
      adj.addEdge('child', 'target', 'ancestor');
      // Delete the parent edge
      adj.deleteEdge('child', 'target', 'parent');
      assertTrue(
        adj.hasInEdges('target'),
        'target should still have in-edges via ancestor after parent removed',
      );
    },
  );

  TEST('AncestorLeafDetection', 'commitIsLeaf accuracy', async (ctx) => {
    const db = await ctx.createDB('bloom-leaf', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      const item = db.create('/merge-test/bloom-repo', kMergeTestSchemaV1, {
        title: 'first',
      });
      await db.flush('/merge-test/bloom-repo');

      item.set('title', 'second');
      await db.flush('/merge-test/bloom-repo');

      const repo = db.repository('/merge-test/bloom-repo')!;
      const head = repo.headForKey(item.key);
      assertTrue(head !== undefined, 'head should exist');

      assertTrue(
        repo.commitIsLeaf(head!),
        'head commit should be a leaf (no in-edges)',
      );

      const commits = Array.from(repo.commitsForKey(item.key));
      assertTrue(commits.length >= 2, 'should have at least 2 commits');
      const parent = commits[1];
      assertTrue(
        !repo.commitIsLeaf(parent),
        'parent commit should not be a leaf (has in-edges)',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'AncestorLeafDetection',
    'fixed-K ancestor chain correctness',
    async (ctx) => {
      const db = await ctx.createDB('bloom-ancestors', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/merge-test/anc-repo', kMergeTestSchemaV1, {
          title: 'c0',
        });
        await db.flush('/merge-test/anc-repo');
        for (let i = 1; i <= 4; i++) {
          item.set('title', `c${i}`);
          await db.flush('/merge-test/anc-repo');
        }

        const repo = db.repository('/merge-test/anc-repo')!;
        const commits = Array.from(repo.commitsForKey(item.key));
        const head = commits[0];
        const parent = head.parents[0];
        if (commits.length >= 3 && parent) {
          assertTrue(
            head.ancestors.length > 0,
            'head should have at least 1 ancestor for chain length >= 3',
          );
        }
        for (const ancId of head.ancestors) {
          assertTrue(
            repo.hasCommit(ancId),
            `ancestor ${ancId} should exist in repo`,
          );
        }
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'AncestorLeafDetection',
    'merge: secondary branch grandparent is not a leaf',
    async (ctx) => {
      const db = await ctx.createDB('leaf-merge-branch', {
        registry: kMergeTestRegistry,
      });
      await db.readyPromise();
      await db.open('/merge-test/leaf-merge');
      try {
        // Branch A: 2 local commits (c0 → c1)
        const item = db.create(
          '/merge-test/leaf-merge/item1',
          kMergeTestSchemaV1,
          { title: 'local-0', count: 0 },
        );
        await db.flush('/merge-test/leaf-merge');
        item.set('title', 'local-1');
        await db.flush('/merge-test/leaf-merge');

        const repo = db.repository('/merge-test/leaf-merge')!;

        // Branch B: independent 2-commit chain (r0 → r1).
        // Old timestamps ensure local session wins merge-leader election.
        const r0 = createRawCommit({
          key: item.key,
          schema: kMergeTestSchemaV1,
          data: { title: 'remote-0', count: 50 },
          parents: [],
          session: 'remote-session-leaf',
          timestamp: Date.now() - 10_000,
        });
        const r1 = createRawCommit({
          key: item.key,
          schema: kMergeTestSchemaV1,
          data: { title: 'remote-1', count: 51 },
          parents: [r0.id],
          session: 'remote-session-leaf',
          timestamp: Date.now() - 10_000,
        });
        await repo.persistVerifiedCommits([r0, r1]);
        await waitForMerge(repo, item.key);

        const head = repo.headForKey(item.key)!;
        assertExists(head, 'merged head must exist');
        assertTrue(
          head.parents.length > 1,
          'head must be a merge commit',
        );

        // r0 is grandparent of branch B: it must have an ancestor in-edge
        // from the merge commit, so it must NOT be a leaf.
        assertEquals(
          repo.commitIsLeaf(r0),
          false,
          'r0 (branch B grandparent) must not be a leaf after merge',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'AncestorLeafDetection',
    'via DB: grandparent referenced as ancestor is not a leaf',
    async (ctx) => {
      const db = await ctx.createDB('ancestor-leaf-db', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create(
          '/merge-test/ancestor-leaf-repo',
          kMergeTestSchemaV1,
          { title: 'v1' },
        );
        await db.flush('/merge-test/ancestor-leaf-repo');

        item.set('title', 'v2');
        await db.flush('/merge-test/ancestor-leaf-repo');

        item.set('title', 'v3');
        await db.flush('/merge-test/ancestor-leaf-repo');

        item.set('title', 'v4');
        await db.flush('/merge-test/ancestor-leaf-repo');

        const repo = db.repository('/merge-test/ancestor-leaf-repo')!;
        const commits = Array.from(repo.commitsForKey(item.key));
        assertTrue(
          commits.length >= 4,
          `expected at least 4 commits, got ${commits.length}`,
        );

        // commitsForKey returns commits in descending order (newest first)
        // commits[0] = head (leaf), commits[2] = grandparent
        const grandparent = commits[2];
        assertEquals(
          repo.commitIsLeaf(grandparent),
          false,
          'grandparent commit should not be a leaf',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
