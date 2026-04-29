import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import {
  createRawCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
  waitForMerge,
} from './merge-test-utils.ts';

const kAncestorsTestSchema: Schema = {
  ns: 'ancestors-test',
  version: 1,
  fields: {
    value: { type: 'string' },
  },
};
DataRegistry.default.registerSchema(kAncestorsTestSchema);

/**
 * Helper: build a linear commit chain by creating one item and flushing N times.
 * Returns db, repo, item path, and all commits ordered oldest-first.
 *
 * computeAncestors(parentId) returns up to K=2 skip pointers:
 *   - grandparent (parent's parent)
 *   - great-grandparent (parent's parent's parent)
 * So a chain of length N produces ancestors.length = min(N-2, 2) for N >= 2.
 */
async function buildChain(
  ctx: import('./mod.ts').TestSuite,
  testId: string,
  flushCount: number,
) {
  const db = await ctx.createDB(testId);
  await db.readyPromise();
  await db.open('/ancestors-test/chain');

  const item = db.create(
    '/ancestors-test/chain/item1',
    kAncestorsTestSchema,
    { value: 'v0' },
  );
  await db.flush('/ancestors-test/chain');

  for (let i = 1; i < flushCount; i++) {
    item.set('value', `v${i}`);
    await db.flush('/ancestors-test/chain');
  }

  const repo = db.repository('/ancestors-test/chain')!;
  assertExists(repo, 'repo must exist');

  // commitsForKey iteration order uses timestamp + random-id tiebreaker.
  // On fast CI runners rapid commits may collide on the same millisecond,
  // making any positional access into this array non-deterministic.
  // Tests should use repo.headForKey() and invariant checks instead.
  const commits = Array.from(repo.commitsForKey(item.key)).reverse();

  return { db, repo, item, commits };
}

