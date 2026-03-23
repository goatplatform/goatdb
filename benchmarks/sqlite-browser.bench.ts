import { BENCHMARK } from './mod.ts';
import { assert } from '../base/error.ts';
import { uniqueId } from '../base/common.ts';
import { createSQLiteConfig, getSQLiteWorkerManager } from './sqlite-worker.ts';
import * as path from '@std/path';

// Helper to create test data
function createTestData(count: number) {
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push({
      title: `Item ${i}`,
      count: i,
      tags: JSON.stringify([`tag${i}`, `category${i % 5}`]),
    });
  }
  return result;
}

async function populateDatabase(
  manager: any,
  dbPath: string,
  count: number,
): Promise<void> {
  const countResult = await manager.exec(
    dbPath,
    'SELECT COUNT(*) as count FROM test_items',
  );
  const currentCount = countResult.resultRows?.[0]?.count ?? 0;

  if (currentCount < count) {
    await manager.exec(dbPath, 'BEGIN TRANSACTION');
    for (let i = currentCount; i < count; i++) {
      await manager.exec(
        dbPath,
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
        [
          `item${i}`,
          `Item ${i}`,
          i,
          JSON.stringify([`tag${i}`, `category${i % 5}`]),
        ],
      );
      await manager.exec(
        dbPath,
        'INSERT INTO item_tags (item_id, tag) VALUES (?, ?)',
        [`item${i}`, `tag${i}`],
      );
      await manager.exec(
        dbPath,
        'INSERT INTO item_tags (item_id, tag) VALUES (?, ?)',
        [`item${i}`, `category${i % 5}`],
      );
    }
    await manager.exec(dbPath, 'COMMIT');
  }
}

