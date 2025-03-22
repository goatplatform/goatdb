import * as path from '@std/path';
import { sessionFromItem, TrustPool } from './session.ts';
import { Repository, type RepositoryConfig } from '../repo/repo.ts';
import type { DBSettings, DBSettingsProvider } from './settings/settings.ts';
import { FileSettings } from './settings/file.ts';
import { Commit } from '../repo/commit.ts';
import { RepoClient } from '../net/client.ts';
import { kSyncConfigClient, kSyncConfigServer } from '../net/sync-scheduler.ts';
import { SyncScheduler } from '../net/sync-scheduler.ts';
import { QueryPersistence } from '../repo/query-persistance.ts';
import { QueryPersistenceFile } from './persistance/query-file.ts';
import { ManagedItem } from './managed-item.ts';
import type {
  Schema,
  SchemaTypeSession,
  SchemaTypeUser,
} from '../cfds/base/schema.ts';
import {
  itemPathGetPart,
  itemPathGetRepoId,
  itemPathJoin,
  itemPathNormalize,
} from './path.ts';
import { isBrowser, mapIterable, uniqueId } from '../base/common.ts';
import type { SchemaDataType } from '../cfds/base/schema.ts';
import { Item } from '../cfds/base/item.ts';
import {
  type JSONLogFile,
  JSONLogFileAppend,
  JSONLogFileClose,
  JSONLogFileFlush,
  JSONLogFileOpen,
  JSONLogFileScan,
  JSONLogFileStartCursor,
  remove,
} from '../base/json-log/json-log.ts';
import type {
  ReadonlyJSONObject,
  ReadonlyJSONValue,
} from '../base/interfaces.ts';
// import { BloomFilter } from '../cpp/bloom_filter.ts';
import {
  generateQueryId,
  Query,
  type QueryConfig,
  type QuerySource,
} from '../repo/query.ts';
import { sendLoginEmail } from '../net/rest-api.ts';
import { normalizeEmail } from '../base/string.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import { FileImplOPFS } from '../base/json-log/file-impl-opfs.ts';
import { assert } from '../base/error.ts';
import { SchemaManager } from '../cfds/base/schema-manager.ts';
import { Emitter } from '../base/emitter.ts';
import { getGoatConfig } from '../server/config.ts';
// import { remove } from '../base/json-log/json-log.ts';

export interface DBConfig {
  /**
   * Absolute path to the directory that'll store the DB's data.
   */
  path: string;
  /**
   * Optional organization id used to sandbox the data of a specific
   * organization in a multi-tenant deployment. Defaults to "localhost".
   */
  orgId?: string;
  /**
   * Absolute URLs of peers to sync with. Peers are must share the same
   * public/private root keys of this instance.
   */
  peers?: string | Iterable<string>;
  /**
   * If true, all security mechanisms are bypassed in favor of speed.
   * Set this to true when running purely in a trusted backend environment.
   * Defaults to false.
   */
  trusted?: boolean;
  /**
   * The schema manager to use for this DB instance.
   * Defaults to `SchemaManger.default`.
   */
  schemaManager?: SchemaManager;
}

/**
 * Options for opening a repository. These match the options exposed by the
 * repository itself, except some fields that are automatically filled.
 */
export type OpenOptions = Omit<RepositoryConfig, 'storage' | 'authorizer'>;

/**
 * Emitted by GoatDB whenever the current user changes.
 */
export type EventUserChanged = 'UserChanged';

/**
 * Main entry class for GoatDB - The Edge-Native Database.
 */
