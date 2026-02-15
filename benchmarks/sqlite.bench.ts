import { BENCHMARK } from './mod.ts';
import { assert } from '../base/error.ts';
import { uniqueId } from '../base/common.ts';
import { isBrowser } from '../base/common.ts';
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

// Helper to create test schema in SQLite
function createTestTable(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]'
    )
  `);
}

async function populateDatabase(
  dbPath: string,
  count: number,
): Promise<void> {
  // Dynamic import to avoid issues in browser
  const { DatabaseSync } = await import('node:sqlite');

  const db = new DatabaseSync(dbPath);
  createTestTable(db);

  const countResult = db.prepare('SELECT COUNT(*) as count FROM test_items')
    .get() as { count: number } | undefined;
  const currentCount = countResult?.count ?? 0;

  if (currentCount < count) {
    const stmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    db.exec('BEGIN TRANSACTION');
    for (let i = currentCount; i < count; i++) {
      const item = createTestData(1)[0];
      stmt.run(`item${i}`, item.title, item.count, item.tags);
    }
    db.exec('COMMIT');
  }

  db.close();
}

export default function setup(): void {
  // Skip SQLite benchmarks in browser - only run in Deno/Node
  if (isBrowser()) {
    return; // No SQLite benchmarks in browser
  }

  BENCHMARK('SQLite', 'Create instance', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-create');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    ctx.start();
    const db = new DatabaseSync(dbPath);
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Create table', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-table');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);

    ctx.start();
    createTestTable(db);
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Open database (100k items)', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-100k');
    const dbPath = path.join(tempDir, 'temp_bench_sqlite_100k.db');

    await populateDatabase(dbPath, 100000);

    ctx.start();
    const db = new DatabaseSync(dbPath);
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Read 100k items', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-read-100k');
    const dbPath = path.join(tempDir, 'temp_bench_sqlite_100k.db');

    await populateDatabase(dbPath, 100000);

    const db = new DatabaseSync(dbPath);

    ctx.start();
    const stmt = db.prepare('SELECT * FROM test_items');
    const res = stmt.all();
    ctx.end();

    assert(res.length === 100000, 'Database should have 100000 items');

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Create single item', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-create-single');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    ctx.start();
    const stmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    stmt.run('test1', 'Test item', 1, JSON.stringify(['test', 'benchmark']));
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Read item by ID', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-read-item');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    // Create the item first
    const insertStmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    insertStmt.run(
      'foo',
      'Test read item',
      42,
      JSON.stringify(['read', 'test']),
    );

    ctx.start();
    // Now read the item
    const readStmt = db.prepare('SELECT * FROM test_items WHERE id = ?');
    const readItem = readStmt.get('foo');
    ctx.end();

    assert(readItem.title === 'Test read item', 'Item title should match');
    assert(readItem.count === 42, 'Item count should match');

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Update item', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-update');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    createTestTable(db);
    const itemId = uniqueId();

    // Create the item
    const insertStmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    insertStmt.run(itemId, 'Original title', 1, JSON.stringify(['original']));

    // Update the item
    const updateStmt = db.prepare(
      'UPDATE test_items SET title = ?, count = ?, tags = ? WHERE id = ?',
    );
    updateStmt.run(
      'Updated title',
      99,
      JSON.stringify(['updated', 'modified']),
      itemId,
    );

    // Verify updates
    const readStmt = db.prepare('SELECT * FROM test_items WHERE id = ?');
    const item = readStmt.get(itemId);
    assert(item.title === 'Updated title', 'Item title should be updated');
    assert(item.count === 99, 'Item count should be updated');

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Bulk create 100 items', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-bulk-create');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    const testData = createTestData(100);

    const stmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      stmt.run(`item${i}`, data.title, data.count, data.tags);
    }
    db.exec('COMMIT');

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Bulk read 100 items', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-bulk-read');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    // Create items first
    const testData = createTestData(100);
    const insertStmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      insertStmt.run(`item${i}`, data.title, data.count, data.tags);
    }
    db.exec('COMMIT');

    ctx.start();
    // Benchmark reading items
    const readStmt = db.prepare('SELECT * FROM test_items WHERE id = ?');
    for (let i = 0; i < 100; i++) {
      const item = readStmt.get(`item${i}`);
      assert(item.title === `Item ${i}`, 'Item title should match');
    }
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Simple query', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-simple-query');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    // Create test data
    const testData = createTestData(100);
    const insertStmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      insertStmt.run(`item${i}`, data.title, data.count, data.tags);
    }
    db.exec('COMMIT');

    // Run query for items with count > 50
    const query = db.prepare('SELECT * FROM test_items WHERE count > 50');
    const results = query.all();

    assert(results.length === 49, 'Query should return 49 items');

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Complex query with sort', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-complex-query');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    // Create test data
    const testData = createTestData(100);
    const insertStmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      insertStmt.run(`item${i}`, data.title, data.count, data.tags);
    }
    db.exec('COMMIT');

    // Complex query with sorting
    const query = db.prepare(`
      SELECT * FROM test_items 
      WHERE count > 30 AND count < 70 AND tags LIKE '%tag50%'
      ORDER BY count DESC
    `);
    const results = query.all();

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Count operation', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-count');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    // Create a few items
    const insertStmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < 10; i++) {
      insertStmt.run(
        `item${i}`,
        `Repo item ${i}`,
        i,
        JSON.stringify(['repo', 'test']),
      );
    }
    db.exec('COMMIT');

    // Test count operation
    const countResult = db.prepare('SELECT COUNT(*) as count FROM test_items')
      .get();
    const count = countResult.count;

    assert(count === 10, 'Table should contain 10 items');

    return () => db.close();
  });

  BENCHMARK('SQLite', 'Keys operation', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-keys');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    // Create a few items
    const insertStmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < 10; i++) {
      insertStmt.run(
        `item${i}`,
        `Repo item ${i}`,
        i,
        JSON.stringify(['repo', 'test']),
      );
    }
    db.exec('COMMIT');

    // Test keys operation
    const keysResult = db.prepare('SELECT id FROM test_items').all();
    const keys = keysResult.map((row: any) => row.id);

    assert(keys.length === 10, 'Table should have 10 keys');

    return () => db.close();
  });
}
