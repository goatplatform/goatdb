import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import { resetMonotonicState, setMonotonicNowFn } from '../repo/commit.ts';
import { resetGeneratedQueryIds } from '../repo/query.ts';
import {
  createRawCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';
export default function setup() {
  TEST(
    'MergeEdgeCases',
    'monotonic clock ensures same-ms commits preserve creation order',
    async (ctx) => {
      const db = await ctx.createDB('edge-monotonic', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();
        await db.open('/merge-test/edge-monotonic');
        const repo = db.repository('/merge-test/edge-monotonic')!;
        resetMonotonicState();
        resetGeneratedQueryIds();
        setMonotonicNowFn(() => 1_700_000_000_000);
        const earlier = createRawCommit({
          id: 'z-earlier',
          key: 'k1',
          schema: kMergeTestSchemaV1,
          data: { title: 'earlier' },
        });
        const later = createRawCommit({
          id: 'a-later',
          key: 'k1',
          schema: kMergeTestSchemaV1,
          data: { title: 'later' },
        });
        await repo.persistVerifiedCommits([earlier, later]);
        assertEquals(repo.headForKey('k1')?.id, later.id);
      } finally {
        resetMonotonicState();
        resetGeneratedQueryIds();
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'MergeEdgeCases',
    'compareCommitsDesc same-timestamp deterministic',
    async (ctx) => {
      const db = await ctx.createDB('edge-compare', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();
        await db.open('/merge-test/edge1');
        const repo = db.repository('/merge-test/edge1')!;
        resetGeneratedQueryIds();

        const now = Date.now();
        // Create 2 commits with identical timestamps but different data/IDs
        const c1 = createRawCommit({
          key: 'k1',
          schema: kMergeTestSchemaV1,
          data: { title: 'aaa' },
          timestamp: now,
        });
        const c2 = createRawCommit({
          key: 'k1',
          schema: kMergeTestSchemaV1,
          data: { title: 'bbb' },
          timestamp: now,
        });

        await repo.persistVerifiedCommits([c1, c2]);

        // headForKey should return a deterministic result (sorted by ID as tiebreaker)
        const head1 = repo.headForKey('k1');
        assertExists(head1, 'head should exist');

        // Call again to verify determinism
        const head2 = repo.headForKey('k1');
        assertExists(head2, 'head should exist on second call');
        assertEquals(
          head1!.id,
          head2!.id,
          'headForKey should return the same commit deterministically',
        );

        // The head should be one of the two commits
        assertTrue(
          head1!.id === c1.id || head1!.id === c2.id,
          'head should be one of the two commits',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