export class GoatDB extends Emitter<EventUserChanged> {
  readonly orgId: string;
  readonly schemaManager: SchemaManager;
  readonly trusted: boolean;
  private readonly _basePath: string;
  private readonly _repositories: Map<string, Repository>;
  private readonly _openPromises: Map<string, Promise<Repository>>;
  private readonly _files: Map<string, JSONLogFile>;
  private readonly _peerURLs: string[] | undefined;
  private readonly _repoClients: Map<string, RepoClient[]> | undefined;
  private readonly _items: Map<string, ManagedItem>;
  private readonly _openQueries = new Map<
    string,
    Query<Schema, Schema, ReadonlyJSONValue>
  >();
  private _path: string | undefined;
  private _settingsProvider: DBSettingsProvider | undefined;
  queryPersistence?: QueryPersistence;
  private _trustPool: TrustPool | undefined;
  private _syncSchedulers: SyncScheduler[] | undefined;
  private _trustPoolPromise: Promise<TrustPool>;
  private _ready: boolean = false;

  constructor(config: DBConfig) {
    super();
    this._basePath = config.path;
    this.schemaManager = config.schemaManager || SchemaManager.default;
    this.orgId = config?.orgId || getGoatConfig().orgId;
    this._repositories = new Map();
    this._openPromises = new Map();
    this._files = new Map();
    this._items = new Map();
    this._openQueries = new Map();
    this.trusted = config.trusted ?? false;
    if (config?.peers !== undefined) {
      this._peerURLs = typeof config.peers === 'string'
        ? [config.peers]
        : Array.from(new Set(config.peers));
      this._repoClients = new Map();
    }
    this._trustPoolPromise = this._getTrustPoolImpl();
  }

  /**
   * Returns the directory under which this DB instance stores all data.
   * Repositories are sub-directories within this directory.
   */
  get path(): string {
    return this._path || this._basePath;
  }

  /**
   * Returns the settings object of this DB instance.
   */
  get settings(): DBSettings {
    return this._settingsProvider!.settings;
  }

  /**
   * Returns whether this DB instance uses an anonymous session or a session
   * that's attached to a known user.
   */
  get loggedIn(): boolean {
    return this._trustPool?.currentSession.owner !== undefined;
  }

  /**
   * Returns the current user item or undefined if the current session is
   * anonymous.
   */
  get currentUser(): ManagedItem<SchemaTypeUser> | undefined {
    const userId = this._trustPool?.currentSession.owner;
    return userId ? this.item('sys', 'users', userId) : undefined;
  }

  /**
   * Returns the current session.
   * @throws This method throws if called before db.ready returns true.
   */
  get currentSession(): ManagedItem<SchemaTypeSession> {
    const sessionId = this._trustPool?.currentSession.id;
    assert(
      sessionId !== undefined,
      'Session not available yet. Wait for db.ready before accessing the current session.',
    );
    return this.item('sys', 'sessions', sessionId);
  }

  /**
   * Returns whether this DB instance is ready to receive commands or is it
   * still performing the initial load.
   */
  get ready(): boolean {
    return this._ready;
  }

  /**
   * A convenience promise form of the `ready` flag. When the promise returns,
   * this DB instance is ready to receive commands.
   *
   * @throws ServiceUnavailable if the initial load failed.
   */
  async readyPromise(): Promise<void> {
    await this._trustPoolPromise;
  }

  /**
   * When connecting to a new DB instance on the client, it'll start with an
   * anonymous session that's not attached to any user in the system. Call this
   * method with a user's email, to initiate an email-based login sequence that
   * will end with the current session being attached to the user owning this
   * email.
   *
   * This login sequence sends a temporary magic link to the provided email
   * address. Once clicked, the user item will be automatically created in
   * /sys/users and attached to the current session.
   *
   * @param   email The target of the magic link.
   * @returns true if the magic link had been successfully sent, false
   *          otherwise.
   */
  async loginWithMagicLinkEmail(email: string): Promise<boolean> {
    return await sendLoginEmail(
      (
        await this.getTrustPool()
      ).currentSession,
      normalizeEmail(email),
    );
  }

  /**
   * Logs out the current user, closing all open repositories and clearing
   * local data. On browsers, this method will also reload the page to ensure
   * a clean state.
   *
   * @throws ServiceUnavailable if the operation fails.
   */
  async logout(): Promise<void> {
    for (const repoPath of this._repositories.keys()) {
      await this.close(repoPath);
    }
    await remove(this._basePath);
    if (isBrowser()) {
      location.reload();
    }
  }

