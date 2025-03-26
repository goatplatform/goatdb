import { assert } from '../base/error.ts';
import { GoatDB } from '../db/db.ts';
import * as path from '@std/path';
import { uniqueId } from '../base/common.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';

// Define test schemas
const testSchema = {
  ns: 'test',
  version: 1,
  fields: {
    title: { type: 'string' },
    count: { type: 'number', default: () => 0 },
    tags: { type: 'set', default: () => new Set<string>() },
  },
} as const;

DataRegistry.default.registerSchema(testSchema);

const kTempDir = path.join(Deno.cwd(), 'temp_bench_' + uniqueId());

// Helper function to create a temp directory for testing
function createTempDir(): string {
  return kTempDir;
}

// Helper function to remove the temp directory
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch (e) {
    console.error('Failed to clean up temp directory:', e);
  }
}

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

// Benchmark suite for basic operations
Deno.bench('Trusted: Create instance', {
  warmup: 1,
}, async (ctx) => {
  const tempDir = await createTempDir();
  try {
    ctx.start();
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();
    ctx.end();
    await db.flushAll();
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.bench('Trusted: Open repository (empty)', {
  warmup: 1,
}, async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();
    ctx.start();
    const repo = await db.open('/test/basic');
    ctx.end();
    assert(repo !== undefined, 'Repository should be opened successfully');
    await db.flushAll();
  } finally {
    await cleanupTempDir(tempDir);
  }
});

async function populateRepository(
  db: GoatDB,
  count: number,
  repoPath: string,
): Promise<void> {
  await db.open(repoPath);
  const currentCount = db.count(repoPath);
  if (currentCount < count) {
    for (const item of createTestData(count - currentCount)) {
      db.load(repoPath, testSchema, item);
    }
    await db.flushAll();
  }
}

Deno.bench('Trusted: Open repository (100k items)', {
  n: 10,
}, async (ctx) => {
  const dbPath = path.join(Deno.cwd(), 'temp_bench_100k');
  try {
    const db = new GoatDB({ path: dbPath, trusted: true });
    await db.open('/test/basic');
    if (db.count('/test/basic') < 100000) {
      await populateRepository(db, 100000, '/test/basic');
    }
    await db.close('/test/basic');
    ctx.start();
    const repo = await db.open('/test/basic');
    ctx.end();
    assert(repo !== undefined, 'Repository should be opened successfully');
    await db.flushAll();
  } finally {
    // await cleanupTempDir(tempDir);
  }
});

Deno.bench('Trusted: Create single item', {
  warmup: 1,
}, async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();
    ctx.start();
    // const item = db.create('/test/basic', testSchema, {
    //   title: 'Test item',
    //   count: 1,
    //   tags: new Set(['test', 'benchmark']),
    // });
    // await item.commit();
    await db.load('/test/basic', testSchema, {
      title: 'Test item',
      count: 1,
      tags: new Set(['test', 'benchmark']),
    });
    ctx.end();
    await db.flushAll();
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.bench('Trusted: Read item by path', {
  warmup: 1,
}, async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();
    const path = `/test/basic/foo`;

    // Create the item first
    const item = db.create(path, testSchema, {
      title: 'Test read item',
      count: 42,
      tags: new Set(['read', 'test']),
    });
    await item.commit();

    ctx.start();
    // Now read the item
    const readItem = db.item(path);
    ctx.end();
    assert(
      readItem.get('title') === 'Test read item',
      'Item title should match',
    );
    assert(readItem.get('count') === 42, 'Item count should match');
    await db.flushAll();
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.bench('Trusted: Update item', {
  warmup: 1,
}, async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();
    const itemId = uniqueId();
    const path = `/test/basic/${itemId}`;

    // Create the item
    const item = db.create(path, testSchema, {
      title: 'Original title',
      count: 1,
      tags: new Set(['original']),
    });
    await item.commit();

    // Update the item
    ctx.start();
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
  } finally {
    await cleanupTempDir(tempDir);
  }
});

// Bulk operation benchmarks
Deno.bench('Trusted: Bulk create 100 items', {
  warmup: 1,
}, async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();
    // const repo = await db.open('/test/basic');

    const testData = createTestData(100);
    ctx.start();
    const promises = testData.map((data, i) =>
      db.load(`/test/basic/item${i}`, testSchema, data)
    );
    await Promise.all(promises);
    await db.flushAll();
    ctx.end();
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.bench('Trusted: Bulk read 100 items', {
  warmup: 1,
}, async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();
    // const repo = await db.open('/test/basic');

    // Create items first
    const testData = createTestData(100);
    const promises = testData.map((data, i) =>
      db.load(`/test/basic/item${i}`, testSchema, data)
    );
    await Promise.all(promises);

    // Benchmark reading items
    ctx.start();
    for (let i = 0; i < 100; i++) {
      db.item(`/test/basic/item${i}`);
    }
    ctx.end();

    await db.flushAll();
  } finally {
    await cleanupTempDir(tempDir);
  }
});

