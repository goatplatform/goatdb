import { assert } from '../base/error.ts';
import { isBrowser } from '../base/common.ts';
import { sleep } from '../base/sleep.ts';

export interface SQLiteWorkerConfig {
  dbPath: string;
  unsafe?: boolean;
  debug?: boolean;
}

interface SQLiteConnection {
  dbId: string;
  filename: string;
  refCount: number;
}

type Promiser = (type: string, args?: any) => Promise<any>;

interface SQLiteResult {
  type: 'exec' | 'open' | 'close' | 'error';
  result: {
    resultRows?: any[];
    changes?: number;
    message?: string;
    dbId?: string;
  };
}

let gSQLiteWorker: SQLiteWorkerManager | undefined;

export async function getSQLiteWorkerManager(): Promise<SQLiteWorkerManager> {
  if (gSQLiteWorker === undefined) {
    gSQLiteWorker = new SQLiteWorkerManager();
    await gSQLiteWorker.readyPromise();
  }
  return gSQLiteWorker;
}

export class SQLiteWorkerManager {
  private _promiser: Promiser | null = null;
  private _ready: boolean = false;
  private _readyPromise: Promise<void>;
  private readonly _connections: Map<string, SQLiteConnection> = new Map();
  private readonly _debug: boolean;

  constructor(debug = false) {
    this._debug = debug;
    this._readyPromise = this._initialize().catch((err) => {
      console.error('SQLite worker manager initialization failed:', err);
      return Promise.reject(err);
    });
  }

  async readyPromise(): Promise<void> {
    await this._readyPromise;
  }

  private async _initialize(): Promise<void> {
    if (!isBrowser()) {
      throw new Error(
        'SQLite worker manager only supported in browser environment',
      );
    }

    await this._loadPromiserScript();

    this._promiser = await new Promise<Promiser>((resolve, reject) => {
      const factory = (globalThis as {
        sqlite3Worker1Promiser?: any;
      }).sqlite3Worker1Promiser;

      if (!factory) {
        reject(new Error('sqlite3Worker1Promiser not available'));
        return;
      }

      const promiser = factory({
        onready: () => {
          if (this._debug) {
            console.log('✅ SQLite worker manager initialized');
          }
          resolve(promiser);
        },
        worker: () => new Worker('/assets/sqlite3-worker1.js'),
      });
    });

    this._ready = true;
  }

  async openDatabase(config: SQLiteWorkerConfig): Promise<string> {
    assert(
      this._ready,
      'SQLite worker manager not ready. Call readyPromise() first.',
    );
    assert(this._promiser !== null, 'SQLite worker promiser not initialized');

    const filename = `file:${config.dbPath}?vfs=opfs`;

    const existing = this._connections.get(config.dbPath);
    if (existing) {
      existing.refCount++;
      return existing.dbId;
    }

    const openResult: SQLiteResult = await this._promiser('open', { filename });

    if (openResult.type === 'error') {
      throw new Error(
        `Failed to open database ${config.dbPath}: ${openResult.result.message}`,
      );
    }

    const dbId = openResult.result.dbId!;
    this._connections.set(config.dbPath, {
      dbId,
      filename,
      refCount: 1,
    });

    await this._applyPragmaSettings(dbId, config);
    await this._createTestTable(dbId);

    if (this._debug) {
      console.log(`📂 Opened database ${config.dbPath} with dbId: ${dbId}`);
    }

    return dbId;
  }

  async exec(dbPath: string, sql: string, bind?: any[]): Promise<any> {
    const connection = this._connections.get(dbPath);
    assert(
      connection !== undefined,
      `Database ${dbPath} not open. Call openDatabase() first.`,
    );
    assert(this._promiser !== null, 'SQLite worker promiser not initialized');

    const result: SQLiteResult = await this._promiser('exec', {
      dbId: connection.dbId,
      sql,
      bind,
      returnValue: 'resultRows',
      rowMode: 'object',
    });

    if (result.type === 'error') {
      throw new Error(`SQL execution failed: ${result.result.message}`);
    }

    return result.result;
  }

  async closeDatabase(dbPath: string): Promise<void> {
    const connection = this._connections.get(dbPath);
    if (!connection) {
      return;
    }

    connection.refCount--;

    if (connection.refCount > 0) {
      return;
    }

    assert(this._promiser !== null, 'SQLite worker promiser not initialized');

    await this._promiser('close', { dbId: connection.dbId });
    this._connections.delete(dbPath);

    if (this._debug) {
      console.log(`🗑️ Closed database ${dbPath}`);
    }
  }

  async cleanup(): Promise<void> {
    for (const [dbPath] of this._connections) {
      await this.closeDatabase(dbPath);
    }
    this._connections.clear();
    this._ready = false;
    this._promiser = null;

    if (isBrowser()) {
      await sleep(10);
    }
  }

  private async _applyPragmaSettings(
    dbId: string,
    config: SQLiteWorkerConfig,
  ): Promise<void> {
    assert(this._promiser !== null, 'SQLite worker promiser not initialized');

    try {
      if (config.unsafe) {
        await this._promiser('exec', { dbId, sql: 'PRAGMA synchronous = OFF' });
        await this._promiser('exec', {
          dbId,
          sql: 'PRAGMA journal_mode = MEMORY',
        });
        await this._promiser('exec', {
          dbId,
          sql: 'PRAGMA cache_size = -4000',
        });
        await this._promiser('exec', {
          dbId,
          sql: 'PRAGMA locking_mode = EXCLUSIVE',
        });
      } else {
        await this._promiser('exec', {
          dbId,
          sql: 'PRAGMA synchronous = NORMAL',
        });
        await this._promiser('exec', {
          dbId,
          sql: 'PRAGMA journal_mode = WAL',
        });
        await this._promiser('exec', {
          dbId,
          sql: 'PRAGMA cache_size = -2000',
        });
      }

      await this._promiser('exec', { dbId, sql: 'PRAGMA temp_store = MEMORY' });
      await this._promiser('exec', {
        dbId,
        sql: 'PRAGMA mmap_size = 268435456',
      });
    } catch (error) {
      console.warn('Some PRAGMA settings failed:', error);
    }
  }

  private async _createTestTable(dbId: string): Promise<void> {
    assert(this._promiser !== null, 'SQLite worker promiser not initialized');

    await this._promiser('exec', {
      dbId,
      sql: `
        CREATE TABLE IF NOT EXISTS test_items (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          count INTEGER DEFAULT 0,
          tags TEXT DEFAULT '[]'
        )
      `,
    });
  }

  private _loadPromiserScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (globalThis.sqlite3Worker1Promiser !== undefined) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = '/assets/sqlite3-worker1-promiser.js';
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error('Failed to load SQLite worker promiser'));
      document.head.appendChild(script);
    });
  }
}

export function createSQLiteConfig(dbPath: string): SQLiteWorkerConfig {
  return {
    dbPath,
    unsafe: false,
  };
}

export function configureSQLiteUnsafe(
  config: SQLiteWorkerConfig,
): SQLiteWorkerConfig {
  return {
    ...config,
    unsafe: true,
  };
}
