import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import {
  createRawCommit,
  createRemoteCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
  kMergeTestSchemaV2,
  kSetTestSchema,
} from './merge-test-utils.ts';
import { sleep } from '../base/time.ts';

const S1 = kMergeTestSchemaV1;
const S2 = kMergeTestSchemaV2;
const SS = kSetTestSchema;

export default function setup() {
  TEST('MergeRecord', 'non-overlapping changes', async (ctx) => {
    const db = await ctx.createDB('mr-nonoverlap', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      // Create item, flush to get base commit
      const item = db.create('/merge-test/mr1', kMergeTestSchemaV1, {
        title: 'base',
        count: 0,
      });
      await db.flush('/merge-test/mr1');

      const repo = db.repository('/merge-test/mr1')!;
      const baseHead = repo.headForKey(item.key)!;

      // Local change: update title
      item.set('title', 'updated-title');
      await db.flush('/merge-test/mr1');

      // Remote change: update count (branches from baseHead)
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

      const result = repo.valueForKey(item.key);
      assertExists(result, 'merged value should exist');
      const [merged] = result!;
      assertEquals(merged.get('title'), 'updated-title');
      assertEquals(merged.get('count'), 42);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeRecord', 'conflicting field changes', async (ctx) => {
    const db = await ctx.createDB('mr-conflict', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      const item = db.create('/merge-test/mr2', kMergeTestSchemaV1, {
        title: 'base',
        count: 0,
      });
      await db.flush('/merge-test/mr2');

      const repo = db.repository('/merge-test/mr2')!;
      const baseHead = repo.headForKey(item.key)!;

      // Local change
      item.set('title', 'title-from-local');
      await db.flush('/merge-test/mr2');

      // Remote change to same field
      const remote = createRemoteCommit({
        key: item.key,
        schema: S1,
        data: { title: 'title-from-remote', count: 0 },
        parents: [baseHead.id],
        session: 'remote',
        timestamp: Date.now() - 10_000,
      });
      await repo.persistVerifiedCommits([remote]);
      await sleep(200);

      const result = repo.valueForKey(item.key);
      assertExists(result, 'merged value should exist');
      const [merged] = result!;
      const title = merged.get('title') as string;
      // Last-write-wins: local commit is newer than remote (timestamp: now-10s),
      // so its value should win deterministically.
      assertEquals(title, 'title-from-local');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeRecord', 'schema upgrade via head', async (ctx) => {
    const db = await ctx.createDB('mr-upgrade', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/mr3');
      const repo = db.repository('/merge-test/mr3')!;

      // Create v1 commit, then v2 commit as child (linear chain, no merge)
      const v1 = createRawCommit({
        key: 'k1',
        schema: S1,
        data: { title: 'original', count: 0 },
      });
      const v2 = createRawCommit({
        key: 'k1',
        schema: S2,
        data: { title: 'upgraded', count: 0, tags: new Set() },
        parents: [v1.id],
      });
      await repo.persistVerifiedCommits([v1, v2]);

      const result = repo.valueForKey('k1');
      assertExists(result, 'value should exist');
      const [item] = result!;
      assertEquals(item.schema.version, 2);
      assertEquals(item.schema.ns, 'merge-test');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeRecord', 'set-type union merge', async (ctx) => {
    const db = await ctx.createDB('mr-set-union', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();

      const item = db.create('/set-test/mr4', kSetTestSchema, {
        name: 'base',
        items: new Set(['a']),
      });
      await db.flush('/set-test/mr4');

      const repo = db.repository('/set-test/mr4')!;
      const baseHead = repo.headForKey(item.key)!;

      // Local: add 'b'
      item.set('items', new Set(['a', 'b']));
      await db.flush('/set-test/mr4');

      // Remote: add 'c'
      const remote = createRemoteCommit({
        key: item.key,
        schema: SS,
        data: { name: 'base', items: new Set(['a', 'c']) },
        parents: [baseHead.id],
        session: 'remote',
        timestamp: Date.now() - 10_000,
      });
      await repo.persistVerifiedCommits([remote]);
      await sleep(200);

      const result = repo.valueForKey(item.key);
      assertExists(result, 'merged value should exist');
      const [merged] = result!;
      const items = merged.get('items') as Set<string>;
      assertTrue(items.has('a'), 'should contain a');
      assertTrue(items.has('b'), 'should contain b');
      assertTrue(items.has('c'), 'should contain c');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeRecord', 'v1 to v2 upgrade preserves data', async (ctx) => {
    const db = await ctx.createDB('mr-v1v2', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/mr5');
      const repo = db.repository('/merge-test/mr5')!;

      const v1 = createRawCommit({
        key: 'k1',
        schema: S1,
        data: { title: 'original', count: 5 },
      });
      const v2 = createRawCommit({
        key: 'k1',
        schema: S2,
        data: { title: 'upgraded', count: 5, tags: new Set() },
        parents: [v1.id],
      });
      await repo.persistVerifiedCommits([v1, v2]);

      const result = repo.valueForKey('k1');
      assertExists(result, 'value should exist');
      const [item] = result!;
      assertEquals(item.schema.version, 2);
      assertEquals(item.get('title'), 'upgraded');
      assertEquals(item.get('count'), 5);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('MergeRecord', 'schema upgrade during merge', async (ctx) => {
    // Tests the merge path where LCA is v1, both leaves are v2.
    // createMergeRecord must upgrade the base (v1→v2) before diffing.
    const db = await ctx.createDB('mr-upgrade-merge', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      await db.open('/merge-test/mr6');
      const repo = db.repository('/merge-test/mr6')!;

      const key = 'k1';
      const now = Date.now();

      // v1 base commit
      const base = createRawCommit({
        key,
        schema: S1,
        data: { title: 'original', count: 0 },
        timestamp: now - 30_000,
      });

      // Two v2 branches from the v1 base, each modifying different fields
      const leafA = createRemoteCommit({
        key,
        schema: S2,
        data: { title: 'from-a', count: 0, tags: new Set(['x']) },
        parents: [base.id],
        session: 'sa',
        timestamp: now - 20_000,
      });
      const leafB = createRemoteCommit({
        key,
        schema: S2,
        data: { title: 'original', count: 42, tags: new Set() },
        parents: [base.id],
        session: 'sb',
        timestamp: now - 10_000,
      });

      await repo.persistVerifiedCommits([base, leafA, leafB]);
      await sleep(200);

      const result = repo.valueForKey(key);
      assertExists(result, 'merged value should exist');
      const [merged] = result!;
      // Merged result should be v2 schema
      assertEquals(merged.schema.version, 2);
      assertEquals(merged.schema.ns, 'merge-test');
      // count change from leafB (non-overlapping) should be preserved
      assertEquals(merged.get('count'), 42);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });
}