  /**
   * Opens the given repository, loading all its items to memory.
   * This method does nothing if the repository is already open.
   *
   * @param path The path to the given repository.
   * @param opts Configuration options when opening this repository.
   */
  open(path: string, opts?: OpenOptions): Promise<Repository> {
    path = itemPathNormalize(path);
    const repoId = itemPathGetRepoId(path);
    if (this._repositories.has(repoId)) {
      return Promise.resolve(this._repositories.get(repoId)!);
    }
    let result = this._openPromises.get(repoId);
    if (!result) {
      result = this._openImpl(repoId, opts).finally(() => {
        if (this._openPromises.get(repoId) === result) {
          this._openPromises.delete(repoId);
        }
      });
      this._openPromises.set(repoId, result);
    }
    return result;
  }

  /**
   * Closes a repository, flushing any pending writes to disk before releasing
   * all memory associated with this repository.
   *
   * This method does nothing if the repository isn't currently loaded.
   *
   * @param path Path to the desired repository.
   */
  async close(path: string): Promise<void> {
    path = itemPathNormalize(path);
    const repoId = itemPathGetRepoId(path);
    if (this._openPromises.has(repoId)) {
      await this._openPromises.get(repoId);
    }
    const repo = this.repository(repoId);
    if (!repo) {
      return;
    }
    const deletedKeys = new Set<string>();
    for (const [itemPath, item] of this._items) {
      if (item.repository === repo) {
        deletedKeys.add(itemPath);
        item.detachAll();
      }
    }
    for (const k of deletedKeys) {
      this._items.delete(k);
    }
    await this.flush(path);
    for (const client of this._repoClients?.get(repoId) || []) {
      client.close();
    }
    this._repoClients?.delete(repoId);
    const fileEntry = this._files.get(repoId);
    if (fileEntry) {
      await JSONLogFileClose(fileEntry);
    }
    this._files.delete(repoId);
    repo.detachAll();
    this._repositories.delete(repoId);
  }

  /**
   * Access an item at the given path. An item's path is typically at the
   * following format:
   * /<data type>/<repo id>/<item key>
   *
   * NOTE: If the item's repository haven't been opened yet, it'll be opened in
   * the background. While open is progressing, the returned item will
   * initially have a NULL scheme, and once open completes it'll be converted
   * to the correct scheme if available. Typically it's easier to first
   * explicitly open the repository before accessing any of its items.
   *
   * @param pathComps A full path or path components.
   * @returns         A managed item that tracks both local and remote edits.
   */
  item<S extends Schema>(...pathComps: string[]): ManagedItem<S> {
    for (const s of pathComps) {
      assert(typeof s === 'string'); // Sanity check
    }
    const path = itemPathNormalize(pathComps.join('/'));
    let item = this._items.get(path);
    if (!item) {
      item = new ManagedItem(this, path);
      this._items.set(path, item);
    }
    return item as unknown as ManagedItem<S>;
  }

  /**
   * Creates a new item at the target repository, opening it if needed. Unlike
   * `GoatDB.item()` there's no need to explicitly open a repository before
   * creating items in it. Newly created items become immediately available for
   * use and will get committed to the underlying repo after open completes.
   *
   * Note: This method only initializes the item if it doesn't already exist.
   * If the item already exists with a valid schema, this method will return
   * the existing item without modifying it.
   *
   * @param path    If a full path is provided, the item will be created with
   *                the provided key. If a repository path is provided, a
   *                unique item key will be automatically generated.
   *
   * @param schema  The schema to create the item with.
   *
   * @param data    The initial data to populate the item with.
   *
   * @returns       The newly created managed item, or the existing item if it
   *                already exists.
   */
  create<S extends Schema>(
    path: string,
    schema: S,
    data?: Partial<SchemaDataType<S>>,
  ): ManagedItem<S> {
    if (itemPathGetPart(path, 'item') === undefined) {
      path = itemPathJoin(path, uniqueId());
    }
    const item = this.item<S>(path);
    if (item.schema.ns === null) {
      item.schema = schema;
      if (data) {
        item.setMulti(data);
      }
    }
    return item;
  }

