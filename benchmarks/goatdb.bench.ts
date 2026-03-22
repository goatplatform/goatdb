import { BENCHMARK } from './mod.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { assert } from '../base/error.ts';
import { isBrowser, mapIterable, uniqueId } from '../base/common.ts';
import type { GoatDB, StorageFormat } from '../db/db.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import * as path from '../base/path.ts';

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
    await db.insert(
      repoPath,
      SchemaTest,
      createTestData(count - currentCount).map((item) => ({ data: item })),
    );
    await db.flushAll();
  }
}

interface GoatDBBenchmarkOptions {
  suiteName: string;
  trusted: boolean;
  /** durable=true: await db.load for Create, await item.commit in Update, flushAll before ctx.end in Bulk create */
  durable: boolean;
  storageFormat: StorageFormat;
}

function registerGoatDBBenchmarks(opts: GoatDBBenchmarkOptions): void {
  const { suiteName, trusted, durable, storageFormat } = opts;
  const dbConfig = { trusted, storageFormat };

  BENCHMARK(suiteName, 'Create instance', async (ctx) => {
    ctx.start();
    const db = await ctx.createDB('create-instance', dbConfig);
    ctx.end();
    await db.flushAll();
  });

  BENCHMARK(suiteName, 'Open database (empty)', async (ctx) => {
    const db = await ctx.createDB('open-empty', dbConfig);
    ctx.start();
    const repo = await db.open('/test/basic');
    ctx.end();
    assert(repo !== undefined, 'Repository should be opened successfully');
  });

  BENCHMARK(suiteName, 'Open database (100k items)', {
    warmup: 1,
    iterations: 7,
    preserveData: true,
  }, async (ctx) => {
    const db = await ctx.getOrCreateDB('open-100k', dbConfig);
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

  BENCHMARK(suiteName, 'Read 100k items (cold)', {
    warmup: 1,
    iterations: 7,
    preserveData: true,
  }, async (ctx) => {
    const db = await ctx.getOrCreateDB('read-100k', dbConfig);
    await db.open('/test/basic');
    if (db.count('/test/basic') < 100000) {
      await populateRepository(db, 100000, '/test/basic');
    }
    await db.closeRepo('/test/basic');
    const repo = await db.open('/test/basic');

    ctx.start();
    const items = Array.from(
      mapIterable(repo.keys(), (key) => repo.valueForKey(key)![0]),
    );
    ctx.end();

    assert(items.length === 100000, 'Should read 100000 items');
    await db.closeRepo('/test/basic');
  });

  BENCHMARK(suiteName, 'Read 100k items (warm)', {
    warmup: 1,
    iterations: 7,
    preserveData: true,
  }, async (ctx) => {
    const db = await ctx.getOrCreateDB('read-100k-warm', dbConfig);
    const repo = await db.open('/test/basic');
    if (db.count('/test/basic') < 100000) {
      await populateRepository(db, 100000, '/test/basic');
    }

    // Warm all caches: forces lazy Commit.contents parsing + populates
    // _cachedValueForKey, _cachedRecordForCommit, _cachedHeadsByKey
    for (const key of repo.keys()) {
      repo.valueForKey(key);
    }

    // Measure steady-state reads from warm cache
    ctx.start();
    const items = Array.from(
      mapIterable(repo.keys(), (key) => repo.valueForKey(key)![0]),
    );
    ctx.end();

    assert(items.length === 100000, 'Should read 100000 items');
  });

  BENCHMARK(suiteName, 'Create item', async (ctx) => {
    const db = await ctx.createDB('create-item', dbConfig);

    ctx.start();
    if (durable) {
      await db.insert('/test/basic', SchemaTest, [{
        data: {
          title: 'Test item',
          count: 1,
          tags: new Set(['test', 'benchmark']),
        },
      }]);
    } else {
      db.create('/test/basic', SchemaTest, {
        title: 'Test item',
        count: 1,
        tags: new Set(['test', 'benchmark']),
      });
    }
    ctx.end();

    await db.flushAll();
  });

  BENCHMARK(suiteName, 'Read item', async (ctx) => {
    const db = await ctx.createDB('read-item', dbConfig);
    const itemPath = `/test/basic/foo`;

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

  BENCHMARK(suiteName, 'Update item', async (ctx) => {
    const db = await ctx.createDB('update-item', dbConfig);
    const itemPath = `/test/basic/${uniqueId()}`;

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
    if (durable) await item.commit();
    ctx.end();

    assert(
      item.get('title') === 'Updated title',
      'Item title should be updated',
    );
    assert(item.get('count') === 99, 'Item count should be updated');
    await db.flushAll();
  });

  BENCHMARK(suiteName, 'Bulk create 100 items', async (ctx) => {
    const db = await ctx.createDB('bulk-create', dbConfig);

    const testData = createTestData(100);
    ctx.start();
    await db.insert(
      '/test/basic',
      SchemaTest,
      testData.map((data, i) => ({ key: `item${i}`, data })),
    );
    if (durable) {
      await db.flushAll();
      ctx.end();
    } else {
      ctx.end();
      await db.flushAll();
    }
  });

  BENCHMARK(suiteName, 'Bulk read 100 items', async (ctx) => {
    const db = await ctx.createDB('bulk-read', dbConfig);

    const testData = createTestData(100);
    await db.insert(
      '/test/basic',
      SchemaTest,
      testData.map((data, i) => ({ key: `item${i}`, data })),
    );

    ctx.start();
    for (let i = 0; i < 100; i++) {
      db.item(`/test/basic/item${i}`);
    }
    ctx.end();

    await db.flushAll();
  });

  BENCHMARK(
    suiteName,
    'Filter query cold (100 items)',
    { preserveData: true },
    async (ctx) => {
      const db = await ctx.getOrCreateDB('simple-query', dbConfig);
      await db.open('/test/basic');

      if (db.count('/test/basic') < 100) {
        const testData = createTestData(100);
        await db.insert(
          '/test/basic',
          SchemaTest,
          testData.map((data, i) => ({ key: `item${i}`, data })),
        );
      }

      ctx.start();
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
    suiteName,
    'Filter + sort query cold (100 items)',
    { preserveData: true },
    async (ctx) => {
      const db = await ctx.getOrCreateDB('complex-query', dbConfig);
      await db.open('/test/basic');

      if (db.count('/test/basic') < 100) {
        const testData = createTestData(100);
        await db.insert(
          '/test/basic',
          SchemaTest,
          testData.map((data, i) => ({ key: `item${i}`, data })),
        );
      }

      ctx.start();
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

  BENCHMARK(
    suiteName,
    'Filter query cold (100k → 1k results)',
    { warmup: 2, iterations: 10, preserveData: true },
    async (ctx) => {
      const db = await ctx.getOrCreateDB('simple-query-1k', dbConfig);
      await db.open('/test/basic');
      if (db.count('/test/basic') < 100000) {
        await db.insert(
          '/test/basic',
          SchemaTest,
          createTestData(100000).map((data, i) => ({ key: `item${i}`, data })),
        );
        await db.flushAll();
      }

      ctx.start();
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => (item.get('count') as number) > 98999,
        schema: SchemaTest,
      });
      await query.loadingFinished();
      ctx.end();
      assert(query.results().length === 1000, 'Query should return 1000 items');
      query.close();
    },
  );

  BENCHMARK(
    suiteName,
    'Filter query cold (100k → 10k results)',
    { warmup: 1, iterations: 7, preserveData: true },
    async (ctx) => {
      const db = await ctx.getOrCreateDB('simple-query-10k', dbConfig);
      await db.open('/test/basic');
      if (db.count('/test/basic') < 100000) {
        await db.insert(
          '/test/basic',
          SchemaTest,
          createTestData(100000).map((data, i) => ({ key: `item${i}`, data })),
        );
        await db.flushAll();
      }

      ctx.start();
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => (item.get('count') as number) > 89999,
        schema: SchemaTest,
      });
      await query.loadingFinished();
      ctx.end();
      assert(
        query.results().length === 10000,
        'Query should return 10000 items',
      );
      query.close();
    },
  );

  BENCHMARK(
    suiteName,
    'Filter query warm (100 items)',
    { preserveData: true },
    async (ctx) => {
      const db = await ctx.getOrCreateDB('warm-query-100', dbConfig);
      await db.open('/test/basic');
      if (db.count('/test/basic') < 100) {
        await db.insert(
          '/test/basic',
          SchemaTest,
          createTestData(100).map((data, i) => ({ key: `item${i}`, data })),
        );
      }
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => (item.get('count') as number) > 50,
        schema: SchemaTest,
      });
      await query.loadingFinished();
      query.results(); // warm cache

      ctx.start();
      const results = query.results(); // O(1) cached return
      ctx.end();

      assert(results.length === 49, 'Query should return 49 items');
      // Do not close — query stays pooled for next iteration
    },
  );

  BENCHMARK(
    suiteName,
    'Filter query warm (100k → 1k results)',
    { warmup: 2, iterations: 10, preserveData: true },
    async (ctx) => {
      const db = await ctx.getOrCreateDB('warm-query-1k', dbConfig);
      await db.open('/test/basic');
      if (db.count('/test/basic') < 100000) {
        await db.insert(
          '/test/basic',
          SchemaTest,
          createTestData(100000).map((data, i) => ({ key: `item${i}`, data })),
        );
        await db.flushAll();
      }
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => (item.get('count') as number) > 98999,
        schema: SchemaTest,
      });
      await query.loadingFinished();
      query.results(); // warm cache

      ctx.start();
      const results = query.results();
      ctx.end();

      assert(results.length === 1000, 'Query should return 1000 items');
    },
  );

  BENCHMARK(
    suiteName,
    'Filter query warm (100k → 10k results)',
    { warmup: 1, iterations: 7, preserveData: true },
    async (ctx) => {
      const db = await ctx.getOrCreateDB('warm-query-10k', dbConfig);
      await db.open('/test/basic');
      if (db.count('/test/basic') < 100000) {
        await db.insert(
          '/test/basic',
          SchemaTest,
          createTestData(100000).map((data, i) => ({ key: `item${i}`, data })),
        );
        await db.flushAll();
      }
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => (item.get('count') as number) > 89999,
        schema: SchemaTest,
      });
      await query.loadingFinished();
      query.results(); // warm cache

      ctx.start();
      const results = query.results();
      ctx.end();

      assert(results.length === 10000, 'Query should return 10000 items');
    },
  );

  BENCHMARK(
    suiteName,
    'Filter + sort query warm (100 items)',
    { preserveData: true },
    async (ctx) => {
      const db = await ctx.getOrCreateDB('warm-complex-query', dbConfig);
      await db.open('/test/basic');
      if (db.count('/test/basic') < 100) {
        await db.insert(
          '/test/basic',
          SchemaTest,
          createTestData(100).map((data, i) => ({ key: `item${i}`, data })),
        );
      }
      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => {
          const count = item.get('count') as number;
          const tags = item.get('tags');
          return count > 30 && count < 70 && tags.has('tag50');
        },
        sortBy: ({ left, right }) =>
          (right.get('count') as number) - (left.get('count') as number),
        schema: SchemaTest,
      });
      await query.loadingFinished();
      query.results(); // warm cache

      ctx.start();
      query.results();
      ctx.end();
    },
  );

  BENCHMARK(
    suiteName,
    'Live query update (100 items)',
    { warmup: 5, iterations: 20, preserveData: true },
    async (ctx) => {
      const N = 100;
      const db = await ctx.getOrCreateDB('incr-query-100', dbConfig);
      await db.open('/test/basic');
      if (db.count('/test/basic') < 100000) {
        await db.insert(
          '/test/basic',
          SchemaTest,
          createTestData(100000).map((data, i) => ({ key: `item${i}`, data })),
        );
        await db.flushAll();
      }

      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => (item.get('count') as number) > 99000,
        schema: SchemaTest,
      });
      await query.loadingFinished();

      const item0 = db.item('/test/basic/item0');
      const currentCount = item0.get('count') as number;
      const newCount = currentCount > 99000 ? 0 : 100000;

      ctx.start();
      for (let i = 0; i < N; i++) {
        const item = db.item(`/test/basic/item${i}`);
        item.set('count', newCount);
      }
      query.results();
      ctx.end();

      assert(query.results().length > 0);
      query.close();
    },
  );

  BENCHMARK(
    suiteName,
    'Live query update (1k items)',
    { warmup: 5, iterations: 20, preserveData: true },
    async (ctx) => {
      const N = 1000;
      const db = await ctx.getOrCreateDB('incr-query-1k', dbConfig);
      await db.open('/test/basic');
      if (db.count('/test/basic') < 100000) {
        await db.insert(
          '/test/basic',
          SchemaTest,
          createTestData(100000).map((data, i) => ({ key: `item${i}`, data })),
        );
        await db.flushAll();
      }

      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => (item.get('count') as number) > 99000,
        schema: SchemaTest,
      });
      await query.loadingFinished();

      const item0 = db.item('/test/basic/item0');
      const currentCount = item0.get('count') as number;
      const newCount = currentCount > 99000 ? 0 : 100000;

      ctx.start();
      for (let i = 0; i < N; i++) {
        const item = db.item(`/test/basic/item${i}`);
        item.set('count', newCount);
      }
      query.results();
      ctx.end();

      assert(query.results().length > 0);
      query.close();
    },
  );

  BENCHMARK(
    suiteName,
    'Live query update (10k items)',
    { warmup: 1, iterations: 1, preserveData: true }, // Single iteration: 10k-item setup makes repetition too slow
    async (ctx) => {
      const N = 10000;
      const db = await ctx.getOrCreateDB('incr-query-10k', dbConfig);
      await db.open('/test/basic');
      if (db.count('/test/basic') < 100000) {
        await db.insert(
          '/test/basic',
          SchemaTest,
          createTestData(100000).map((data, i) => ({ key: `item${i}`, data })),
        );
        await db.flushAll();
      }

      const query = db.query({
        source: '/test/basic',
        predicate: ({ item }) => (item.get('count') as number) > 99000,
        schema: SchemaTest,
      });
      await query.loadingFinished();

      const item0 = db.item('/test/basic/item0');
      const currentCount = item0.get('count') as number;
      const newCount = currentCount > 99000 ? 0 : 100000;

      ctx.start();
      for (let i = 0; i < N; i++) {
        const item = db.item(`/test/basic/item${i}`);
        item.set('count', newCount);
      }
      query.results();
      ctx.end();

      assert(query.results().length > 0);
      query.close();
    },
  );

  BENCHMARK(suiteName, 'Count operation', async (ctx) => {
    const db = await ctx.createDB('repo-count', dbConfig);

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

  BENCHMARK(suiteName, 'Keys operation', async (ctx) => {
    const db = await ctx.createDB('repo-keys', dbConfig);

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

  // Write 100k items: meaningful for storage format comparison (non-browser only)
  if (!isBrowser()) {
    BENCHMARK(suiteName, 'Write 100k items', {
      warmup: 1,
      iterations: 7,
    }, async (ctx) => {
      const db = await ctx.createDB('write-100k', dbConfig);
      await db.open('/test/basic');
      const testData = createTestData(100000);

      ctx.start();
      await db.insert(
        '/test/basic',
        SchemaTest,
        testData.map((item, i) => ({ key: `item${i}`, data: item })),
      );
      if (durable) {
        await db.flushAll();
        ctx.end();
      } else {
        ctx.end();
        await db.flushAll();
      }

      const filePath = path.join(db.path, `test/basic.${storageFormat}`);
      const impl = await FileImplGet();
      const handle = await impl.open(filePath, false);
      const fileSize = await impl.seek(handle, 0, 'end');
      await impl.close(handle);
      console.log(
        `  [${suiteName}] Disk size: ${
          (fileSize / (1024 * 1024)).toFixed(2)
        } MB`,
      );
    });
  }
}

export default function setup(): void {
  // Headline: production default (signed, relaxed durability)
  registerGoatDBBenchmarks({
    suiteName: 'GoatDB',
    trusted: false,
    durable: false,
    storageFormat: 'goat',
  });

  if (!isBrowser()) {
    // Trusted: shows cost savings when signing is disabled (single-user/local)
    registerGoatDBBenchmarks({
      suiteName: 'GoatDB (Trusted)',
      trusted: true,
      durable: false,
      storageFormat: 'goat',
    });

    // Durable: per-op flush with full signing (isolates IO cost only)
    registerGoatDBBenchmarks({
      suiteName: 'GoatDB (Durable)',
      trusted: false,
      durable: true,
      storageFormat: 'goat',
    });
  }

  // Storage format comparison
  registerGoatDBBenchmarks({
    suiteName: 'GoatDB JSONL',
    trusted: false,
    durable: false,
    storageFormat: 'jsonl',
  });
}
