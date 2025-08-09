import { GoatDB } from '../db/db.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import {
  assertEquals,
  assertExists,
  assertTrue,
  expectToContain,
} from './asserts.ts';
import { TEST } from './mod.ts';

// Define a test schema
const TestSchema = {
  ns: 'test',
  version: 1,
  fields: {
    name: { type: 'string', required: true },
    count: { type: 'number', default: () => 0 },
  },
} as const;

const kDataRegistry = new DataRegistry();
kDataRegistry.registerSchema(TestSchema);

export default function setup(): void {
  TEST('Untrusted', 'initialization', async (ctx) => {
    const db = new GoatDB({
      path: await ctx.tempDir('db-init'),
      orgId: 'test-org',
      registry: kDataRegistry,
    });

    try {
      assertEquals(db.orgId, 'test-org');
      assertEquals(db.path, await ctx.tempDir('db-init'));
      assertEquals(db.registry, kDataRegistry);

      // Should start not ready
      assertEquals(db.ready, false);

      // Wait for it to be ready
      await db.readyPromise();
      assertEquals(db.ready, true);

      // Should start with root session
      assertEquals(db.loggedIn, true);
      assertEquals(db.currentUser?.key, 'root');
    } finally {
      await db.flushAll();
    }
  });

  TEST('Untrusted', 'Repository Operations', async (ctx) => {
    const db = new GoatDB({
      path: await ctx.tempDir('db-repo'),
      orgId: 'test-org',
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
    }
  });

  TEST('Untrusted', 'Item Management', async (ctx) => {
    const db = new GoatDB({
      path: await ctx.tempDir('db-items'),
      orgId: 'test-org',
      registry: kDataRegistry,
    });

    try {
      await db.readyPromise();

      // Create an item
      const item = db.create('/test/items', TestSchema, { name: 'Test Item' });
      assertExists(item);
      assertEquals(item.schema, TestSchema);
      assertEquals(item.get('name'), 'Test Item');
      assertEquals(item.get('count'), 0); // Default value

      // Update the item
      item.set('count', 42);
      assertEquals(item.get('count'), 42);

      // Flush to ensure persistence
      await db.flush('/test/items');

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
    }
  });

  TEST('Untrusted', 'bulk load', async (ctx) => {
    const db = new GoatDB({
      path: await ctx.tempDir('db-bulk'),
      orgId: 'test-org',
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

      // Count should be 2
      assertEquals(db.count('/test/bulk'), 2);
    } finally {
      await db.flushAll();
    }
  });

  TEST('Untrusted', 'query functionality', async (ctx) => {
    const db = new GoatDB({
      path: await ctx.tempDir('db-query'),
      orgId: 'test-org',
      registry: kDataRegistry,
    });

    try {
      await db.readyPromise();

      // Create test items
      db.create('/test/query', TestSchema, { name: 'Item 1', count: 10 });
      db.create('/test/query', TestSchema, { name: 'Item 2', count: 20 });
      db.create('/test/query', TestSchema, { name: 'Item 3', count: 30 });

      await db.flush('/test/query');

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
    }
  });

  TEST('Untrusted', 'ManagedItem loading state management', async (ctx) => {
    const db = new GoatDB({
      path: await ctx.tempDir('db-loading'),
      orgId: 'test-org',
      trusted: false,
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
    }
  });

  TEST('Untrusted', 'close commits uncommitted changes', async (ctx) => {
    const db = new GoatDB({
      path: await ctx.tempDir('db-close-commit'),
      orgId: 'test-org',
      trusted: false,
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
}
