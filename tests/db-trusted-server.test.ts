/**
 * Server-only Trusted-mode tests.
 *
 * These tests require direct filesystem path access and multi-process DB
 * reopen, which is not available in the browser client mode. They are NOT
 * registered in the browser entry point.
 */
import { TEST } from './mod.ts';
import { assertEquals, expectToContain } from './asserts.ts';
import type { GoatDB } from '../db/db.ts';
import { kDataRegistry, TestSchema } from './test-schemas.ts';

export default function setupDBTrustedServer(): void {
  TEST('Trusted', 'query cache cross-session correctness', async (ctx) => {
    // Regression test: ageForKey was keyed by item key but looked up by full
    // path, causing stale cache hits after DB reopen (items changed after cache
    // write were silently missed).
    const dbPath = await ctx.tempDir('db-query-cache');

    // Session 1: populate and run a query to seed the cache.
    const db1 = new (await import('../db/db.ts')).GoatDB({
      path: dbPath,
      orgId: 'test-org',
      trusted: true,
      registry: kDataRegistry,
    });
    let targetKey: string;
    try {
      await db1.readyPromise();
      db1.create('/test/qcache', TestSchema, { name: 'A', count: 5 });
      const target = db1.create('/test/qcache', TestSchema, {
        name: 'B',
        count: 5,
      });
      targetKey = target.key;
      db1.create('/test/qcache', TestSchema, { name: 'C', count: 30 });
      await db1.flush('/test/qcache');

      const q1 = db1.query({
        source: '/test/qcache',
        schema: TestSchema,
        predicate: ({ item }) => item.get('count') > 15,
      });
      await q1.loadingFinished();
      assertEquals(q1.results().length, 1); // Only C passes
      q1.close();

      // Mutate B so it now passes the predicate.
      const b = db1.item<typeof TestSchema>('/test/qcache', targetKey);
      b.set('count', 20);
      await db1.flushAll();
    } finally {
      await db1.close();
    }

    // Session 2: reopen and re-run the query — B must now appear.
    const db2 = new (await import('../db/db.ts')).GoatDB({
      path: dbPath,
      orgId: 'test-org',
      trusted: true,
      registry: kDataRegistry,
    });
    try {
      await db2.readyPromise();
      const q2 = db2.query({
        source: '/test/qcache',
        schema: TestSchema,
        predicate: ({ item }) => item.get('count') > 15,
      });
      await q2.loadingFinished();
      const names = q2.results().map((i) => i.get('name'));
      assertEquals(names.length, 2, 'B should now appear after cache fix');
      expectToContain(names, 'B');
      expectToContain(names, 'C');
      q2.close();
    } finally {
      await db2.flushAll();
      await db2.close();
    }
  });

  TEST('Trusted', 'insert persistence across reopen', async (ctx) => {
    const dbPath = await ctx.tempDir('db-insert-persist');
    const { GoatDB: DB } = await import('../db/db.ts');
    const db1: GoatDB = new DB({
      path: dbPath,
      orgId: 'test-org',
      trusted: true,
      registry: kDataRegistry,
    });
    try {
      await db1.readyPromise();
      await db1.insert('/test/insert-persist', TestSchema, [
        { key: 'p1', data: { name: 'Persist1' } },
        { key: 'p2', data: { name: 'Persist2' } },
      ]);
      await db1.flushAll();
    } finally {
      await db1.close();
    }
    const db2: GoatDB = new DB({
      path: dbPath,
      orgId: 'test-org',
      trusted: true,
      registry: kDataRegistry,
    });
    try {
      await db2.readyPromise();
      await db2.open('/test/insert-persist');
      assertEquals(db2.count('/test/insert-persist'), 2);
      const keys = Array.from(db2.keys('/test/insert-persist'));
      expectToContain(keys, 'p1');
      expectToContain(keys, 'p2');
    } finally {
      await db2.flushAll();
      await db2.close();
    }
  });
}