  /**
   * Explicitly create an item, loading its repository if needed. Use this
   * method for bulk load operations where you want to be notified after the
   * write completes.
   *
   * NOTE: This method uses a different internal path than the Item based API,
   * and is much more efficient for bulk creations.
   *
   * @param path   The path for the item to create.
   * @param schema The schema to create the item with.
   * @param data   The initial data for the item.
   */
  async load<S extends Schema>(
    path: string,
    schema: S,
    data: SchemaDataType<S>,
  ): Promise<void> {
    const repo = await this.open(path);
    let key = itemPathGetPart(path, 'item');
    if (!key || key.length <= 0) {
      key = uniqueId();
    }
    await repo.setValueForKey(
      key,
      new Item<S>(
        {
          schema,
          data,
        },
        this.schemaManager,
      ),
      undefined,
    );
  }

  /**
   * Returns the number of items at the specified path, or -1 if the path
   * doesn't exist.
   *
   * NOTE: Currently only paths to repositories are supported.
   *
   * @param path The full path to count.
   * @returns    The number of items found or -1.
   */
  count(path: string): number {
    const repoId = itemPathGetRepoId(path);
    const repo = this.repository(repoId);
    return repo ? repo.storage.numberOfKeys() : -1;
  }

  /**
   * Returns the keys at the specified path.
   *
   * NOTE: Currently only paths to repositories are supported.
   *
   * @param path Full path to a repository.
   * @returns    The keys at the specified path.
   */
  keys(path: string): Iterable<string> {
    path = itemPathNormalize(path);
    const repoId = itemPathGetRepoId(path);
    return this.repository(repoId)?.keys() || [];
  }

  /**
   * Open a new query or access an already open one. Once opened, the query
   * remains open until explicitly closed, and tracks updates to items as they
   * happen.
   *
   * @param config The configuration for the desired query.
   * @returns      A live query instance.
   */
  query<IS extends Schema, CTX extends ReadonlyJSONValue, OS extends IS = IS>(
    config: Omit<QueryConfig<IS, OS, CTX>, 'db'>,
  ): Query<IS, OS, CTX> {
    let id = config.id;
    if (!id) {
      id = generateQueryId(
        config.source as QuerySource,
        config.predicate,
        config.sortBy,
        config.ctx,
        config.schema?.ns,
      );
    }
    let q = this._openQueries.get(id);
    if (!q) {
      q = new Query({ ...config, db: this }) as unknown as Query<
        Schema,
        Schema,
        ReadonlyJSONValue
      >;
      q.once('Closed', () => {
        if (this._openQueries.get(q!.id) === q) {
          this._openQueries.delete(q!.id);
        }
      });
      this._openQueries.set(id, q);
    }
    return q as unknown as Query<IS, OS, CTX>;
  }

  /**
   * Flushes all pending writes for the given repository to disk. Use this
   * method when you must ensure all previously known commits are written to the
   * local disk.
   *
   * @param path Path to the desired repository.
   * @returns    A promise that resolves after all commits have been flushed to
   *             disk.
   */
  async flush(path: string): Promise<void> {
    const repoId = itemPathGetRepoId(itemPathNormalize(path));
    path = repoId;
    if (!path.endsWith('/')) {
      path = path + '/';
    }
    const promises: Promise<void>[] = [];
    for (const [itemPath, item] of this._items) {
      if (itemPath.startsWith(path)) {
        promises.push(item.commit());
      }
    }
    await Promise.allSettled(promises);
    await this.queryPersistence?.flush(repoId);
    const fileEntry = this._files.get(repoId);
    return fileEntry ? JSONLogFileFlush(fileEntry) : Promise.resolve();
  }