export default function setup() {
  TEST('Ancestors', 'root commit has no ancestors', async (ctx) => {
    const { db, repo, item } = await buildChain(ctx, 'ancestors-root', 1);
    try {
      const head = repo.headForKey(item.key);
      assertExists(head, 'head must exist');
      assertEquals(head.ancestors.length, 0, 'root has no ancestors');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Ancestors', 'chain of 2 has no ancestors', async (ctx) => {
    // computeAncestors(parent) walks parent.parents[0] (grandparent).
    // Root has no parents, so grandparent is undefined → returns [].
    const { db, repo, item } = await buildChain(ctx, 'ancestors-chain2', 2);
    try {
      const head = repo.headForKey(item.key);
      assertExists(head, 'head must exist');
      assertEquals(
        head.ancestors.length,
        0,
        'chain of 2: head ancestors must be empty',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Ancestors', 'chain of 3 has 1 ancestor', async (ctx) => {
    // head's parent = commit2; commit2's parent = root → grandparent = root
    const { db, repo, item } = await buildChain(ctx, 'ancestors-chain3', 3);
    try {
      const allCommits = Array.from(repo.commitsForKey(item.key));
      assertEquals(allCommits.length, 3, 'should have exactly 3 commits');

      const head = repo.headForKey(item.key);
      assertExists(head, 'head must exist');
      assertEquals(
        head.ancestors.length,
        1,
        'chain of 3: head should have 1 ancestor (grandparent)',
      );

      // Find root among known commits (the one with no parents).
      const roots = allCommits.filter((c) => c.parents.length === 0);
      assertEquals(roots.length, 1, 'should have exactly 1 root');
      assertEquals(
        head.ancestors[0],
        roots[0].id,
        'ancestor[0] should be the root commit',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Ancestors', 'chain of 4 has 2 ancestors', async (ctx) => {
    // grandparent = commit2, great-grandparent = root
    const { db, repo, item } = await buildChain(ctx, 'ancestors-chain4', 4);
    try {
      const allCommits = Array.from(repo.commitsForKey(item.key));
      assertEquals(allCommits.length, 4, 'should have exactly 4 commits');

      const head = repo.headForKey(item.key);
      assertExists(head, 'head must exist');
      assertEquals(
        head.ancestors.length,
        2,
        'chain of 4: head should have 2 ancestors',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Ancestors', 'chain of 6+ caps at 2 ancestors', async (ctx) => {
    // computeAncestors only walks up to K=2 hops regardless of chain length
    const { db, repo, item } = await buildChain(ctx, 'ancestors-chain6', 6);
    try {
      const allCommits = Array.from(repo.commitsForKey(item.key));
      assertEquals(allCommits.length, 6, 'should have exactly 6 commits');

      const head = repo.headForKey(item.key);
      assertExists(head, 'head must exist');
      assertEquals(
        head.ancestors.length,
        2,
        'chain of 6: ancestors capped at 2',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Ancestors', 'all ancestor IDs exist in repo', async (ctx) => {
    const { db, repo, item } = await buildChain(
      ctx,
      'ancestors-exists',
      6,
    );
    try {
      const head = repo.headForKey(item.key);
      assertExists(head, 'head must exist');
      for (const ancId of head.ancestors) {
        assertTrue(
          repo.hasCommit(ancId),
          `ancestor commit ${ancId} must exist in repo`,
        );
      }
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'Ancestors',
    'merge commit covers both branches',
    async (ctx) => {
      const db = await ctx.createDB('ancestors-merge-both', {
        registry: kMergeTestRegistry,
      });
      await db.readyPromise();
      await db.open('/merge-test/anc-merge1');
      try {
        // Branch A: 2 local commits (c0 → c1)
        const item = db.create(
          '/merge-test/anc-merge1/item1',
          kMergeTestSchemaV1,
          { title: 'branch-a-0', count: 0 },
        );
        await db.flush('/merge-test/anc-merge1');
        item.set('title', 'branch-a-1');
        await db.flush('/merge-test/anc-merge1');

        const repo = db.repository('/merge-test/anc-merge1')!;
        const c1 = repo.headForKey(item.key)!;
        assertExists(c1, 'branch A head must exist');
        const c0id = c1.parents[0]; // grandparent via merge parents

        // Branch B: 2 independent commits (r0 → r1) with different root.
        // Use old timestamps so they're excluded from merge-leader election
        // (mergeLeaderFromLeaves only considers commits within 5s).
        const r0 = createRawCommit({
          key: item.key,
          schema: kMergeTestSchemaV1,
          data: { title: 'branch-b-0', count: 10 },
          parents: [],
          session: 'remote-session-b',
          timestamp: Date.now() - 10_000,
        });
        const r1 = createRawCommit({
          key: item.key,
          schema: kMergeTestSchemaV1,
          data: { title: 'branch-b-1', count: 11 },
          parents: [r0.id],
          session: 'remote-session-b',
          timestamp: Date.now() - 10_000,
        });
        await repo.persistVerifiedCommits([r0, r1]);
        await waitForMerge(repo, item.key);

        const head = repo.headForKey(item.key)!;
        assertExists(head, 'head should exist after merge');
        assertTrue(
          head.parents.length > 1,
          'head should be a merge commit with multiple parents',
        );

        // Both branches' grandparents must appear in ancestors
        const ancestors = new Set(head.ancestors);
        assertTrue(
          c0id !== undefined && ancestors.has(c0id),
          'ancestors must include branch A grandparent (c0)',
        );
        assertTrue(
          ancestors.has(r0.id),
          'ancestors must include branch B grandparent (r0)',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'Ancestors',
    'ancestors exclude direct parents',
    async (ctx) => {
      const db = await ctx.createDB('ancestors-no-parents', {
        registry: kMergeTestRegistry,
      });
      await db.readyPromise();
      await db.open('/merge-test/anc-merge2');
      try {
        const item = db.create(
          '/merge-test/anc-merge2/item1',
          kMergeTestSchemaV1,
          { title: 'local-base', count: 0 },
        );
        await db.flush('/merge-test/anc-merge2');

        const repo = db.repository('/merge-test/anc-merge2')!;

        // Remote independent root (parents=[]) with distinct value.
        // Use old timestamps so mergeLeaderFromLeaves picks the local session.
        const r0 = createRawCommit({
          key: item.key,
          schema: kMergeTestSchemaV1,
          data: { title: 'remote-base', count: 99 },
          parents: [],
          session: 'remote-session-x',
          timestamp: Date.now() - 10_000,
        });
        const r1 = createRawCommit({
          key: item.key,
          schema: kMergeTestSchemaV1,
          data: { title: 'remote-ext', count: 100 },
          parents: [r0.id],
          session: 'remote-session-x',
          timestamp: Date.now() - 10_000,
        });
        await repo.persistVerifiedCommits([r0, r1]);
        await waitForMerge(repo, item.key);

        const head = repo.headForKey(item.key)!;
        assertExists(head, 'head should exist after merge');
        assertTrue(
          head.parents.length > 1,
          'head should be a merge commit',
        );

        const parentSet = new Set(head.parents);
        for (const ancId of head.ancestors) {
          assertTrue(
            !parentSet.has(ancId),
            `ancestor ${ancId} must not appear in direct parents`,
          );
        }
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'Ancestors',
    '255-ancestor cap truncates gracefully',
    async (ctx) => {
      const db = await ctx.createDB('ancestors-255-cap', {
        registry: kMergeTestRegistry,
      });
      await db.readyPromise();
      await db.open('/merge-test/anc-cap');
      try {
        // Create a base item so we have a key
        const item = db.create(
          '/merge-test/anc-cap/item1',
          kMergeTestSchemaV1,
          { title: 'base', count: 0 },
        );
        await db.flush('/merge-test/anc-cap');

        const repo = db.repository('/merge-test/anc-cap')!;

        // Build 130 independent 3-commit chains for the same key.
        // Each chain contributes ~2 ancestors, totaling ~260 potential ancestors.
        for (let i = 0; i < 130; i++) {
          const c0 = createRawCommit({
            key: item.key,
            schema: kMergeTestSchemaV1,
            data: { title: `chain-${i}-c0`, count: i },
            parents: [],
            session: `remote-cap-${i}`,
            timestamp: Date.now() - 20_000 - i,
          });
          const c1 = createRawCommit({
            key: item.key,
            schema: kMergeTestSchemaV1,
            data: { title: `chain-${i}-c1`, count: i },
            parents: [c0.id],
            session: `remote-cap-${i}`,
            timestamp: Date.now() - 20_000 - i,
          });
          const c2 = createRawCommit({
            key: item.key,
            schema: kMergeTestSchemaV1,
            data: { title: `chain-${i}-c2`, count: i },
            parents: [c1.id],
            session: `remote-cap-${i}`,
            timestamp: Date.now() - 20_000 - i,
          });
          await repo.persistVerifiedCommits([c0, c1, c2]);
        }

        await waitForMerge(repo, item.key);

        const head = repo.headForKey(item.key);
        assertExists(head, 'head must exist after merge');
        assertTrue(
          head!.ancestors.length <= 255,
          `ancestors.length should be <= 255, got ${head!.ancestors.length}`,
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'Ancestors',
    'computeAncestors skips missing parent gracefully',
    async (ctx) => {
      const db = await ctx.createDB('ancestors-missing-parent', {
        registry: kMergeTestRegistry,
      });
      await db.readyPromise();
      await db.open('/merge-test/anc-miss');
      try {
        // Create a local item
        const item = db.create(
          '/merge-test/anc-miss/item1',
          kMergeTestSchemaV1,
          { title: 'local', count: 0 },
        );
        await db.flush('/merge-test/anc-miss');

        const repo = db.repository('/merge-test/anc-miss')!;

        // Create a remote commit whose parent is a non-existent ID.
        // This exercises the `continue` in computeAncestors when
        // hasCommit(pid) returns false.
        const fakeParentId = 'nonexistent-parent-id-00000000';
        const orphan = createRawCommit({
          key: item.key,
          schema: kMergeTestSchemaV1,
          data: { title: 'orphan', count: 99 },
          parents: [fakeParentId],
          session: 'remote-orphan',
          timestamp: Date.now() - 10_000,
        });
        await repo.persistVerifiedCommits([orphan]);
        await waitForMerge(repo, item.key);

        const head = repo.headForKey(item.key);
        assertExists(head, 'head must exist after merging orphan commit');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
