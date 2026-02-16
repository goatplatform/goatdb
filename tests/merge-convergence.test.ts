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
  TEST('MergeConvergence', 'commutativity', async (ctx) => {
    const db1 = await ctx.createDB('conv-comm1', {
      registry: kMergeTestRegistry,
    });
    const db2 = await ctx.createDB('conv-comm2', {
      registry: kMergeTestRegistry,
    });
    try {
      await db1.readyPromise();
      await db2.readyPromise();

      const key = 'comm-item';
      await db1.open('/merge-test/conv1');
      await db2.open('/merge-test/conv1');
      const repo1 = db1.repository('/merge-test/conv1')!;
      const repo2 = db2.repository('/merge-test/conv1')!;

      // Shared base commit — same object persisted into both repos
      const now = Date.now();
      const base = createRawCommit({
        key,
        schema: S1,
        data: { title: 'base', count: 0 },
        timestamp: now - 30_000,
      });
      await repo1.persistVerifiedCommits([base]);
      await repo2.persistVerifiedCommits([base]);

      // Two remote commits branching from the shared base
      const remoteA = createRemoteCommit({
        key,
        schema: S1,
        data: { title: 'from-a', count: 1 },
        parents: [base.id],
        session: 'sa',
        timestamp: now - 20_000,
      });
      const remoteB = createRemoteCommit({
        key,
        schema: S1,
        data: { title: 'from-b', count: 2 },
        parents: [base.id],
        session: 'sb',
        timestamp: now - 10_000,
      });

      // DB1: persist A then B
      await repo1.persistVerifiedCommits([remoteA]);
      await sleep(200);
      await repo1.persistVerifiedCommits([remoteB]);
      await sleep(200);

      // DB2: persist B then A (reverse order) — same commit objects
      await repo2.persistVerifiedCommits([remoteB]);
      await sleep(200);
      await repo2.persistVerifiedCommits([remoteA]);
      await sleep(200);

      // Both should converge to same value
      const val1 = repo1.valueForKey(key);
      const val2 = repo2.valueForKey(key);
      assertExists(val1);
      assertExists(val2);
      assertEquals(
        val1![0].get('title'),
        val2![0].get('title'),
        'merge(A,B) title should equal merge(B,A) title',
      );
      assertEquals(
        val1![0].get('count'),
        val2![0].get('count'),
        'merge(A,B) count should equal merge(B,A) count',
      );
    } finally {
      await db1.flushAll();
      await db1.close();
      await db2.flushAll();
      await db2.close();
    }
  });

  TEST('MergeConvergence', 'idempotency', async (ctx) => {
    const db = await ctx.createDB('conv-idemp', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      // Create item via GoatDB API
      const item = db.create('/merge-test/conv2', kMergeTestSchemaV1, {
        title: 'solo',
        count: 42,
      });
      await db.flush('/merge-test/conv2');

      const repo = db.repository('/merge-test/conv2')!;

      // With a single leaf, there's nothing to merge. Value should be stable.
      const valBefore = repo.valueForKey(item.key);
      assertExists(valBefore);
      assertEquals(valBefore![0].get('title'), 'solo');
      assertEquals(valBefore![0].get('count'), 42);

      // Wait a bit and check again -- value should remain the same
      await sleep(200);

      const valAfter = repo.valueForKey(item.key);
      assertExists(valAfter);
      assertEquals(valAfter![0].get('title'), 'solo');
      assertEquals(valAfter![0].get('count'), 42);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeConvergence', 'associativity', async (ctx) => {
    // merge(merge(A,B),C) should equal merge(A,merge(B,C))
    const db1 = await ctx.createDB('conv-assoc1', {
      registry: kMergeTestRegistry,
    });
    const db2 = await ctx.createDB('conv-assoc2', {
      registry: kMergeTestRegistry,
    });
    try {
      await db1.readyPromise();
      await db2.readyPromise();

      const key = 'assoc-item';
      await db1.open('/merge-test/assoc1');
      await db2.open('/merge-test/assoc1');
      const repo1 = db1.repository('/merge-test/assoc1')!;
      const repo2 = db2.repository('/merge-test/assoc1')!;

      // Shared base commit
      const now = Date.now();
      const base = createRawCommit({
        key,
        schema: S1,
        data: { title: 'base', count: 0 },
        timestamp: now - 40_000,
      });
      await repo1.persistVerifiedCommits([base]);
      await repo2.persistVerifiedCommits([base]);

      // Three remote commits branching from the shared base
      const a = createRemoteCommit({
        key,
        schema: S1,
        data: { title: 'a', count: 1 },
        parents: [base.id],
        session: 'sa',
        timestamp: now - 30_000,
      });
      const b = createRemoteCommit({
        key,
        schema: S1,
        data: { title: 'b', count: 2 },
        parents: [base.id],
        session: 'sb',
        timestamp: now - 20_000,
      });
      const c = createRemoteCommit({
        key,
        schema: S1,
        data: { title: 'c', count: 3 },
        parents: [base.id],
        session: 'sc',
        timestamp: now - 10_000,
      });

      // DB1: merge(A,B) first, then merge result with C
      await repo1.persistVerifiedCommits([a, b]);
      await sleep(200);
      await repo1.persistVerifiedCommits([c]);
      await sleep(200);

      // DB2: merge all three at once
      await repo2.persistVerifiedCommits([a, b, c]);
      await sleep(200);

      const val1 = repo1.valueForKey(key);
      const val2 = repo2.valueForKey(key);
      assertExists(val1);
      assertExists(val2);
      assertEquals(
        val1![0].get('title'),
        val2![0].get('title'),
        'associativity: titles should match',
      );
      assertEquals(
        val1![0].get('count'),
        val2![0].get('count'),
        'associativity: counts should match',
      );
    } finally {
      await db1.flushAll();
      await db1.close();
      await db2.flushAll();
      await db2.close();
    }
  });

  TEST(
    'MergeConvergence',
    'strong eventual consistency 3 peers',
    async (ctx) => {
      const db1 = await ctx.createDB('conv-sec1', {
        registry: kMergeTestRegistry,
      });
      const db2 = await ctx.createDB('conv-sec2', {
        registry: kMergeTestRegistry,
      });
      const db3 = await ctx.createDB('conv-sec3', {
        registry: kMergeTestRegistry,
      });
      try {
        await db1.readyPromise();
        await db2.readyPromise();
        await db3.readyPromise();

        const key = 'sec-item';
        await db1.open('/merge-test/sec');
        await db2.open('/merge-test/sec');
        await db3.open('/merge-test/sec');
        const repo1 = db1.repository('/merge-test/sec')!;
        const repo2 = db2.repository('/merge-test/sec')!;
        const repo3 = db3.repository('/merge-test/sec')!;

        // Shared base commit persisted into all 3 repos
        const now = Date.now();
        const base = createRawCommit({
          key,
          schema: S1,
          data: { title: 'base', count: 0 },
          timestamp: now - 40_000,
        });
        await repo1.persistVerifiedCommits([base]);
        await repo2.persistVerifiedCommits([base]);
        await repo3.persistVerifiedCommits([base]);

        // 3 remote commits — same objects shared across all repos
        const p1 = createRemoteCommit({
          key,
          schema: S1,
          data: { title: 'peer1', count: 10 },
          parents: [base.id],
          session: 'peer1',
          timestamp: now - 30_000,
        });
        const p2 = createRemoteCommit({
          key,
          schema: S1,
          data: { title: 'peer2', count: 20 },
          parents: [base.id],
          session: 'peer2',
          timestamp: now - 20_000,
        });
        const p3 = createRemoteCommit({
          key,
          schema: S1,
          data: { title: 'peer3', count: 30 },
          parents: [base.id],
          session: 'peer3',
          timestamp: now - 10_000,
        });

        // Each DB gets the same 3 commits in different orders
        await repo1.persistVerifiedCommits([p1, p2, p3]); // 1-2-3
        await repo2.persistVerifiedCommits([p3, p1, p2]); // 3-1-2
        await repo3.persistVerifiedCommits([p2, p3, p1]); // 2-3-1
        await sleep(200);

        const val1 = repo1.valueForKey(key);
        const val2 = repo2.valueForKey(key);
        const val3 = repo3.valueForKey(key);
        assertExists(val1);
        assertExists(val2);
        assertExists(val3);

        // All three should have the same title and count
        assertEquals(
          val1![0].get('title'),
          val2![0].get('title'),
          'peer1 and peer2 should converge on title',
        );
        assertEquals(
          val2![0].get('title'),
          val3![0].get('title'),
          'peer2 and peer3 should converge on title',
        );
        assertEquals(
          val1![0].get('count'),
          val2![0].get('count'),
          'peer1 and peer2 should converge on count',
        );
        assertEquals(
          val2![0].get('count'),
          val3![0].get('count'),
          'peer2 and peer3 should converge on count',
        );
      } finally {
        await db1.flushAll();
        await db1.close();
        await db2.flushAll();
        await db2.close();
        await db3.flushAll();
        await db3.close();
      }
    },
  );
}