  /**
   * Flushes all pending writes for all repositories to disk.
   */
  async flushAll(): Promise<void> {
    const promises = mapIterable(
      this._repositories.keys(),
      (path) => this.flush(path),
    );
    await Promise.allSettled(promises);
    await this.queryPersistence?.flushAll();
  }

  /**
   * Returns the requested repository or undefined if it wasn't opened yet.
   *
   * Note: Prefer to use the higher level APIs of this class rather than the
   * repository instance directly.
   *
   * @param path A full path or path components.
   * @returns    The repository instance or undefined.
   */
  repository(...pathComps: string[]): Repository | undefined {
    return this._repositories.get(
      Repository.normalizePath(pathComps.join('/')),
    );
  }

  /**
   * Returns the trust pool of this DB instance. The trust pool is a low level
   * object that manages all known sessions and their public keys. It is used
   * to verify the authenticity of the underlying commit graph before persisting
   * it to the local storage.
   *
   * Note: You almost never need to use the trust pool directly.
   *
   * @returns The trust pool of this DB instance.
   */
  getTrustPool(): Promise<TrustPool> {
    return this._trustPoolPromise;
  }

  private async _getTrustPoolImpl(): Promise<TrustPool> {
    await this._createTrustPool();
    // Open /sys/sessions so all known sessions are properly loaded into our
    // new trust pool
    const sessionsRepo = await this.open('/sys/sessions');
    // Although the repository automatically adds new sessions to the trust
    // pool, the initial bootstrapping must happen explicitly as the chain of
    // sessions won't be loaded in the correct order.
    for (const key of sessionsRepo.keys()) {
      const s = sessionsRepo.valueForKey<SchemaTypeSession>(key)![0];
      this._trustPool?.addSessionUnsafe(await sessionFromItem(s));
    }
    // Open /sys/users so we can perform login and basic operations without
    // waiting
    await this.open('/sys/users');
    this._ready = true;
    return this._trustPool!;
  }

  /**
   * Returns the associated RepoClient instances for the given repository.
   * Each client instance handles synchronization with a different server
   * endpoint, enabling client-side load-balancing.
   *
   * @param pathComps Repository path.
   * @returns RepoClient instances for the given repository.
   */
  clientsForRepo(...pathComps: string[]): Iterable<RepoClient> {
    const repoId = Repository.normalizePath(pathComps.join('/'));
    return this._repoClients?.get(repoId) || [];
  }

  private async _createTrustPool(): Promise<void> {
    const fileIndex = await pickInstanceNumber();
    this._path = fileIndex
      ? path.join(
        path.dirname(this._basePath),
        path.basename(this._basePath) + '_' + fileIndex,
      )
      : this._basePath;
    this._settingsProvider = new FileSettings(
      this._basePath,
      isBrowser() ? 'client' : 'server',
    );
    this.queryPersistence = new QueryPersistence(
      new QueryPersistenceFile(this._path),
    );

    await this._settingsProvider.load();
    const settings = this._settingsProvider.settings;
    let currentUserId = this._trustPool?.currentSession.owner;
    this._trustPool = new TrustPool(
      this.orgId,
      settings.currentSession,
      settings.roots,
      settings.trustedSessions,
      () => {
        if (this._trustPool) {
          this._settingsProvider?.update(this._trustPool);
          const userId = this._trustPool?.currentSession.owner;
          if (userId !== currentUserId) {
            currentUserId = userId;
            this.emit('UserChanged');
          }
        }
      },
    );
    if (this._peerURLs) {
      const syncConfig = isBrowser() ? kSyncConfigClient : kSyncConfigServer;
      this._syncSchedulers = this._peerURLs.map(
        (url) =>
          new SyncScheduler(
            url,
            syncConfig,
            this._trustPool!,
            this.orgId,
            this.schemaManager,
          ),
      );
    }
  }

