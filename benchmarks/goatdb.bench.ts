import { BENCHMARK } from './mod.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { assert } from '../base/error.ts';
import { mapIterable, uniqueId, isBrowser } from '../base/common.ts';
import type { GoatDB } from '../db/db.ts';

// Define test schemas - keeping original naming
const SchemaTest = {
  ns: 'test',
  version: 1,
  fields: {
    title: { type: 'string' },
    count: { type: 'number', default: () => 0 },
    tags: { type: 'set', default: () => new Set<string>() },
  },
} as const;

DataRegistry.default.registerSchema(SchemaTest);

// Helper to create test data
function createTestData(count: number) {
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push({
      title: `Item ${i}`,
      count: i,
      tags: new Set<string>([`tag${i}`, `category${i % 5}`]),
    });
  }
  return result;
}

async function populateRepository(
  db: GoatDB,
  count: number,
  repoPath: string,
): Promise<void> {
  await db.open(repoPath);
  const currentCount = db.count(repoPath);
  if (currentCount < count) {
    for (const item of createTestData(count - currentCount)) {
      db.load(repoPath, SchemaTest, item);
    }
    await db.flushAll();
  }
}

export default function setup(): void {
  // Original benchmarks converted to new system
  BENCHMARK('GoatDB', 'Create instance', async (ctx) => {
    ctx.start();
    const db = await ctx.createDB('create-instance');
    ctx.end();
    await db.flushAll();
  });

  BENCHMARK('GoatDB', 'Open repository (empty)', async (ctx) => {
    const db = await ctx.createDB('open-empty');
    ctx.start();
    const repo = await db.open('/test/basic');
    ctx.end();
    assert(repo !== undefined, 'Repository should be opened successfully');
  });

  BENCHMARK('GoatDB', 'Open repository (100k items)', {
    warmup: 0,
    iterations: 3,
    preserveData: true,
  }, async (ctx) => {
    const tempDir = await ctx.tempDir('100k-items');
    const db = await ctx.createDB('open-100k', { path: tempDir });
    await db.open('/test/basic');
    if (db.count('/test/basic') < 100000) {
      await populateRepository(db, 100000, '/test/basic');
    }
    await db.closeRepo('/test/basic');

    ctx.start();
    const repo = await db.open('/test/basic');
    ctx.end();

    assert(repo !== undefined, 'Repository should be opened successfully');
    await db.closeRepo('/test/basic');
    await db.flushAll();
  });

  BENCHMARK('GoatDB', 'Read 100k items', {
    warmup: 0,
    iterations: 3,
    preserveData: true,
  }, async (ctx) => {
    const tempDir = await ctx.tempDir('read-100k-items');
    const db = await ctx.createDB('read-100k', { path: tempDir });
    const repo = await db.open('/test/basic');
    if (db.count('/test/basic') < 100000) {
      await populateRepository(db, 100000, '/test/basic');
    }

    ctx.start();
    // Read all items (equivalent to SQLite's SELECT * FROM test_items)
    const items = Array.from(
      mapIterable(
        repo.keys(),
        (key) => repo.valueForKey(key)![0],
      ),
    );
    ctx.end();

    assert(items.length === 100000, 'Should read 100000 items');
  });

  BENCHMARK('GoatDB', 'Create single item', async (ctx) => {
    const db = await ctx.createDB('create-single');

    ctx.start();
    await db.load('/test/basic', SchemaTest, {
      title: 'Test item',
      count: 1,
      tags: new Set(['test', 'benchmark']),
    });
    ctx.end();
  });

  BENCHMARK('GoatDB', 'Read item by path', async (ctx) => {
    const db = await ctx.createDB('read-item');
    const itemPath = `/test/basic/foo`;

    // Create the item first
    const item = db.create(itemPath, SchemaTest, {
      title: 'Test read item',
      count: 42,
      tags: new Set(['read', 'test']),
    });
    await item.commit();

    ctx.start();
    // Now read the item
    const readItem = db.item(itemPath);
    ctx.end();

    assert(
      readItem.get('title') === 'Test read item',
      'Item title should match',
    );
    assert(readItem.get('count') === 42, 'Item count should match');
  });

  BENCHMARK('GoatDB', 'Update item', async (ctx) => {
    const db = await ctx.createDB('update-item');
    const itemId = uniqueId();
    const itemPath = `/test/basic/${itemId}`;

    // Create the item
    const item = db.create(itemPath, SchemaTest, {
      title: 'Original title',
      count: 1,
      tags: new Set(['original']),
    });
    await item.commit();

    ctx.start();
    // Update the item
    item.set('title', 'Updated title');
    item.set('count', 99);
    item.set('tags', new Set(['updated', 'modified']));
    await item.commit();
    ctx.end();

    // Verify updates
    assert(
      item.get('title') === 'Updated title',
      'Item title should be updated',
    );
    assert(item.get('count') === 99, 'Item count should be updated');
  });

  BENCHMARK('GoatDB', 'Bulk create 100 items', async (ctx) => {
    const db = await ctx.createDB('bulk-create');

    const testData = createTestData(100);
    ctx.start();
    const promises = testData.map((data, i) =>
      db.load(`/test/basic/item${i}`, SchemaTest, data)
    );
    await Promise.all(promises);
    await db.flushAll();
    ctx.end();
  });

  BENCHMARK('GoatDB', 'Bulk read 100 items', async (ctx) => {
    const db = await ctx.createDB('bulk-read');

    // Create items first
    const testData = createTestData(100);
    const promises = testData.map((data, i) =>
      db.load(`/test/basic/item${i}`, SchemaTest, data)
    );
    await Promise.all(promises);

    ctx.start();
    // Benchmark reading items
    for (let i = 0; i < 100; i++) {
      db.item(`/test/basic/item${i}`);
    }
    ctx.end();

    await db.flushAll();
  });

  BENCHMARK('GoatDB', 'Simple query', { preserveData: true }, async (ctx) => {
    const db = await ctx.createDB('simple-query');
    await db.open('/test/basic');

    // Create test data
    if (db.count('/test/basic') < 100) {
      const testData = createTestData(100);
      const promises = testData.map((data, i) =>
        db.load(`/test/basic/item${i}`, SchemaTest, data)
      );
      await Promise.all(promises);
    }

    ctx.start();
    // Run query for items with count > 50
    const query = db.query({
      source: '/test/basic',
      predicate: ({ item }) => item.get('count') > 50,
      schema: SchemaTest,
    });

    await query.loadingFinished();
    ctx.end();
    assert(query.results().length === 49, 'Query should return 49 items');
    query.close();
  });

  BENCHMARK(
    'GoatDB',
    'Complex query with sort',
    { preserveData: true },
    async (ctx) => {
      const db = await ctx.createDB('complex-query');
      await db.open('/test/basic');

      // Create test data
      if (db.count('/test/basic') < 100) {
        const testData = createTestData(100);
        const promises = testData.map((data, i) =>
          db.load(`/test/basic/item${i}`, SchemaTest, data)
        );
        await Promise.all(promises);
      }

      ctx.start();
      // Run complex query with sorting
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => {
          const count = item.get('count');
          const tags = item.get('tags');
          return count > 30 && count < 70 && tags.has('tag50');
        },
        sortBy: ({ left, right }) => right.get('count') - left.get('count'),
        schema: SchemaTest,
      });

      await query.loadingFinished();
      ctx.end();
    },
  );

  BENCHMARK('GoatDB', 'Repository operations: count', async (ctx) => {
    const db = await ctx.createDB('repo-count');

    // Create a few items
    for (let i = 0; i < 10; i++) {
      const item = db.create(`/test/basic/item${i}`, SchemaTest, {
        title: `Repo item ${i}`,
        count: i,
        tags: new Set(['repo', 'test']),
      });
      await item.commit();
    }

    ctx.start();
    db.count('/test/basic');
    ctx.end();
  });

  BENCHMARK('GoatDB', 'Repository operations: keys', async (ctx) => {
    const db = await ctx.createDB('repo-keys');

    // Create a few items
    for (let i = 0; i < 10; i++) {
      const item = db.create(`/test/basic/item${i}`, SchemaTest, {
        title: `Repo item ${i}`,
        count: i,
        tags: new Set(['repo', 'test']),
      });
      await item.commit();
    }

    ctx.start();
    Array.from(db.keys('/test/basic'));
    ctx.end();
  });

  // Fast benchmarks (converted from goatdb-fast.bench.ts)
  // Skip in browser - not relevant for browser environment
  if (!isBrowser()) {
    BENCHMARK('GoatDB Fast', 'Create instance', async (ctx) => {
    ctx.start();
    const db = await ctx.createDB('fast-create-instance', { trusted: true });
    ctx.end();
    await db.flushAll();
  });

  BENCHMARK('GoatDB Fast', 'Open repository (empty)', async (ctx) => {
    const db = await ctx.createDB('fast-open-empty', { trusted: true });
    ctx.start();
    const repo = await db.open('/test/basic');
    ctx.end();
    assert(repo !== undefined, 'Repository should be opened successfully');
  });

  BENCHMARK('GoatDB Fast', 'Create single item', async (ctx) => {
    const db = await ctx.createDB('fast-create-item', { trusted: true });

    ctx.start();
    db.create('/test/basic', SchemaTest, {
      title: 'Test item',
      count: 1,
      tags: new Set(['test', 'benchmark']),
    });
    ctx.end();

    await db.flushAll();
  });

  BENCHMARK('GoatDB Fast', 'Read item by path', async (ctx) => {
    const db = await ctx.createDB('fast-read-item', { trusted: true });
    const itemPath = `/test/basic/foo`;

    // Create the item first
    const item = db.create(itemPath, SchemaTest, {
      title: 'Test read item',
      count: 42,
      tags: new Set(['read', 'test']),
    });
    await item.commit();

    ctx.start();
    const readItem = db.item(itemPath);
    ctx.end();

    assert(
      readItem.get('title') === 'Test read item',
      'Item title should match',
    );
    assert(readItem.get('count') === 42, 'Item count should match');
    await db.flushAll();
  });

  BENCHMARK('GoatDB Fast', 'Update item', async (ctx) => {
    const db = await ctx.createDB('fast-update-item', { trusted: true });
    const itemId = uniqueId();
    const itemPath = `/test/basic/${itemId}`;

    // Create the item
    const item = db.create(itemPath, SchemaTest, {
      title: 'Original title',
      count: 1,
      tags: new Set(['original']),
    });
    await item.commit();

    ctx.start();
    item.set('title', 'Updated title');
    item.set('count', 99);
    item.set('tags', new Set(['updated', 'modified']));
    ctx.end();

    // Verify updates
    assert(
      item.get('title') === 'Updated title',
      'Item title should be updated',
    );
    assert(item.get('count') === 99, 'Item count should be updated');
    await db.flushAll();
  });

  BENCHMARK('GoatDB Fast', 'Bulk create 100 items', async (ctx) => {
    const db = await ctx.createDB('fast-bulk-create', { trusted: true });

    const testData = createTestData(100);
    ctx.start();
    const promises = testData.map((data, i) =>
      db.load(`/test/basic/item${i}`, SchemaTest, data)
    );
    await Promise.all(promises);
    ctx.end();
    await db.flushAll();
  });

  BENCHMARK('GoatDB Fast', 'Bulk read 100 items', async (ctx) => {
    const db = await ctx.createDB('fast-bulk-read', { trusted: true });

    // Create items first
    const testData = createTestData(100);
    testData.forEach((data, i) =>
      db.create(`/test/basic/item${i}`, SchemaTest, data)
    );

    ctx.start();
    // Benchmark reading items
    for (let i = 0; i < 100; i++) {
      db.item(`/test/basic/item${i}`);
    }
    ctx.end();

    await db.flushAll();
  });

  BENCHMARK('GoatDB Fast', 'Read 100k items', {
    warmup: 0,
    iterations: 3,
    preserveData: true,
  }, async (ctx) => {
    const tempDir = await ctx.tempDir('fast-read-100k-items');
    const db = await ctx.createDB('fast-read-100k', {
      path: tempDir,
      trusted: true,
    });
    await db.open('/test/basic');
    if (db.count('/test/basic') < 100000) {
      await populateRepository(db, 100000, '/test/basic');
    }

    ctx.start();
    // Read all items (equivalent to SQLite's SELECT * FROM test_items)
    const items = Array.from(
      mapIterable(
        db.keys('/test/basic'),
        (key) => db.item(`/test/basic/${key}`),
      ),
    );
    ctx.end();

    assert(items.length === 100000, 'Should read 100000 items');
    await db.flushAll();
  });

  BENCHMARK(
    'GoatDB Fast',
    'Simple query',
    { preserveData: true },
    async (ctx) => {
      const db = await ctx.createDB('fast-simple-query', { trusted: true });
      await db.open('/test/basic');

      // Create test data
      if (db.count('/test/basic') < 100) {
        const testData = createTestData(100);
        const promises = testData.map((data, i) =>
          db.load(`/test/basic/item${i}`, SchemaTest, data)
        );
        await Promise.all(promises);
      }

      ctx.start();
      // Run query for items with count > 50
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => item.get('count') > 50,
        schema: SchemaTest,
      });

      await query.loadingFinished();
      ctx.end();
      assert(query.results().length === 49, 'Query should return 49 items');
      query.close();
    },
  );

  BENCHMARK(
    'GoatDB Fast',
    'Complex query with sort',
    { preserveData: true },
    async (ctx) => {
      const db = await ctx.createDB('fast-complex-query', { trusted: true });
      await db.open('/test/basic');

      // Create test data
      if (db.count('/test/basic') < 100) {
        const testData = createTestData(100);
        const promises = testData.map((data, i) =>
          db.load(`/test/basic/item${i}`, SchemaTest, data)
        );
        await Promise.all(promises);
      }

      ctx.start();
      // Run complex query with sorting
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => {
          const count = item.get('count');
          const tags = item.get('tags');
          return count > 30 && count < 70 && tags.has('tag50');
        },
        sortBy: ({ left, right }) => right.get('count') - left.get('count'),
        schema: SchemaTest,
      });

      await query.loadingFinished();
      ctx.end();
      query.close();
    },
  );

  BENCHMARK('GoatDB Fast', 'Repository operations: count', async (ctx) => {
    const db = await ctx.createDB('fast-repo-count', { trusted: true });

    // Create a few items
    for (let i = 0; i < 10; i++) {
      const item = db.create(`/test/basic/item${i}`, SchemaTest, {
        title: `Repo item ${i}`,
        count: i,
        tags: new Set(['repo', 'test']),
      });
      await item.commit();
    }

    ctx.start();
    db.count('/test/basic');
    ctx.end();
  });

  BENCHMARK('GoatDB Fast', 'Repository operations: keys', async (ctx) => {
    const db = await ctx.createDB('fast-repo-keys', { trusted: true });

    // Create a few items
    for (let i = 0; i < 10; i++) {
      const item = db.create(`/test/basic/item${i}`, SchemaTest, {
        title: `Repo item ${i}`,
        count: i,
        tags: new Set(['repo', 'test']),
      });
      await item.commit();
    }

    ctx.start();
    Array.from(db.keys('/test/basic'));
    ctx.end();
  });

  } // End GoatDB Fast benchmarks

  // Trusted benchmarks (converted from goatdb-trusted.bench.ts)
  // Skip in browser - not relevant for browser environment
  if (!isBrowser()) {
    BENCHMARK('GoatDB Trusted', 'Create instance', async (ctx) => {
    ctx.start();
    const db = await ctx.createDB('trusted-create-instance', { trusted: true });
    ctx.end();
    await db.flushAll();
  });

  BENCHMARK('GoatDB Trusted', 'Open repository (empty)', async (ctx) => {
    const db = await ctx.createDB('trusted-open-empty', { trusted: true });
    ctx.start();
    const repo = await db.open('/test/basic');
    ctx.end();
    assert(repo !== undefined, 'Repository should be opened successfully');
  });

  BENCHMARK('GoatDB Trusted', 'Open repository (100k items)', {
    warmup: 0,
    iterations: 3,
    preserveData: true,
  }, async (ctx) => {
    const tempDir = await ctx.tempDir('trusted-100k-items');
    const db = await ctx.createDB('trusted-open-100k', {
      path: tempDir,
      trusted: true,
    });
    await db.open('/test/basic');
    if (db.count('/test/basic') < 100000) {
      await populateRepository(db, 100000, '/test/basic');
    }
    await db.closeRepo('/test/basic');

    ctx.start();
    const repo = await db.open('/test/basic');
    ctx.end();

    assert(repo !== undefined, 'Repository should be opened successfully');
    await db.closeRepo('/test/basic');
    await db.flushAll();
  });

  BENCHMARK('GoatDB Trusted', 'Create single item', async (ctx) => {
    const db = await ctx.createDB('trusted-create-item', { trusted: true });

    ctx.start();
    await db.load('/test/basic', SchemaTest, {
      title: 'Test item',
      count: 1,
      tags: new Set(['test', 'benchmark']),
    });
    ctx.end();

    await db.flushAll();
  });

  BENCHMARK('GoatDB Trusted', 'Read item by path', async (ctx) => {
    const db = await ctx.createDB('trusted-read-item', { trusted: true });
    const itemPath = `/test/basic/foo`;

    // Create the item first
    const item = db.create(itemPath, SchemaTest, {
      title: 'Test read item',
      count: 42,
      tags: new Set(['read', 'test']),
    });
    await item.commit();

    ctx.start();
    // Now read the item
    const readItem = db.item(itemPath);
    ctx.end();

    assert(
      readItem.get('title') === 'Test read item',
      'Item title should match',
    );
    assert(readItem.get('count') === 42, 'Item count should match');
    await db.flushAll();
  });

  BENCHMARK('GoatDB Trusted', 'Update item', async (ctx) => {
    const db = await ctx.createDB('trusted-update-item', { trusted: true });
    const itemId = uniqueId();
    const itemPath = `/test/basic/${itemId}`;

    // Create the item
    const item = db.create(itemPath, SchemaTest, {
      title: 'Original title',
      count: 1,
      tags: new Set(['original']),
    });
    await item.commit();

    ctx.start();
    // Update the item
    item.set('title', 'Updated title');
    item.set('count', 99);
    item.set('tags', new Set(['updated', 'modified']));
    await item.commit();
    ctx.end();

    // Verify updates
    assert(
      item.get('title') === 'Updated title',
      'Item title should be updated',
    );
    assert(item.get('count') === 99, 'Item count should be updated');
    await db.flushAll();
  });

  BENCHMARK('GoatDB Trusted', 'Bulk create 100 items', async (ctx) => {
    const db = await ctx.createDB('trusted-bulk-create', { trusted: true });

    const testData = createTestData(100);
    ctx.start();
    const promises = testData.map((data, i) =>
      db.load(`/test/basic/item${i}`, SchemaTest, data)
    );
    await Promise.all(promises);
    ctx.end();
    await db.flushAll();
  });

  BENCHMARK('GoatDB Trusted', 'Bulk read 100 items', async (ctx) => {
    const db = await ctx.createDB('trusted-bulk-read', { trusted: true });

    // Create items first
    const testData = createTestData(100);
    const promises = testData.map((data, i) =>
      db.load(`/test/basic/item${i}`, SchemaTest, data)
    );
    await Promise.all(promises);

    ctx.start();
    // Benchmark reading items
    for (let i = 0; i < 100; i++) {
      db.item(`/test/basic/item${i}`);
    }
    ctx.end();

    await db.flushAll();
  });

  BENCHMARK('GoatDB Trusted', 'Read 100k items', {
    warmup: 0,
    iterations: 3,
    preserveData: true,
  }, async (ctx) => {
    const tempDir = await ctx.tempDir('trusted-read-100k-items');
    const db = await ctx.createDB('trusted-read-100k', {
      path: tempDir,
      trusted: true,
    });
    await db.open('/test/basic');
    if (db.count('/test/basic') < 100000) {
      await populateRepository(db, 100000, '/test/basic');
    }

    ctx.start();
    // Read all items (equivalent to SQLite's SELECT * FROM test_items)
    const keys = Array.from(db.keys('/test/basic'));
    const items = keys.map((key) => db.item(`/test/basic/${key}`));
    ctx.end();

    assert(items.length === 100000, 'Should read 100000 items');
    await db.flushAll();
  });

  BENCHMARK(
    'GoatDB Trusted',
    'Simple query',
    { preserveData: true },
    async (ctx) => {
      const db = await ctx.createDB('trusted-simple-query', { trusted: true });
      await db.open('/test/basic');

      // Create test data
      if (db.count('/test/basic') < 100) {
        const testData = createTestData(100);
        const promises = testData.map((data, i) =>
          db.load(`/test/basic/item${i}`, SchemaTest, data)
        );
        await Promise.all(promises);
      }

      ctx.start();
      // Run query for items with count > 50
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => item.get('count') > 50,
        schema: SchemaTest,
      });

      await query.loadingFinished();
      ctx.end();
      assert(query.results().length === 49, 'Query should return 49 items');
      query.close();
    },
  );

  BENCHMARK(
    'GoatDB Trusted',
    'Complex query with sort',
    { preserveData: true },
    async (ctx) => {
      const db = await ctx.createDB('trusted-complex-query', { trusted: true });
      await db.open('/test/basic');

      // Create test data
      if (db.count('/test/basic') < 100) {
        const testData = createTestData(100);
        const promises = testData.map((data, i) =>
          db.load(`/test/basic/item${i}`, SchemaTest, data)
        );
        await Promise.all(promises);
      }

      ctx.start();
      // Run complex query with sorting
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => {
          const count = item.get('count');
          const tags = item.get('tags');
          return count > 30 && count < 70 && tags.has('tag50');
        },
        sortBy: ({ left, right }) => right.get('count') - left.get('count'),
        schema: SchemaTest,
      });

      await query.loadingFinished();
      ctx.end();
      await db.flushAll();
      query.close();
    },
  );

  BENCHMARK('GoatDB Trusted', 'Repository operations: count', async (ctx) => {
    const db = await ctx.createDB('trusted-repo-count', { trusted: true });

    // Create a few items
    for (let i = 0; i < 10; i++) {
      const item = db.create(`/test/basic/item${i}`, SchemaTest, {
        title: `Repo item ${i}`,
        count: i,
        tags: new Set(['repo', 'test']),
      });
      await item.commit();
    }

    ctx.start();
    db.count('/test/basic');
    ctx.end();
  });

  BENCHMARK('GoatDB Trusted', 'Repository operations: keys', async (ctx) => {
    const db = await ctx.createDB('trusted-repo-keys', { trusted: true });

    // Create a few items
    for (let i = 0; i < 10; i++) {
      const item = db.create(`/test/basic/item${i}`, SchemaTest, {
        title: `Repo item ${i}`,
        count: i,
        tags: new Set(['repo', 'test']),
      });
      await item.commit();
    }

    ctx.start();
    Array.from(db.keys('/test/basic'));
    ctx.end();
  });

  } // End GoatDB Trusted benchmarks
}
