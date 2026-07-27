import { DataRegistry } from '../cfds/base/data-registry.ts';
import {
  assertEquals,
  assertExists,
  assertTrue,
  expectToContain,
} from './asserts.ts';
import { TEST } from './mod.ts';
import { isBrowser } from '../base/common.ts';
import type { GoatDB } from '../db/db.ts';
import { Query } from '../repo/query.ts';
import { QueryPersistence } from '../repo/query-persistance.ts';
import { QueryPersistenceFile } from '../db/persistance/query-file.ts';

// Define a test schema
const TestSchema = {
  ns: 'test',
  version: 1,
  fields: {
    name: { type: 'string', required: true },
    count: { type: 'number', default: () => 0 },
  },
} as const;

const OtherTestSchema = {
  ...TestSchema,
  ns: 'other-test',
} as const;

const kDataRegistry = new DataRegistry();
kDataRegistry.registerSchema(TestSchema);
kDataRegistry.registerSchema(OtherTestSchema);
export default function setup(): void {
  TEST('Trusted', 'initialization', async (ctx) => {
    const db = await ctx.createDB('db-init', {
      registry: kDataRegistry, // Override default registry
    });

    try {
      // Test environment-appropriate properties
      if (isBrowser()) {
        // Browser: Client mode properties
        assertTrue(db.path.includes('/temp/test-Trusted/db-init')); // OPFS temp path
        assertEquals(db.mode, 'client');
      } else {
        // Server: Standalone mode properties
        assertEquals(db.orgId, 'test-org');
        assertEquals(db.mode, 'server');
        assertTrue(db.path.includes('test-Trusted')); // tempDir path
      }

      // Common properties for both environments
      assertEquals(db.registry, kDataRegistry);

      // Should start not ready
      assertEquals(db.ready, false);
      await db.readyPromise();
      assertEquals(db.ready, true);

      // Authentication state depends on environment
      if (isBrowser()) {
        // Browser: Client mode starts anonymous
        assertEquals(db.loggedIn, false);
        assertEquals(db.currentUser, undefined);
      } else {
        // Server: Standalone mode starts with root session
        assertEquals(db.loggedIn, true);
        assertEquals(db.currentUser?.key, 'root');
      }
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Trusted', 'repository operations', async (ctx) => {
    const db = await ctx.createDB('db-repo', {
      registry: kDataRegistry,
    });

    try {
      await db.readyPromise();

      // Open a repository
      const repo = await db.open('/test/repo1');
      assertExists(repo);
      assertEquals(repo.path, '/test/repo1');

      // Repository should be accessible by path
      const sameRepo = db.repository('/test/repo1');
      assertExists(sameRepo);
      assertEquals(sameRepo, repo);

      // Count should be 0 in empty repo
      assertEquals(db.count('/test/repo1'), 0);

      // Keys should be empty for empty repo
      const keys = Array.from(db.keys('/test/repo1'));
      assertEquals(keys.length, 0);

      // Close the repository
      await db.closeRepo('/test/repo1');
      assertEquals(db.repository('/test/repo1'), undefined);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Trusted', 'item management', async (ctx) => {
    const db = await ctx.createDB('db-items', {
      registry: kDataRegistry,
    });

    try {
      await db.readyPromise();

      // Create an item
      const item = db.create('/test/items', TestSchema, { name: 'Test Item' });
      assertExists(item);
      assertTrue(item.schema === TestSchema);
      assertEquals(item.get('name'), 'Test Item');
      assertEquals(item.get('count'), 0); // Default value

      // Update the item
      item.set('count', 42);
      assertEquals(item.get('count'), 42);

      // Ensure persistence/sync based on environment
      await db.flush('/test/items');
      await db.sync('/test/items');

      // Access existing item
      const reloadedItem = db.item<typeof TestSchema>('/test/items', item.key);
      assertEquals(reloadedItem === item, true);
      assertEquals(reloadedItem.get('name'), 'Test Item');
      assertEquals(reloadedItem.get('count'), 42);

      // Count should be 1
      assertEquals(db.count('/test/items'), 1);

      // Keys should contain our item
      const keys = Array.from(db.keys('/test/items'));
      assertEquals(keys.length, 1);
      assertEquals(keys[0], item.key);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Trusted', 'bulk load', async (ctx) => {
    const db = await ctx.createDB('db-bulk', {
      registry: kDataRegistry,
    });

    try {
      await db.readyPromise();

      // Load an item using the load method
      const itemKey = 'test-key';
      await db.load(`/test/bulk/${itemKey}`, TestSchema, {
        name: 'Bulk Item',
        count: 100,
      });

      // Access the loaded item
      const item = db.item('/test/bulk', itemKey);
      assertEquals(item.get('name'), 'Bulk Item');
      assertEquals(item.get('count'), 100);

      // Auto-generated key
      await db.load('/test/bulk', TestSchema, {
        name: 'Auto Key Item',
        count: 200,
      });

      // Ensure persistence/sync based on environment
      if (isBrowser()) {
        // Browser: Sync with server
        await db.sync('/test/bulk');
      } else {
        // Server: Local persistence (load already persists)
      }

      // Count should be 2
      assertEquals(db.count('/test/bulk'), 2);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Trusted', 'query functionality', async (ctx) => {
    const db = await ctx.createDB('db-query', {
      registry: kDataRegistry,
    });

    try {
      await db.readyPromise();

      // Create test items
      db.create('/test/query', TestSchema, { name: 'Item 1', count: 10 });
      db.create('/test/query', TestSchema, { name: 'Item 2', count: 20 });
      db.create('/test/query', TestSchema, { name: 'Item 3', count: 30 });

      await db.flush('/test/query');
      await db.sync('/test/query');

      // Create a query for items with count > 15
      const query = db.query({
        source: '/test/query',
        schema: TestSchema,
        predicate: ({ item }) => item.get('count') > 15,
      });

      // Wait for query to be ready
      await query.loadingFinished();

      // Should find 2 items
      const results = query.results();
      assertEquals(results.length, 2);

      // Items should have the expected values
      expectToContain(results.map((i) => i.get('name')), 'Item 2');
      expectToContain(results.map((i) => i.get('name')), 'Item 3');

      // Close the query
      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'Trusted',
    'query IDs normalize defaults and retain explicit empty IDs',
    async (ctx) => {
      const db = await ctx.createDB('db-query-ids', {
        registry: kDataRegistry,
      });
      const queries: Array<{ close(): void }> = [];
      const persistence = new QueryPersistence(
        new QueryPersistenceFile(db.path),
      );

      try {
        await db.readyPromise();
        db.create('/test/query-ids', TestSchema, { name: 'Item', count: 1 });
        await db.flush('/test/query-ids');
        await persistence.storage!.store('/test/query-ids', {
          version: 1,
          queries: { '': { age: 1, results: [] } },
        });
        assertExists(
          await persistence.get('/test/query-ids', ''),
          'empty query IDs must be retrieved from persistence',
        );

        const base = { source: '/test/query-ids', schema: TestSchema };
        const defaults = db.query(base);
        queries.push(defaults);
        assertEquals(
          defaults,
          db.query({
            ...base,
            sortDescending: false,
            limit: 0,
            liveUpdates: true,
          }),
          'omitted and explicit defaults must deduplicate',
        );

        const byName = db.query({ ...base, sortBy: 'name' });
        queries.push(byName);
        const sameByName = db.query({ ...base, sortBy: 'name' });
        const byCount = db.query({ ...base, sortBy: 'count' });
        queries.push(byCount);
        const otherNs = db.query({
          ...base,
          schema: OtherTestSchema,
          sortBy: 'name',
        });
        queries.push(otherNs);
        assertEquals(byName, sameByName);
        assertTrue(byName.id !== byCount.id, 'sort fields must change the ID');
        assertTrue(
          byName.id !== otherNs.id,
          'schema namespace must change the ID',
        );

        const dbEmptyId = db.query({ ...base, id: '' });
        queries.push(dbEmptyId);
        assertEquals(dbEmptyId, db.query({ ...base, id: '' }));
        assertEquals(dbEmptyId.id, '');
        await dbEmptyId.loadingFinished();

        const directByName = new Query({ db, ...base, sortBy: 'name' });
        const directByCount = new Query({ db, ...base, sortBy: 'count' });
        const directEmptyId = new Query({ db, ...base, id: '' });
        queries.push(directByName, directByCount, directEmptyId);
        assertTrue(
          directByName.id !== directByCount.id,
          'direct Query sort fields must change the ID',
        );
        assertEquals(directEmptyId.id, '');
      } finally {
        await persistence.close();
        for (const query of queries) query.close();
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('Trusted', 'query cache cross-session correctness', async (ctx) => {
    // Regression test: ageForKey was keyed by item key but looked up by full
    // path, causing stale cache hits after DB reopen (items changed after cache
    // write were silently missed).
    if (isBrowser()) {
      return; // Server-only: requires direct path reopen
    }

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

  TEST('Trusted', 'ManagedItem loading state management', async (ctx) => {
    const db = await ctx.createDB('db-loading', {
      registry: kDataRegistry,
    });

    try {
      await db.readyPromise();

      // Test 1: New item should start with ready = false, then become true after loading
      const newItem = db.item('/test/loading', 'new-item');

      // Even new items start with ready = false because they need to check the repo
      assertEquals(newItem.ready, false);

      // readyPromise should resolve after loading completes
      await newItem.readyPromise();

      // After loading, should be ready
      assertEquals(newItem.ready, true);

      // Test 2: Create and test with completely fresh repository to ensure loading behavior
      const freshRepoPath = '/test/loading-fresh';
      const freshItem = db.create(freshRepoPath, TestSchema, {
        name: 'Fresh Loading Item',
        count: 100,
      });
      await db.flush(freshRepoPath);

      // Close and clear this repository
      await db.closeRepo(freshRepoPath);

      // Re-open with fresh item access - this should trigger loading
      const loadedItem = db.item(freshRepoPath, freshItem.key);

      // Test that readyPromise works correctly
      await loadedItem.readyPromise();
      assertEquals(loadedItem.ready, true);
      assertEquals(loadedItem.get('name'), 'Fresh Loading Item');
      assertEquals(loadedItem.get('count'), 100);

      // Test 3: readyPromise should resolve immediately if already ready
      const start2 = Date.now();
      await loadedItem.readyPromise();
      const elapsed2 = Date.now() - start2;
      assertTrue(elapsed2 < 50); // Should be nearly instant when already ready
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Trusted', 'close commits uncommitted changes', async (ctx) => {
    const db = await ctx.createDB('db-close-commit', {
      registry: kDataRegistry,
    });

    await db.readyPromise();

    // Open a repository and create an item
    await db.open('/test/close-commit');
    const item = db.create('/test/close-commit', TestSchema, {
      name: 'Close Commit Item',
      count: 1,
    });
    const itemKey = item.key;

    const newCount = item.get('count') + 1;
    // Edit the item but do NOT flush/commit explicitly
    item.set('count', newCount);

    // Immediately close the repo (should commit changes)
    await db.closeRepo('/test/close-commit');

    // Ensure the repo is not present in memory
    assertEquals(db.repository('/test/close-commit'), undefined);

    // Ensure the query persistence is not present in memory
    assertEquals(db.queryPersistence?.repoExists('/test/close-commit'), false);

    // Ensure the managed item is not present in memory
    assertEquals(db.itemLoaded(`/test/close-commit/${itemKey}`), false);

    // Re-open the repo and access the item
    await db.open('/test/close-commit');
    const reloadedItem = db.item('/test/close-commit', itemKey);

    // The changes should have been saved
    assertEquals(reloadedItem.get('name'), 'Close Commit Item');
    assertEquals(reloadedItem.get('count'), newCount);
  });

  TEST('Trusted', 'auto-flush persists items beyond threshold', async (ctx) => {
    const db = await ctx.createDB('auto-flush', {
      registry: kDataRegistry,
    });
    try {
      const itemCount = 1100; // exceeds AUTO_FLUSH_THRESHOLD (1000)
      for (let i = 0; i < itemCount; i++) {
        db.create(`/test/auto-flush/item-${i}`, TestSchema, {
          name: `item-${i}`,
        });
      }
      await db.flushAll();
      await db.closeRepo('/test/auto-flush');

      // Re-open and verify all items persisted
      await db.open('/test/auto-flush');
      for (let i = 0; i < itemCount; i++) {
        const item = db.item('/test/auto-flush', `item-${i}`);
        assertEquals(item.get('name'), `item-${i}`);
      }
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Trusted', 'insert basic bulk', async (ctx) => {
    const db = await ctx.createDB('db-insert-bulk', {
      registry: kDataRegistry,
    });
    try {
      await db.readyPromise();
      await db.insert('/test/insert-bulk', TestSchema, [
        { data: { name: 'A' } },
        { data: { name: 'B' } },
        { data: { name: 'C' } },
      ]);
      assertEquals(db.count('/test/insert-bulk'), 3);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Trusted', 'insert with explicit keys', async (ctx) => {
    const db = await ctx.createDB('db-insert-keys', {
      registry: kDataRegistry,
    });
    try {
      await db.readyPromise();
      await db.insert('/test/insert-keys', TestSchema, [
        { key: 'alpha', data: { name: 'Alpha' } },
        { key: 'beta', data: { name: 'Beta' } },
      ]);
      assertEquals(db.count('/test/insert-keys'), 2);
      const keys = Array.from(db.keys('/test/insert-keys'));
      expectToContain(keys, 'alpha');
      expectToContain(keys, 'beta');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Trusted', 'insert empty array is no-op', async (ctx) => {
    const db = await ctx.createDB('db-insert-empty', {
      registry: kDataRegistry,
    });
    try {
      await db.readyPromise();
      await db.insert('/test/insert-empty', TestSchema, []);
      assertEquals(db.count('/test/insert-empty'), 0);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('Trusted', 'insert persistence across reopen', async (ctx) => {
    if (isBrowser()) return; // Server-only: requires direct path reopen
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

  TEST(
    'Trusted',
    'WriteFailure listener attaches without firing',
    async (ctx) => {
      const db = await ctx.createDB('db-write-failure', {
        registry: kDataRegistry,
      });
      try {
        await db.readyPromise();
        let fired = false;
        db.attach('WriteFailure', () => {
          fired = true;
        });
        // Normal operations should not trigger WriteFailure
        db.create('/test/write-failure', TestSchema, { name: 'ok' });
        await db.flushAll();
        assertEquals(fired, false);
        // TODO: deeper test with injectable storage to simulate actual write errors
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
