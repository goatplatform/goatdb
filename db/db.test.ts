import { GoatDB } from './db.ts';
import { SchemaManager } from '../cfds/base/schema-manager.ts';
import * as path from '@std/path';
import { assertEquals, assertExists } from '@std/assert';
import { expect } from '@std/expect';

// Create temporary test directory
const TEST_DIR = await Deno.makeTempDir({ prefix: 'goatdb-test-' });

// Clean up function to be called after tests
async function cleanup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to clean up test directory:', e);
  }
}

// Define a test schema
const TestSchema = {
  ns: 'test',
  version: 1,
  fields: {
    name: { type: 'string', required: true },
    count: { type: 'number', default: () => 0 },
  },
} as const;

SchemaManager.default.registerSchema(TestSchema);

Deno.test('GoatDB - initialization', async () => {
  const db = new GoatDB({
    path: path.join(TEST_DIR, 'db-init'),
    orgId: 'test-org',
  });

  try {
    assertEquals(db.orgId, 'test-org');
    assertEquals(db.path, path.join(TEST_DIR, 'db-init'));
    assertEquals(db.schemaManager, SchemaManager.default);

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

Deno.test('GoatDB - repository operations', async () => {
  const db = new GoatDB({
    path: path.join(TEST_DIR, 'db-repo'),
    orgId: 'test-org',
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
    await db.close('/test/repo1');
    assertEquals(db.repository('/test/repo1'), undefined);
  } finally {
    await db.flushAll();
  }
});

Deno.test('GoatDB - item management', async () => {
  const db = new GoatDB({
    path: path.join(TEST_DIR, 'db-items'),
    orgId: 'test-org',
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

Deno.test('GoatDB - bulk load', async () => {
  const db = new GoatDB({
    path: path.join(TEST_DIR, 'db-bulk'),
    orgId: 'test-org',
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

Deno.test('GoatDB - query functionality', async () => {
  const db = new GoatDB({
    path: path.join(TEST_DIR, 'db-query'),
    orgId: 'test-org',
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
    expect(results.map((i) => i.get('name'))).toContain('Item 2');
    expect(results.map((i) => i.get('name'))).toContain('Item 3');

    // Close the query
    query.close();
  } finally {
    await db.flushAll();
  }
});

// Run cleanup after all tests
Deno.test({
  name: 'Clean up test resources',
  fn: async () => {
    await cleanup();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
