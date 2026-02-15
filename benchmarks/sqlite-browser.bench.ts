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
      const item = createTestData(1)[0];
      await manager.exec(
        dbPath,
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
        [`item${i}`, item.title, item.count, item.tags],
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

  BENCHMARK('SQLite', 'Create table', async (ctx) => {
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

  BENCHMARK('SQLite', 'Read 100k items', async (ctx) => {
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

  BENCHMARK('SQLite', 'Create single item', async (ctx) => {
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

  BENCHMARK('SQLite', 'Read item by ID', async (ctx) => {
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

  BENCHMARK('SQLite', 'Simple query', async (ctx) => {
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

  BENCHMARK('SQLite', 'Complex query with sort', async (ctx) => {
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
    // Complex query with sorting
    const results = await manager.exec(
      config.dbPath,
      `
      SELECT * FROM test_items 
      WHERE count > 30 AND count < 70 AND tags LIKE '%tag50%'
      ORDER BY count DESC
    `,
    );
    ctx.end();

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
