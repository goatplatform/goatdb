import { BENCHMARK } from './mod.ts';
import { assert } from '../base/error.ts';
import { uniqueId } from '../base/common.ts';
import { getRuntime } from '../base/runtime/index.ts';
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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_count ON test_items(count)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_tags (
      item_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (item_id, tag)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag)`);
}

// Fast-unsafe pragmas: maximum write throughput, no durability guarantees
function applyFastUnsafePragmas(db: any): void {
  try {
    db.exec('PRAGMA synchronous = OFF');
    db.exec('PRAGMA journal_mode = MEMORY');
    db.exec('PRAGMA cache_size = -65536');
    db.exec('PRAGMA locking_mode = EXCLUSIVE');
    db.exec('PRAGMA temp_store = MEMORY');
    db.exec('PRAGMA mmap_size = 268435456');
  } catch (e) {
    console.warn('Some PRAGMA settings failed:', e);
  }
}

async function populateDatabase(
  dbPath: string,
  count: number,
): Promise<void> {
  const { DatabaseSync } = await import('node:sqlite');

  const db = new DatabaseSync(dbPath);
  applyFastUnsafePragmas(db);
  createTestTable(db);

  const countResult = db.prepare('SELECT COUNT(*) as count FROM test_items')
    .get() as { count: number } | undefined;
  const currentCount = countResult?.count ?? 0;

  if (currentCount < count) {
    const testData = createTestData(count);
    const stmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    const tagStmt = db.prepare(
      'INSERT INTO item_tags (item_id, tag) VALUES (?, ?)',
    );
    db.exec('BEGIN TRANSACTION');
    for (let i = currentCount; i < count; i++) {
      const d = testData[i];
      stmt.run(`item${i}`, d.title, d.count, d.tags);
      tagStmt.run(`item${i}`, `tag${i}`);
      tagStmt.run(`item${i}`, `category${i % 5}`);
    }
    db.exec('COMMIT');
  }

  db.close();
}

let _sqliteFastShared100kPath: string | undefined;
let _warmSqliteFast100: { db: any; stmt: any } | undefined;
let _warmSqliteFast1k: { db: any; stmt: any } | undefined;
let _warmSqliteFast10k: { db: any; stmt: any } | undefined;
let _warmSqliteFastSort100: { db: any; stmt: any } | undefined;

async function getSqliteFastShared100kPath(): Promise<string> {
  if (_sqliteFastShared100kPath !== undefined) return _sqliteFastShared100kPath;
  const os = await import('node:os');
  const fs = await import('node:fs');
  const dir = path.join(
    os.tmpdir(),
    `goatdb-bench-sqlite-fast-100k-${uniqueId()}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  _sqliteFastShared100kPath = path.join(dir, 'shared_100k.db');
  return _sqliteFastShared100kPath;
}

