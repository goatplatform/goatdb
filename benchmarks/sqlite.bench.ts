import { DatabaseSync } from 'node:sqlite';
import { assert } from '../base/error.ts';
import * as path from '@std/path';
import { uniqueId } from '../base/common.ts';

// Helper function to create a temp database file path for testing
function createTempDbPath(): string {
  return path.join(Deno.cwd(), `temp_bench_sqlite_${uniqueId()}.db`);
}

// Helper function to remove the temp database file
async function cleanupTempDb(dbPath: string): Promise<void> {
  try {
    await Deno.remove(dbPath);
  } catch (e) {
    console.error('Failed to clean up temp database file:', e);
  }
}

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
function createTestTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]'
    )
  `);
}

// Benchmark suite for basic operations
Deno.bench('SQLite: Create instance', {
  warmup: 1,
}, async (ctx) => {
  const dbPath = createTempDbPath();
  try {
    ctx.start();
    const db = new DatabaseSync(dbPath);
    ctx.end();
    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

Deno.bench('SQLite: Create table', {
  warmup: 1,
}, async (ctx) => {
  const dbPath = createTempDbPath();
  try {
    const db = new DatabaseSync(dbPath);
    ctx.start();
    createTestTable(db);
    ctx.end();
    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

function populateDatabase(
  dbPath: string,
  count: number,
): void {
  const db = new DatabaseSync(dbPath);
  createTestTable(db);

  const currentCount =
    db.prepare('SELECT COUNT(*) as count FROM test_items').get().count;

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

Deno.bench('SQLite: Open database (100k items)', {
  n: 10,
}, async (ctx) => {
  const dbPath = path.join(Deno.cwd(), 'temp_bench_sqlite_100k.db');
  try {
    await populateDatabase(dbPath, 100000);

    ctx.start();
    const db = new DatabaseSync(dbPath);
    // const res = db.prepare('SELECT * FROM test_items').all();
    ctx.end();

    // assert(res.length === 100000, 'Database should have 100000 items');
    db.close();
  } finally {
    // Not deleting large test database to allow for repeated benchmarks
    // await cleanupTempDb(dbPath);
  }
});

Deno.bench('SQLite: Read 100k items', {
  n: 10,
}, async (ctx) => {
  const dbPath = path.join(Deno.cwd(), 'temp_bench_sqlite_100k.db');
  try {
    await populateDatabase(dbPath, 100000);

    ctx.start();
    const db = new DatabaseSync(dbPath);
    const res = db.prepare('SELECT * FROM test_items').all();
    ctx.end();

    assert(res.length === 100000, 'Database should have 100000 items');
    db.close();
  } finally {
    // Not deleting large test database to allow for repeated benchmarks
    // await cleanupTempDb(dbPath);
  }
});

Deno.bench('SQLite: Create single item', {
  warmup: 1,
}, async (ctx) => {
  const dbPath = createTempDbPath();
  try {
    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    ctx.start();
    const stmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    stmt.run('test1', 'Test item', 1, JSON.stringify(['test', 'benchmark']));
    ctx.end();

    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

Deno.bench('SQLite: Read item by ID', {
  warmup: 1,
}, async (ctx) => {
  const dbPath = createTempDbPath();
  try {
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
    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

Deno.bench('SQLite: Update item', {
  warmup: 1,
}, async (ctx) => {
  const dbPath = createTempDbPath();
  try {
    const db = new DatabaseSync(dbPath);
    createTestTable(db);
    const itemId = uniqueId();

    // Create the item
    const insertStmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    insertStmt.run(itemId, 'Original title', 1, JSON.stringify(['original']));

    // Update the item
    ctx.start();
    const updateStmt = db.prepare(
      'UPDATE test_items SET title = ?, count = ?, tags = ? WHERE id = ?',
    );
    updateStmt.run(
      'Updated title',
      99,
      JSON.stringify(['updated', 'modified']),
      itemId,
    );
    ctx.end();

    // Verify updates
    const readStmt = db.prepare('SELECT * FROM test_items WHERE id = ?');
    const item = readStmt.get(itemId);
    assert(item.title === 'Updated title', 'Item title should be updated');
    assert(item.count === 99, 'Item count should be updated');

    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

Deno.bench('SQLite: Bulk create 100 items', {
  warmup: 1,
}, async (ctx) => {
  const dbPath = createTempDbPath();
  try {
    const db = new DatabaseSync(dbPath);
    createTestTable(db);

    const testData = createTestData(100);

    ctx.start();
    const stmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      stmt.run(`item${i}`, data.title, data.count, data.tags);
    }
    db.exec('COMMIT');
    ctx.end();

    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

Deno.bench('SQLite: Bulk read 100 items', {
  warmup: 1,
}, async (ctx) => {
  const dbPath = createTempDbPath();
  try {
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

    // Benchmark reading items
    ctx.start();
    const readStmt = db.prepare('SELECT * FROM test_items WHERE id = ?');
    for (let i = 0; i < 100; i++) {
      const item = readStmt.get(`item${i}`);
      assert(item.title === `Item ${i}`, 'Item title should match');
    }
    ctx.end();

    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

// Query benchmarks
Deno.bench('SQLite: Simple query', {
  warmup: 1,
}, async (ctx) => {
  const dbPath = createTempDbPath();
  try {
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

    ctx.start();
    // Run query for items with count > 50
    const query = db.prepare('SELECT * FROM test_items WHERE count > 50');
    const results = query.all();
    ctx.end();

    assert(results.length === 49, 'Query should return 49 items');
    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

Deno.bench('SQLite: Complex query with sort', {
  warmup: 1,
}, async (ctx) => {
  const dbPath = createTempDbPath();
  try {
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
    // Note: For the tags check, we're using a simple string search in the JSON
    ctx.start();
    const query = db.prepare(`
      SELECT * FROM test_items 
      WHERE count > 30 AND count < 70 AND tags LIKE '%tag50%'
      ORDER BY count DESC
    `);
    const results = query.all();
    ctx.end();

    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

// Repository operations benchmark
Deno.bench('SQLite: Count operation', async (ctx) => {
  const dbPath = createTempDbPath();
  try {
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
    ctx.start();
    const countResult = db.prepare('SELECT COUNT(*) as count FROM test_items')
      .get();
    const count = countResult.count;
    ctx.end();

    assert(count === 10, 'Table should contain 10 items');
    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});

Deno.bench('SQLite: Keys operation', async (ctx) => {
  const dbPath = createTempDbPath();
  try {
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
    ctx.start();
    const keysResult = db.prepare('SELECT id FROM test_items').all();
    const keys = keysResult.map((row) => row.id);
    ctx.end();

    assert(keys.length === 10, 'Table should have 10 keys');
    db.close();
  } finally {
    await cleanupTempDb(dbPath);
  }
});
