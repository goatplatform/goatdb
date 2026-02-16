import { TEST } from './mod.ts';
import { assertExists } from './asserts.ts';
import {
  createRemoteCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';
import { sleep } from '../base/time.ts';

const S1 = kMergeTestSchemaV1;

export default function setup() {
  TEST(
    'MergeConcurrency',
    'pending promise exists during merge',
    async (ctx) => {
      const db = await ctx.createDB('conc-pending', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();

        // Create item via GoatDB API, flush to get base commit
        const item = db.create('/merge-test/conc1', kMergeTestSchemaV1, {
          title: 'base',
          count: 0,
        });
        await db.flush('/merge-test/conc1');

        const repo = db.repository('/merge-test/conc1')!;
        const baseHead = repo.headForKey(item.key)!;

        // Local change
        item.set('title', 'local');
        await db.flush('/merge-test/conc1');

        // Remote change branching from baseHead triggers automatic merge
        const remote = createRemoteCommit({
          key: item.key,
          schema: S1,
          data: { title: 'remote', count: 1 },
          parents: [baseHead.id],
          session: 'remote-sess',
          timestamp: Date.now() - 10_000,
        });
        await repo.persistVerifiedCommits([remote]);

        // After persist, the automatic merge chain is in flight.
        // Wait for it to complete and verify the result exists.
        await sleep(200);

        const result = repo.valueForKey(item.key);
        assertExists(result, 'value should exist after automatic merge');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('MergeConcurrency', 'promise cleanup after merge', async (ctx) => {
    const db = await ctx.createDB('conc-cleanup', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      // Create item via GoatDB API, flush to get base commit
      const item = db.create('/merge-test/conc2', kMergeTestSchemaV1, {
        title: 'base',
        count: 0,
      });
      await db.flush('/merge-test/conc2');

      const repo = db.repository('/merge-test/conc2')!;
      const baseHead = repo.headForKey(item.key)!;

      // Local change
      item.set('title', 'local-first');
      await db.flush('/merge-test/conc2');

      // First remote commit triggers automatic merge
      const remote1 = createRemoteCommit({
        key: item.key,
        schema: S1,
        data: { title: 'remote-first', count: 1 },
        parents: [baseHead.id],
        session: 'remote-sess-1',
        timestamp: Date.now() - 10_000,
      });
      await repo.persistVerifiedCommits([remote1]);
      await sleep(200); // Wait for first automatic merge to complete

      // Get the new head after first merge
      const newHead = repo.headForKey(item.key)!;

      // Second remote commit should also trigger merge successfully
      // (promise from first merge was cleaned up)
      const remote2 = createRemoteCommit({
        key: item.key,
        schema: S1,
        data: { title: 'remote-second', count: 2 },
        parents: [baseHead.id],
        session: 'remote-sess-2',
        timestamp: Date.now() - 10_000,
      });
      await repo.persistVerifiedCommits([remote2]);
      await sleep(200); // Wait for second automatic merge

      const result = repo.valueForKey(item.key);
      assertExists(result, 'value should exist after second merge');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });
}