export default function setup(): void {
  BENCHMARK('SQLite', 'Create instance', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    ctx.start();
    const dbId = await manager.openDatabase(config);
    ctx.end();

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Open database (empty)', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);

    ctx.start();
    // Table is already created by openDatabase, so this is a no-op for timing
    ctx.end();

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Open database (100k items)', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_100k.db');

    // Setup database with 100k items first
    let dbId = await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);
    await manager.closeDatabase(config.dbPath);

    ctx.start();
    dbId = await manager.openDatabase(config);
    ctx.end();

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Read 100k items (cold)', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_100k.db');

    const dbId = await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);

    ctx.start();
    const res = await manager.exec(config.dbPath, 'SELECT * FROM test_items');
    ctx.end();

    assert(
      res.resultRows?.length === 100000,
      'Database should have 100000 items',
    );

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Read 100k items (warm)', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_100k_warm.db');

    await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);

    // Warm page cache with one untimed full scan
    await manager.exec(config.dbPath, 'SELECT * FROM test_items');

    ctx.start();
    const res = await manager.exec(config.dbPath, 'SELECT * FROM test_items');
    ctx.end();

    assert(
      res.resultRows?.length === 100000,
      'Database should have 100000 items',
    );

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Create item', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);

    ctx.start();
    await manager.exec(
      config.dbPath,
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
      ['test1', 'Test item', 1, JSON.stringify(['test', 'benchmark'])],
    );
    ctx.end();

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Read item', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);

    // Create the item first
    await manager.exec(
      config.dbPath,
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
      ['foo', 'Test read item', 42, JSON.stringify(['read', 'test'])],
    );

    ctx.start();
    // Now read the item
    const readItem = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE id = ?',
      ['foo'],
    );
    ctx.end();

    assert(
      readItem.resultRows?.[0]?.title === 'Test read item',
      'Item title should match',
    );
    assert(readItem.resultRows?.[0]?.count === 42, 'Item count should match');

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Update item', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);
    const itemId = uniqueId();

    // Create the item
    await manager.exec(
      config.dbPath,
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
      [itemId, 'Original title', 1, JSON.stringify(['original'])],
    );

    ctx.start();
    // Update the item
    await manager.exec(
      config.dbPath,
      'UPDATE test_items SET title = ?, count = ?, tags = ? WHERE id = ?',
      ['Updated title', 99, JSON.stringify(['updated', 'modified']), itemId],
    );
    ctx.end();

    // Verify updates
    const item = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE id = ?',
      [itemId],
    );
    assert(
      item.resultRows?.[0]?.title === 'Updated title',
      'Item title should be updated',
    );
    assert(item.resultRows?.[0]?.count === 99, 'Item count should be updated');

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Bulk create 100 items', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);

    const testData = createTestData(100);

    ctx.start();
    await manager.exec(config.dbPath, 'BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      await manager.exec(
        config.dbPath,
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
        [`item${i}`, data.title, data.count, data.tags],
      );
    }
    await manager.exec(config.dbPath, 'COMMIT');
    ctx.end();

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Bulk read 100 items', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);

    // Create items first
    const testData = createTestData(100);
    await manager.exec(config.dbPath, 'BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      await manager.exec(
        config.dbPath,
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
        [`item${i}`, data.title, data.count, data.tags],
      );
    }
    await manager.exec(config.dbPath, 'COMMIT');

    ctx.start();
    // Benchmark reading items
    for (let i = 0; i < 100; i++) {
      const item = await manager.exec(
        config.dbPath,
        'SELECT * FROM test_items WHERE id = ?',
        [`item${i}`],
      );
      assert(
        item.resultRows?.[0]?.title === `Item ${i}`,
        'Item title should match',
      );
    }
    ctx.end();

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Filter query cold (100 items)', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);

    // Create test data
    const testData = createTestData(100);
    await manager.exec(config.dbPath, 'BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      await manager.exec(
        config.dbPath,
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
        [`item${i}`, data.title, data.count, data.tags],
      );
    }
    await manager.exec(config.dbPath, 'COMMIT');

    ctx.start();
    // Run query for items with count > 50
    const results = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 50',
    );
    ctx.end();

    assert(results.resultRows?.length === 49, 'Query should return 49 items');

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Filter + sort query cold (100 items)', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);

    // Create test data
    const testData = createTestData(100);
    await manager.exec(config.dbPath, 'BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      await manager.exec(
        config.dbPath,
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
        [`item${i}`, data.title, data.count, data.tags],
      );
      await manager.exec(
        config.dbPath,
        'INSERT INTO item_tags (item_id, tag) VALUES (?, ?)',
        [`item${i}`, `tag${i}`],
      );
      await manager.exec(
        config.dbPath,
        'INSERT INTO item_tags (item_id, tag) VALUES (?, ?)',
        [`item${i}`, `category${i % 5}`],
      );
    }
    await manager.exec(config.dbPath, 'COMMIT');

    ctx.start();
    // Complex query with sorting
    const results = await manager.exec(
      config.dbPath,
      `
        SELECT t.* FROM test_items t
        JOIN item_tags it ON t.id = it.item_id
        WHERE it.tag = 'tag50' AND t.count > 30 AND t.count < 70
        ORDER BY t.count DESC
      `,
    );
    ctx.end();

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Filter query cold (100k → 1k results)', {
    warmup: 2,
    iterations: 10,
    preserveData: true,
  }, async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_100k_query.db');
    await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);
    ctx.start();
    const results = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 98999',
    );
    ctx.end();
    assert(
      results.resultRows?.length === 1000,
      'Query should return 1000 items',
    );
    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Filter query cold (100k → 10k results)', {
    warmup: 2,
    iterations: 10,
    preserveData: true,
  }, async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_100k_query.db');
    await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);
    ctx.start();
    const results = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 89999',
    );
    ctx.end();
    assert(
      results.resultRows?.length === 10000,
      'Query should return 10000 items',
    );
    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK(
    'SQLite',
    'Filter query warm (100 items)',
    { preserveData: true },
    async (ctx) => {
      const manager = await getSQLiteWorkerManager();
      const config = createSQLiteConfig('temp_bench_sqlite_warm_100.db');
      await manager.openDatabase(config);

      const countResult = await manager.exec(
        config.dbPath,
        'SELECT COUNT(*) as count FROM test_items',
      );
      const currentCount = countResult.resultRows?.[0]?.count ?? 0;
      if (currentCount < 100) {
        const testData = createTestData(100);
        await manager.exec(config.dbPath, 'BEGIN TRANSACTION');
        for (let i = 0; i < 100; i++) {
          const data = testData[i];
          await manager.exec(
            config.dbPath,
            'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
            [`item${i}`, data.title, data.count, data.tags],
          );
        }
        await manager.exec(config.dbPath, 'COMMIT');
        // Warm page cache
        await manager.exec(
          config.dbPath,
          'SELECT * FROM test_items WHERE count > 50',
        );
      }

      ctx.start();
      const results = await manager.exec(
        config.dbPath,
        'SELECT * FROM test_items WHERE count > 50',
      );
      ctx.end();

      assert(results.resultRows?.length === 49, 'Query should return 49 items');
    },
  );

  BENCHMARK('SQLite', 'Filter query warm (100k → 1k results)', {
    warmup: 2,
    iterations: 10,
    preserveData: true,
  }, async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_warm_100k_1k.db');
    await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);
    // Warm page cache once
    await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 98999',
    );

    ctx.start();
    const results = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 98999',
    );
    ctx.end();

    assert(
      results.resultRows?.length === 1000,
      'Query should return 1000 items',
    );
  });

  BENCHMARK('SQLite', 'Filter query warm (100k → 10k results)', {
    warmup: 2,
    iterations: 10,
    preserveData: true,
  }, async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_warm_100k_10k.db');
    await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);
    // Warm page cache once
    await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 89999',
    );

    ctx.start();
    const results = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 89999',
    );
    ctx.end();

    assert(
      results.resultRows?.length === 10000,
      'Query should return 10000 items',
    );
  });

  BENCHMARK('SQLite', 'Filter + sort query warm (100 items)', {
    preserveData: true,
  }, async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_warm_sort_100.db');
    await manager.openDatabase(config);

    const countResult = await manager.exec(
      config.dbPath,
      'SELECT COUNT(*) as count FROM test_items',
    );
    const currentCount = countResult.resultRows?.[0]?.count ?? 0;
    if (currentCount < 100) {
      const testData = createTestData(100);
      await manager.exec(config.dbPath, 'BEGIN TRANSACTION');
      for (let i = 0; i < 100; i++) {
        const data = testData[i];
        await manager.exec(
          config.dbPath,
          'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
          [`item${i}`, data.title, data.count, data.tags],
        );
        await manager.exec(
          config.dbPath,
          'INSERT INTO item_tags (item_id, tag) VALUES (?, ?)',
          [`item${i}`, `tag${i}`],
        );
        await manager.exec(
          config.dbPath,
          'INSERT INTO item_tags (item_id, tag) VALUES (?, ?)',
          [`item${i}`, `category${i % 5}`],
        );
      }
      await manager.exec(config.dbPath, 'COMMIT');
      // Warm page cache
      await manager.exec(
        config.dbPath,
        `SELECT t.* FROM test_items t JOIN item_tags it ON t.id = it.item_id WHERE it.tag = 'tag50' AND t.count > 30 AND t.count < 70 ORDER BY t.count DESC`,
      );
    }

    ctx.start();
    const results = await manager.exec(
      config.dbPath,
      `SELECT t.* FROM test_items t JOIN item_tags it ON t.id = it.item_id WHERE it.tag = 'tag50' AND t.count > 30 AND t.count < 70 ORDER BY t.count DESC`,
    );
    ctx.end();
  });

  BENCHMARK('SQLite', 'Live query update (100 items)', {
    warmup: 5,
    iterations: 20,
    preserveData: true,
  }, async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_100k_lq.db');
    await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);
    await manager.exec(
      config.dbPath,
      'CREATE INDEX IF NOT EXISTS idx_count ON test_items(count)',
    );
    const N = 100;
    const item0 = await manager.exec(
      config.dbPath,
      'SELECT count FROM test_items WHERE id = ?',
      ['item0'],
    );
    const item0Count = item0.resultRows?.[0]?.count ?? 0;
    const newCount = item0Count > 99000 ? 0 : 100000;
    ctx.start();
    for (let i = 0; i < N; i++) {
      await manager.exec(
        config.dbPath,
        'UPDATE test_items SET count = ? WHERE id = ?',
        [newCount, `item${i}`],
      );
    }
    const results = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 99000',
    );
    ctx.end();
    assert(results.resultRows !== undefined);
    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Live query update (1k items)', {
    warmup: 5,
    iterations: 20,
    preserveData: true,
  }, async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_100k_lq.db');
    await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);
    await manager.exec(
      config.dbPath,
      'CREATE INDEX IF NOT EXISTS idx_count ON test_items(count)',
    );
    const N = 1000;
    const item0 = await manager.exec(
      config.dbPath,
      'SELECT count FROM test_items WHERE id = ?',
      ['item0'],
    );
    const item0Count = item0.resultRows?.[0]?.count ?? 0;
    const newCount = item0Count > 99000 ? 0 : 100000;
    ctx.start();
    for (let i = 0; i < N; i++) {
      await manager.exec(
        config.dbPath,
        'UPDATE test_items SET count = ? WHERE id = ?',
        [newCount, `item${i}`],
      );
    }
    const results = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 99000',
    );
    ctx.end();
    assert(results.resultRows !== undefined);
    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Live query update (10k items)', {
    warmup: 5,
    iterations: 20,
    preserveData: true,
  }, async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig('temp_bench_sqlite_100k_lq.db');
    await manager.openDatabase(config);
    await populateDatabase(manager, config.dbPath, 100000);
    await manager.exec(
      config.dbPath,
      'CREATE INDEX IF NOT EXISTS idx_count ON test_items(count)',
    );
    const N = 10000;
    const item0 = await manager.exec(
      config.dbPath,
      'SELECT count FROM test_items WHERE id = ?',
      ['item0'],
    );
    const item0Count = item0.resultRows?.[0]?.count ?? 0;
    const newCount = item0Count > 99000 ? 0 : 100000;
    ctx.start();
    for (let i = 0; i < N; i++) {
      await manager.exec(
        config.dbPath,
        'UPDATE test_items SET count = ? WHERE id = ?',
        [newCount, `item${i}`],
      );
    }
    const results = await manager.exec(
      config.dbPath,
      'SELECT * FROM test_items WHERE count > 99000',
    );
    ctx.end();
    assert(results.resultRows !== undefined);
    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Count operation', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);

    // Create a few items
    await manager.exec(config.dbPath, 'BEGIN TRANSACTION');
    for (let i = 0; i < 10; i++) {
      await manager.exec(
        config.dbPath,
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
        [`item${i}`, `Repo item ${i}`, i, JSON.stringify(['repo', 'test'])],
      );
    }
    await manager.exec(config.dbPath, 'COMMIT');

    ctx.start();
    // Test count operation
    const countResult = await manager.exec(
      config.dbPath,
      'SELECT COUNT(*) as count FROM test_items',
    );
    ctx.end();

    const count = countResult.resultRows?.[0]?.count;
    assert(count === 10, 'Table should contain 10 items');

    return async () => await manager.closeDatabase(config.dbPath);
  });

  BENCHMARK('SQLite', 'Keys operation', async (ctx) => {
    const manager = await getSQLiteWorkerManager();
    const config = createSQLiteConfig(`temp_bench_sqlite_${uniqueId()}.db`);

    const dbId = await manager.openDatabase(config);

    // Create a few items
    await manager.exec(config.dbPath, 'BEGIN TRANSACTION');
    for (let i = 0; i < 10; i++) {
      await manager.exec(
        config.dbPath,
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
        [`item${i}`, `Repo item ${i}`, i, JSON.stringify(['repo', 'test'])],
      );
    }
    await manager.exec(config.dbPath, 'COMMIT');

    ctx.start();
    // Test keys operation
    const keysResult = await manager.exec(
      config.dbPath,
      'SELECT id FROM test_items',
    );
    ctx.end();

    const keys = keysResult.resultRows?.map((row: any) => row.id) || [];
    assert(keys.length === 10, 'Table should have 10 keys');

    return async () => await manager.closeDatabase(config.dbPath);
  });
}