// Query benchmarks
Deno.bench('Trusted: Simple query', {
  warmup: 1,
}, async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.open('/test/basic');

    // Create test data
    if (db.count('/test/basic') < 100) {
      const testData = createTestData(100);
      const promises = testData.map((data, i) =>
        db.load(`/test/basic/item${i}`, testSchema, data)
      );
      await Promise.all(promises);
    }

    ctx.start();
    // Run query for items with count > 50
    const query = db.query({
      source: '/test/basic',
      predicate: ({ item }) => item.get('count') > 50,
      schema: testSchema,
    });

    await query.loadingFinished();
    ctx.end();
    assert(query.results().length === 49, 'Query should return 49 items');
    query.close();
    await db.flushAll();
  } finally {
    // await cleanupTempDir(tempDir);
  }
});

Deno.bench('Trusted: Complex query with sort', {
  warmup: 1,
}, async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();
    await db.open('/test/basic');

    // Create test data
    if (db.count('/test/basic') < 100) {
      const testData = createTestData(100);
      const promises = testData.map((data, i) =>
        db.load(`/test/basic/item${i}`, testSchema, data)
      );
      await Promise.all(promises);
    }

    // Run complex query with sorting
    ctx.start();
    const query = db.query({
      source: '/test/basic',
      predicate: ({ item }) => {
        const count = item.get('count');
        const tags = item.get('tags');
        return count > 30 && count < 70 && tags.has('tag50');
      },
      sortBy: ({ left, right }) => right.get('count') - left.get('count'),
      schema: testSchema,
    });

    await query.loadingFinished();
    ctx.end();
    await db.flushAll();
    query.close();
  } finally {
    // await cleanupTempDir(tempDir);
  }
});

// Repository operations benchmark
Deno.bench('Trusted: Repository operations: count', async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();

    // Create a few items
    for (let i = 0; i < 10; i++) {
      const item = db.create(`/test/basic/item${i}`, testSchema, {
        title: `Repo item ${i}`,
        count: i,
        tags: new Set(['repo', 'test']),
      });
      await item.commit();
    }

    // Test repository operations
    ctx.start();
    db.count('/test/basic');
    ctx.end();

    await db.flush('/test/basic');
    await db.close('/test/basic');
  } finally {
    await cleanupTempDir(tempDir);
  }
});

Deno.bench('Trusted: Repository operations: keys', async (ctx) => {
  const tempDir = await createTempDir();
  try {
    const db = new GoatDB({ path: tempDir, trusted: true });
    await db.readyPromise();

    // Create a few items
    for (let i = 0; i < 10; i++) {
      const item = db.create(`/test/basic/item${i}`, testSchema, {
        title: `Repo item ${i}`,
        count: i,
        tags: new Set(['repo', 'test']),
      });
      await item.commit();
    }

    // Test repository operations
    ctx.start();
    Array.from(db.keys('/test/basic'));
    ctx.end();

    await db.flush('/test/basic');
    await db.close('/test/basic');
  } finally {
    await cleanupTempDir(tempDir);
  }
});