  private async _openImpl(
    repoId: string,
    opts?: OpenOptions,
  ): Promise<Repository> {
    // await BloomFilter.initNativeFunctions();
    repoId = Repository.normalizePath(repoId);
    let trustPool: TrustPool;
    // Special Case: skip the call to loadSysSessions() when loading user
    // related repos to avoid a loop.
    if (repoId === '/sys/sessions' || repoId === '/sys/users') {
      trustPool = this._trustPool!;
    } else {
      trustPool = await this.getTrustPool();
    }
    const repo = new Repository(this, repoId, trustPool, {
      ...opts,
      authorizer: this.schemaManager.authRuleForRepo(repoId),
    });
    this._repositories.set(repoId, repo);
    const file = await JSONLogFileOpen(
      path.join(this.path, relativePathForRepo(repoId)),
      true,
    );
    // const commitIds = new Set<string>();
    this._files.set(repoId, file);
    repo.mute();
    this.queryPersistence?.get(repoId);
    const cursor = await JSONLogFileStartCursor(file);
    let loadedFromBackup = false;
    let done = false;
    let nextPromise = JSONLogFileScan(cursor);
    do {
      let entries: readonly ReadonlyJSONObject[];
      [entries, done] = await nextPromise;
      nextPromise = JSONLogFileScan(cursor);
      // [entries, done] = await JSONLogFileScan(cursor);
      const commits = Commit.fromJSArr(this.orgId, entries, this.schemaManager);
      if (commits.length > 0) {
        loadedFromBackup = true;
      }
      // for (const c of commits) {
      //   commitIds.add(c.id);
      // }
      await repo.persistVerifiedCommits(commits);
    } while (!done);
    // Pre-assemble all commit graphs
    // for (const k of repo.keys()) {
    //   repo.valueForKey(k);
    // }
    repo.unmute();
    repo.attach('NewCommitSync', (c: Commit) => {
      // if (!commitIds.has(c.id)) {
      JSONLogFileAppend(file, [c.toJS()]);
      // commitIds.add(c.id);
      // }
    });
    repo.attach('NewCommit', async (c: Commit) => {
      await repo.mergeIfNeeded(c.key);
      const item = this._items.get(itemPathJoin(repo.path, c.key));
      item?.rebase();
      // Bump the adaptive timer back to max speed
      const clients = this._repoClients?.get(repoId);
      if (clients) {
        for (const client of clients) {
          client.touch();
        }
      }
    });
    if (this._syncSchedulers) {
      const clients: RepoClient[] = [];
      for (const scheduler of this._syncSchedulers) {
        const c = new RepoClient(
          repo,
          repoId,
          scheduler.syncConfig,
          scheduler,
          this.orgId,
        );
        clients.push(c);
        if (!loadedFromBackup) {
          c.sync().then(() => {
            c.ready = true;
            c.startSyncing();
          });
        } else {
          c.ready = true;
          c.startSyncing();
        }
      }
      this._repoClients!.set(repoId, clients);
    }
    return repo;
  }
}

function relativePathForRepo(repoId: string): string {
  const [storage, id] = Repository.parseId(Repository.normalizePath(repoId));
  return path.join(storage, id + '.jsonl');
}

let gSelectedInstanceNumber = -1;

async function pickInstanceNumber(
  startIndex: number = 0,
): Promise<number | undefined> {
  if ((await FileImplGet()) === FileImplOPFS) {
    const { promise: indefinitePromise } = Promise.withResolvers();
    const { promise, resolve } = Promise.withResolvers<number | undefined>();
    if (gSelectedInstanceNumber >= 0) {
      resolve(gSelectedInstanceNumber);
    }
    navigator.locks.request(
      'GoatDB-' + startIndex,
      { ifAvailable: true },
      async (lockOrNull) => {
        if (lockOrNull === null) {
          const idx = (await pickInstanceNumber(startIndex + 1))!;
          gSelectedInstanceNumber = idx;
          resolve(idx);
        }
        if (lockOrNull !== null) {
          resolve(startIndex);
          return indefinitePromise;
        }
      },
    );
    return promise;
  } else {
    return Promise.resolve(undefined);
  }
}