export default function setup(): void {
  // Skip SQLite benchmarks in browser - only run in Deno/Node
  if (getRuntime().id === 'browser') {
    return; // No SQLite benchmarks in browser
  }

  BENCHMARK('SQLite Fast-Unsafe', 'Create instance', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-create');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    ctx.start();
    const db = new DatabaseSync(dbPath);
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Open database (empty)', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-table');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
    ctx.start();
    createTestTable(db);
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Open database (100k items)', {
    warmup: 1,
    iterations: 7,
  }, async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-100k');
    const dbPath = path.join(tempDir, 'temp_bench_sqlite_100k.db');

    await populateDatabase(dbPath, 100000);

    ctx.start();
    const db = new DatabaseSync(dbPath);
    ctx.end();
    applyFastUnsafePragmas(db);

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Read 100k items (cold)', {
    warmup: 1,
    iterations: 7,
  }, async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-read-100k');
    const dbPath = path.join(tempDir, 'temp_bench_sqlite_100k.db');

    await populateDatabase(dbPath, 100000);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
    ctx.start();
    const res = db.prepare('SELECT * FROM test_items').all();
    ctx.end();

    assert(res.length === 100000, 'Database should have 100000 items');

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Read 100k items (warm)', {
    warmup: 1,
    iterations: 7,
  }, async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-read-100k-warm');
    const dbPath = path.join(tempDir, 'temp_bench_sqlite_100k.db');

    await populateDatabase(dbPath, 100000);
    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);

    // Warm SQLite page cache with one untimed full scan
    db.prepare('SELECT * FROM test_items').all();

    ctx.start();
    const res = db.prepare('SELECT * FROM test_items').all();
    ctx.end();

    assert(res.length === 100000, 'Database should have 100000 items');
    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Write 100k items', {
    warmup: 1,
    iterations: 7,
  }, async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-write-100k');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_write_100k.db`);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
    createTestTable(db);

    const testData = createTestData(100000);
    const stmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );

    ctx.start();
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < 100000; i++) {
      const data = testData[i];
      stmt.run(`item${i}`, data.title, data.count, data.tags);
    }
    db.exec('COMMIT');
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Create item', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-create-single');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
    createTestTable(db);

    ctx.start();
    const stmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    stmt.run('test1', 'Test item', 1, JSON.stringify(['test', 'benchmark']));
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Read item', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-read-item');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
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
    const readItem = readStmt.get('foo') as
      | { title: string; count: number }
      | undefined;
    ctx.end();

    assert(readItem?.title === 'Test read item', 'Item title should match');
    assert(readItem?.count === 42, 'Item count should match');

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Update item', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-update');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
    createTestTable(db);
    const itemId = uniqueId();

    // Create the item
    const insertStmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    insertStmt.run(itemId, 'Original title', 1, JSON.stringify(['original']));

    ctx.start();
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
    ctx.end();

    // Verify updates
    const readStmt = db.prepare('SELECT * FROM test_items WHERE id = ?');
    const item = readStmt.get(itemId) as
      | { title: string; count: number }
      | undefined;
    assert(item?.title === 'Updated title', 'Item title should be updated');
    assert(item?.count === 99, 'Item count should be updated');

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Bulk create 100 items', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-bulk-create');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
    createTestTable(db);

    const testData = createTestData(100);

    const stmt = db.prepare(
      'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
    );
    ctx.start();
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      const data = testData[i];
      stmt.run(`item${i}`, data.title, data.count, data.tags);
    }
    db.exec('COMMIT');
    ctx.end();

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Bulk read 100 items', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-bulk-read');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
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
      const item = readStmt.get(`item${i}`) as { title: string } | undefined;
      assert(item?.title === `Item ${i}`, 'Item title should match');
    }
    ctx.end();

    return () => db.close();
  });

  BENCHMARK(
    'SQLite Fast-Unsafe',
    'Filter query cold (100 items)',
    async (ctx) => {
      const { DatabaseSync } = await import('node:sqlite');
      const tempDir = await ctx.tempDir('sqlite-fast-simple-query');
      const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

      const db = new DatabaseSync(dbPath);
      applyFastUnsafePragmas(db);
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

      return () => db.close();
    },
  );

  BENCHMARK('SQLite Fast-Unsafe', 'Filter query cold (100k → 1k results)', {
    warmup: 2,
    iterations: 10,
    preserveData: true,
  }, async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const shared100kPath = await getSqliteFastShared100kPath();
    await populateDatabase(shared100kPath, 100000);
    const db = new DatabaseSync(shared100kPath);
    applyFastUnsafePragmas(db);
    ctx.start();
    const results = db.prepare('SELECT * FROM test_items WHERE count > 98999')
      .all();
    ctx.end();
    assert(results.length === 1000, 'Query should return 1000 items');
    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Filter query cold (100k → 10k results)', {
    warmup: 2,
    iterations: 10,
    preserveData: true,
  }, async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const shared100kPath = await getSqliteFastShared100kPath();
    await populateDatabase(shared100kPath, 100000);
    const db = new DatabaseSync(shared100kPath);
    applyFastUnsafePragmas(db);
    ctx.start();
    const results = db.prepare('SELECT * FROM test_items WHERE count > 89999')
      .all();
    ctx.end();
    assert(results.length === 10000, 'Query should return 10000 items');
    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Filter query warm (100 items)', {
    preserveData: true,
  }, async (ctx) => {
    if (!_warmSqliteFast100) {
      const { DatabaseSync } = await import('node:sqlite');
      const tempDir = await ctx.tempDir('sqlite-fast-warm-query-100');
      const dbPath = path.join(tempDir, 'warm_query_100.db');
      const db = new DatabaseSync(dbPath);
      applyFastUnsafePragmas(db);
      createTestTable(db);
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
      const stmt = db.prepare('SELECT * FROM test_items WHERE count > 50');
      stmt.all(); // warm page cache
      _warmSqliteFast100 = { db, stmt };
    }

    ctx.start();
    const results = _warmSqliteFast100.stmt.all();
    ctx.end();

    assert(results.length === 49, 'Query should return 49 items');
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Filter query warm (100k → 1k results)', {
    warmup: 2,
    iterations: 10,
    preserveData: true,
  }, async (ctx) => {
    if (!_warmSqliteFast1k) {
      const { DatabaseSync } = await import('node:sqlite');
      const tempDir = await ctx.tempDir('sqlite-fast-warm-query-1k');
      const dbPath = path.join(tempDir, 'warm_query_1k.db');
      await populateDatabase(dbPath, 100000);
      const db = new DatabaseSync(dbPath);
      applyFastUnsafePragmas(db);
      const stmt = db.prepare('SELECT * FROM test_items WHERE count > 98999');
      stmt.all(); // warm page cache
      _warmSqliteFast1k = { db, stmt };
    }

    ctx.start();
    const results = _warmSqliteFast1k.stmt.all();
    ctx.end();

    assert(results.length === 1000, 'Query should return 1000 items');
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Filter query warm (100k → 10k results)', {
    warmup: 2,
    iterations: 10,
    preserveData: true,
  }, async (ctx) => {
    if (!_warmSqliteFast10k) {
      const { DatabaseSync } = await import('node:sqlite');
      const tempDir = await ctx.tempDir('sqlite-fast-warm-query-10k');
      const dbPath = path.join(tempDir, 'warm_query_10k.db');
      await populateDatabase(dbPath, 100000);
      const db = new DatabaseSync(dbPath);
      applyFastUnsafePragmas(db);
      const stmt = db.prepare('SELECT * FROM test_items WHERE count > 89999');
      stmt.all(); // warm page cache
      _warmSqliteFast10k = { db, stmt };
    }

    ctx.start();
    const results = _warmSqliteFast10k.stmt.all();
    ctx.end();

    assert(results.length === 10000, 'Query should return 10000 items');
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Filter + sort query warm (100 items)', {
    preserveData: true,
  }, async (ctx) => {
    if (!_warmSqliteFastSort100) {
      const { DatabaseSync } = await import('node:sqlite');
      const tempDir = await ctx.tempDir('sqlite-fast-warm-sort-query-100');
      const dbPath = path.join(tempDir, 'warm_sort_query_100.db');
      const db = new DatabaseSync(dbPath);
      applyFastUnsafePragmas(db);
      createTestTable(db);
      const testData = createTestData(100);
      const insertStmt = db.prepare(
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
      );
      const tagStmt = db.prepare(
        'INSERT INTO item_tags (item_id, tag) VALUES (?, ?)',
      );
      db.exec('BEGIN TRANSACTION');
      for (let i = 0; i < 100; i++) {
        const data = testData[i];
        insertStmt.run(`item${i}`, data.title, data.count, data.tags);
        tagStmt.run(`item${i}`, `tag${i}`);
        tagStmt.run(`item${i}`, `category${i % 5}`);
      }
      db.exec('COMMIT');
      const stmt = db.prepare(`
        SELECT t.* FROM test_items t
        JOIN item_tags it ON t.id = it.item_id
        WHERE it.tag = 'tag50' AND t.count > 30 AND t.count < 70
        ORDER BY t.count DESC
      `);
      stmt.all(); // warm page cache
      _warmSqliteFastSort100 = { db, stmt };
    }

    ctx.start();
    _warmSqliteFastSort100.stmt.all();
    ctx.end();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Live query update (100 items)', {
    warmup: 5,
    iterations: 20,
    preserveData: true,
  }, async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const shared100kPath = await getSqliteFastShared100kPath();
    await populateDatabase(shared100kPath, 100000);
    const db = new DatabaseSync(shared100kPath);
    applyFastUnsafePragmas(db);
    db.exec('CREATE INDEX IF NOT EXISTS idx_count ON test_items(count)');
    const N = 100;
    const queryStmt = db.prepare(
      'SELECT * FROM test_items WHERE count > 99000',
    );
    const updateStmt = db.prepare(
      'UPDATE test_items SET count = ? WHERE id = ?',
    );
    const item0Count =
      (db.prepare('SELECT count FROM test_items WHERE id = ?').get(
        'item0',
      ) as any).count as number;
    const newCount = item0Count > 99000 ? 0 : 100000;
    ctx.start();
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < N; i++) {
      updateStmt.run(newCount, `item${i}`);
    }
    db.exec('COMMIT');
    const results = queryStmt.all();
    ctx.end();
    assert(results.length > 0 && results.length <= 100000);
    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Live query update (1k items)', {
    warmup: 5,
    iterations: 20,
    preserveData: true,
  }, async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const shared100kPath = await getSqliteFastShared100kPath();
    await populateDatabase(shared100kPath, 100000);
    const db = new DatabaseSync(shared100kPath);
    applyFastUnsafePragmas(db);
    db.exec('CREATE INDEX IF NOT EXISTS idx_count ON test_items(count)');
    const N = 1000;
    const queryStmt = db.prepare(
      'SELECT * FROM test_items WHERE count > 99000',
    );
    const updateStmt = db.prepare(
      'UPDATE test_items SET count = ? WHERE id = ?',
    );
    const item0Count =
      (db.prepare('SELECT count FROM test_items WHERE id = ?').get(
        'item0',
      ) as any).count as number;
    const newCount = item0Count > 99000 ? 0 : 100000;
    ctx.start();
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < N; i++) {
      updateStmt.run(newCount, `item${i}`);
    }
    db.exec('COMMIT');
    const results = queryStmt.all();
    ctx.end();
    assert(results.length > 0 && results.length <= 100000);
    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Live query update (10k items)', {
    warmup: 5,
    iterations: 20,
    preserveData: true,
  }, async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const shared100kPath = await getSqliteFastShared100kPath();
    await populateDatabase(shared100kPath, 100000);
    const db = new DatabaseSync(shared100kPath);
    applyFastUnsafePragmas(db);
    db.exec('CREATE INDEX IF NOT EXISTS idx_count ON test_items(count)');
    const N = 10000;
    const queryStmt = db.prepare(
      'SELECT * FROM test_items WHERE count > 99000',
    );
    const updateStmt = db.prepare(
      'UPDATE test_items SET count = ? WHERE id = ?',
    );
    const item0Count =
      (db.prepare('SELECT count FROM test_items WHERE id = ?').get(
        'item0',
      ) as any).count as number;
    const newCount = item0Count > 99000 ? 0 : 100000;
    ctx.start();
    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < N; i++) {
      updateStmt.run(newCount, `item${i}`);
    }
    db.exec('COMMIT');
    const results = queryStmt.all();
    ctx.end();
    assert(results.length > 0 && results.length <= 100000);
    return () => db.close();
  });

  BENCHMARK(
    'SQLite Fast-Unsafe',
    'Filter + sort query cold (100 items)',
    async (ctx) => {
      const { DatabaseSync } = await import('node:sqlite');
      const tempDir = await ctx.tempDir('sqlite-fast-complex-query');
      const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

      const db = new DatabaseSync(dbPath);
      applyFastUnsafePragmas(db);
      createTestTable(db);

      // Create test data
      const testData = createTestData(100);
      const insertStmt = db.prepare(
        'INSERT INTO test_items (id, title, count, tags) VALUES (?, ?, ?, ?)',
      );
      const tagStmt = db.prepare(
        'INSERT INTO item_tags (item_id, tag) VALUES (?, ?)',
      );
      db.exec('BEGIN TRANSACTION');
      for (let i = 0; i < 100; i++) {
        const data = testData[i];
        insertStmt.run(`item${i}`, data.title, data.count, data.tags);
        tagStmt.run(`item${i}`, `tag${i}`);
        tagStmt.run(`item${i}`, `category${i % 5}`);
      }
      db.exec('COMMIT');

      ctx.start();
      // Complex query with sorting
      const query = db.prepare(`
        SELECT t.* FROM test_items t
        JOIN item_tags it ON t.id = it.item_id
        WHERE it.tag = 'tag50' AND t.count > 30 AND t.count < 70
        ORDER BY t.count DESC
      `);
      const results = query.all();
      ctx.end();

      return () => db.close();
    },
  );

  BENCHMARK('SQLite Fast-Unsafe', 'Count operation', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-count');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
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

    ctx.start();
    // Test count operation
    const countResult = db.prepare('SELECT COUNT(*) as count FROM test_items')
      .get() as { count: number } | undefined;
    const count = countResult?.count ?? 0;
    ctx.end();

    assert(count === 10, 'Table should contain 10 items');

    return () => db.close();
  });

  BENCHMARK('SQLite Fast-Unsafe', 'Keys operation', async (ctx) => {
    const { DatabaseSync } = await import('node:sqlite');
    const tempDir = await ctx.tempDir('sqlite-fast-keys');
    const dbPath = path.join(tempDir, `temp_bench_sqlite_${uniqueId()}.db`);

    const db = new DatabaseSync(dbPath);
    applyFastUnsafePragmas(db);
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

    ctx.start();
    // Test keys operation
    const keysResult = db.prepare('SELECT id FROM test_items').all();
    const keys = keysResult.map((row: any) => row.id);
    ctx.end();

    assert(keys.length === 10, 'Table should have 10 keys');

    return () => db.close();
  });
}
