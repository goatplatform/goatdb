import * as path from '../base/path.ts';
import { log } from '../logging/log.ts';
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
import type { Schema, SchemaTypeSession } from '../cfds/base/schema.ts';
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
import { Query, type QueryConfig, resolveQueryId } from '../repo/query.ts';
import { sendLoginEmail } from '../net/rest-api.ts';
import { normalizeEmail } from '../base/string.ts';
import { FileImplGet, pathExists } from '../base/json-log/file-impl.ts';
import { FileImplOPFS } from '../base/json-log/file-impl-opfs.ts';
import { assert } from '../base/error.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { Emitter } from '../base/emitter.ts';
import { getGoatConfig } from '../base/config.ts';
import { SimpleTimer } from '../base/timer.ts';
import { makeShardConfig, type ShardConfig } from '../repo/shard-format.ts';

/**
 * The result of a sync operation with all peers for a repository.
 *
 * - `{ status: 'success' }` if all peers succeeded
 * - `{ status: 'failed' }` if all peers failed
 * - `{ status: 'partial', failedPeers: string[] }` if some peers failed
 * @group Database
 */
export type SyncResult =
  | { status: 'success' }
  | { status: 'failed' }
  | { status: 'partial'; failedPeers: string[] };

/**
 * The mode of operation for a database instance.
 *
 * - 'client': The database operates as a client, syncing with server peers
 * - 'server': The database operates as a server, accepting sync requests from
 *   clients
 * @group Database
 */
export type DBMode = 'client' | 'server';

/**
 * The on-disk storage format for repository commit logs.
 *
 * - `'goat'` (default): length-prefixed binary — compact and fast
 * - `'jsonl'`: newline-delimited JSON — human-readable, useful for debugging
 * @group Database
 */
export type StorageFormat = 'jsonl' | 'goat';

/** @group Database */
export interface DBInstanceConfig {
  /**
   * Absolute path to the directory that'll store the DB's data.
   */
  path: string;
  /**
   * The mode of operation for this database instance.
   */
  mode?: DBMode;
  /**
   * Optional organization id used to sandbox the data of a specific
   * organization in a multi-tenant deployment. Defaults to "localhost".
   */
  orgId?: string;
  /**
   * Absolute URLs of peer nodes to sync with. This option is only used for
   * server cluster configurations, where multiple server nodes act as a single
   * logical node in the network, sharing the same root session and
   * cryptographic keys. In a server cluster, all peers listed here must share
   * the same public/private root keys, and will coordinate as one logical
   * entity.
   *
   * For client applications, this argument is not needed—React hooks and the
   * client library automatically set up communication with the server as
   * required.
   */
  peers?: string | Iterable<string>;
  /**
   * If true, all security mechanisms are bypassed in favor of speed.
   * Set this to true when running purely in a trusted backend environment.
   * Defaults to false.
   */
  trusted?: boolean;
  /**
   * Optional schema registry to use for this database instance.
   * If not provided, the default global registry (DataRegistry.default) will
   * be used. The registry contains all schema definitions and authorization
   * rules that this database instance will work with. Authorization rules
   * define who can read, write, or delete data based on user permissions and
   * data properties.
   */
  registry?: DataRegistry;
  /**
   * If true, the DB will be in debug mode.
   * Defaults to false.
   */
  debug?: boolean;
  /**
   * The on-disk format for repository commit logs.
   * Defaults to `'goat'` (compact binary). Use `'jsonl'` for human-readable
   * output during development or debugging.
   */
  storageFormat?: StorageFormat;
  /**
   * Maximum commits per shard. Controls RAM: each shard holds approximately
   * (max * 2.5 * 80 + max * 1.5 * 32) bytes of metadata. Defaults to
   * 100,000 (server) or 25,000 (browser).
   */
  maxShardCommits?: number;
  /** Commit count that triggers a background shard split. Defaults to 75% of maxShardCommits. */
  splitThreshold?: number;
  /** Shards below this count are candidates for merging. Defaults to 10% of maxShardCommits. */
  minShardCommits?: number;
  /**
   * Auto-close repositories after this many ms of inactivity.
   * A repository is inactive when no ManagedItem references it,
   * no Query depends on it, and no event listeners are attached.
   * Set to 0 (default) to disable. System repos (/sys/) are
   * never auto-closed.
   */
  repoInactivityTimeoutMs?: number;

  /**
   * Auto-close queries after this many ms of inactivity.
   * A query is inactive when no external listeners are attached
   * to its events. Set to 0 (default) to disable.
   */
  queryInactivityTimeoutMs?: number;

  /**
   * How often (in ms) to check for inactive repos/queries.
   * Defaults to 30,000 (30 seconds). Only used when at least
   * one timeout is > 0.
   */
  inactivityCheckIntervalMs?: number;
}

/**
 * Options for opening a repository. These match the options exposed by the
 * repository itself, except some fields that are automatically filled.
 * @group Database
 */
export type OpenOptions = Omit<RepositoryConfig, 'storage' | 'authorizer'>;

/**
 * Emitted by GoatDB whenever the current user changes.
 * @group Database
 */
export type EventUserChanged = 'UserChanged';

/**
 * Emitted by GoatDB when commits are permanently dropped after 3 consecutive
 * write failures for the same file. **Applications MUST attach a listener** to
 * detect data loss and alert the user or trigger a sync.
 *
 * @example
 * ```ts
 * db.attach('WriteFailure', (detail) => {
 *   console.error(`Lost ${detail.droppedCommits} commit(s):`, detail.error);
 * });
 * ```
 * @group Database
 */
export type EventWriteFailure = 'WriteFailure';

/**
 * Emitted when a managed item's data changes (local mutation or rebase).
 * Payload: (path: string, isRebase: boolean)
 * @group Database
 */
export type EventItemChanged = 'ItemChanged';

/**
 * Payload for the {@link EventWriteFailure} event, fired after 3 consecutive
 * I/O failures cause pending commits to be permanently dropped.
 * @group Database
 */
export interface WriteFailureDetail {
  /** Number of commit payloads that were dropped. */
  droppedCommits: number;
  /** The underlying I/O error from the last failed write attempt. */
  error: unknown;
  /** Repository path whose writes were dropped. */
  repoPath: string;
  /** IDs of the dropped commits. */
  commitIds: string[];
}

/**
 * The main database class that manages repositories, synchronization, and data
 * access.
 *
 * GoatDB is the primary entry point for working with the database. It handles:
 * - Repository management (opening, closing, accessing)
 * - Data synchronization with peers
 * - User authentication and authorization
 * - Schema validation
 * - Buffered writes: commits are coalesced and written to disk only on
 *   {@link flush} / {@link flushAll}. Commits pending in the buffer are lost
 *   on ungraceful exit; listen for the {@link EventWriteFailure} event to
 *   detect repeated write failures that cause commits to be dropped.
 *
 * @template US The user schema type, defaults to the base Schema type
 * @group Database
 */
export class GoatDB<US extends Schema = Schema>
  extends Emitter<EventUserChanged | EventWriteFailure | EventItemChanged> {
  readonly orgId: string;
  readonly registry: DataRegistry;
  readonly trusted: boolean;
  readonly debug: boolean;
  readonly mode: DBMode;
  readonly storageFormat: StorageFormat;
  private readonly _basePath: string;
  private readonly _repositories: Map<string, Repository>;
  private readonly _openPromises: Map<string, Promise<Repository>>;
  private readonly _files: Map<string, JSONLogFile>;
  /**
   * Coalesced write buffer: commits are enqueued by NewCommitSync and drained
   * to disk only when flush()/flushAll() is called. Commits buffered here are
   * lost on ungraceful exit.
   */
  private readonly _pendingAppends: Map<
    JSONLogFile,
    { values: Uint8Array[]; ids: string[]; bytes: number }
  >;
  // Consecutive write-failure count per file; dropped and logged at 3 failures.
  private readonly _appendFailCounts = new Map<JSONLogFile, number>();
  // @internal Test-only: when > 0, _drainPendingAppends throws instead of
  // writing, simulating I/O failures. Decremented on each triggered failure.
  _testForceAppendFailures = 0;
  // Tracks the most recent fire-and-forget drain promise per file so that
  // Tracks the most recent fire-and-forget drain promise per file so that
  // flush()/closeRepo() can await it before their own drain loop.
  private readonly _inFlightDrains = new Map<JSONLogFile, Promise<void>>();
  // Tracks repos that have already emitted the legacy-format fallback warning,
  // so each repo warns at most once per open/close cycle.
  private readonly _warnedLegacyRepos = new Set<string>();
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
  readonly shardConfig: ShardConfig;

  // ── Inactivity auto-close fields ──────────────────────────────
  readonly repoInactivityTimeoutMs: number;
  readonly queryInactivityTimeoutMs: number;
  readonly inactivityCheckIntervalMs: number;

  private readonly _lastActivityByRepo = new Map<string, number>();
  private readonly _lastActivityByQuery = new Map<string, number>();
  private _inactivityTimer: SimpleTimer | undefined;
  /** @internal Tracks in-flight closeRepo promises for test hook. */
  private _closeInFlight: Promise<void> | undefined;

  constructor(config: DBInstanceConfig) {
    super();
    this._basePath = config.path;
    this.mode = config.mode || (isBrowser() ? 'client' : 'server');
    this.registry = config.registry || DataRegistry.default;
    this.orgId = config?.orgId || getGoatConfig().orgId;
    this._repositories = new Map();
    this._openPromises = new Map();
    this._files = new Map();
    this._pendingAppends = new Map();
    this._items = new Map();
    this._openQueries = new Map();
    this.trusted = config.trusted ?? false;
    this.debug = config.debug ?? false;
    this.storageFormat = config.storageFormat ?? 'goat';
    this.shardConfig = makeShardConfig({
      maxCommits: config.maxShardCommits ??
        (isBrowser() ? 25_000 : 100_000),
      splitThreshold: config.splitThreshold,
      minCommits: config.minShardCommits,
    });
    this.repoInactivityTimeoutMs = config.repoInactivityTimeoutMs ?? 0;
    this.queryInactivityTimeoutMs = config.queryInactivityTimeoutMs ?? 0;
    this.inactivityCheckIntervalMs = config.inactivityCheckIntervalMs ?? 30_000;

    if (config?.peers !== undefined) {
      this._peerURLs = typeof config.peers === 'string'
        ? [config.peers]
        : Array.from(new Set(config.peers));
      this._repoClients = new Map();
    }
    this._trustPoolPromise = this._getTrustPoolImpl().catch((err) => {
      // Store the error but don't let it become an unhandled rejection
      // It will be re-thrown when readyPromise() is called
      return Promise.reject(err);
    });

    // Start inactivity checker if any timeout is enabled
    if (this.repoInactivityTimeoutMs > 0 || this.queryInactivityTimeoutMs > 0) {
      this._inactivityTimer = new SimpleTimer(
        this.inactivityCheckIntervalMs,
        true,
        () => { this._checkInactivity(); },
        'InactivityChecker',
      ).schedule() as SimpleTimer;
    }
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
  get currentUser(): ManagedItem<US> | undefined {
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
   * Closes the database, releasing all resources including repositories,
   * sync schedulers, queries, and file handles. This method should be called
   * when you're done using the database instance.
   */
  async close(): Promise<void> {
    // Stop the inactivity checker first
    this._inactivityTimer?.unschedule();
    this._inactivityTimer = undefined;

    // Stop all sync operations first (prevents new writes)
    if (this._syncSchedulers) {
      for (const scheduler of this._syncSchedulers) {
        scheduler.close();
      }
      this._syncSchedulers = undefined;
    }

    // Close all open queries
    for (const query of this._openQueries.values()) {
      query.close();
    }
    this._openQueries.clear();

    // Close all repositories
    for (const repoPath of [...this._repositories.keys()]) {
      await this.closeRepo(repoPath);
    }

    // Clear query persistence (has flush timer)
    if (this.queryPersistence) {
      await this.queryPersistence.close();
      this.queryPersistence = undefined;
    }
  }

  /**
   * Logs out the current user, closing all open repositories and clearing
   * local data. On browsers, this method will also reload the page to ensure
   * a clean state.
   *
   * @throws ServiceUnavailable if the operation fails.
   */
  async logout(): Promise<void> {
    await this.close();
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
    this._touchRepo(repoId);
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
  async closeRepo(path: string): Promise<void> {
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
    const commitPromises: Promise<void>[] = [];
    for (const [itemPath, item] of this._items) {
      if (item.repository === repo) {
        deletedKeys.add(itemPath);
        commitPromises.push(item.commit());
      }
    }
    await Promise.allSettled(commitPromises);
    for (const k of deletedKeys) {
      this._items.get(k)!.deactivate();
      this._items.delete(k);
    }
    // Flush log file - retry if data was re-queued after a transient failure
    const fileEntry = this._files.get(repoId);
    if (fileEntry) {
      await this._flushFileWithRetry(
        fileEntry,
        'Failed to flush pending writes on close',
        repoId,
      );
      await JSONLogFileFlush(fileEntry);
    }
    // Flush query caches
    await this.queryPersistence?.closeRepo(repoId);
    // Close repo clients
    for (const client of this._repoClients?.get(repoId) || []) {
      client.close();
    }
    this._repoClients?.delete(repoId);
    // Detach event handlers first to prevent new file operations
    repo.detachAll();

    // ❗ Race guard: was the repo reopened while we were waiting?
    if (this.repository(repoId) !== repo) {
      // Someone else reopened this repo concurrently — don't delete the
      // new instance. Clean up only our local state.
      this._lastActivityByRepo.delete(repoId);
      return;
    }

    // Close log file
    if (fileEntry) {
      await JSONLogFileClose(fileEntry);
      this._appendFailCounts.delete(fileEntry);
    }
    this._files.delete(repoId);
    this._repositories.delete(repoId);
    this._warnedLegacyRepos.delete(repoId);
    this._lastActivityByRepo.delete(repoId);
  }

  /**
   * Access an item at the given path. An item's path is typically at the
   * following format:
   * `/<data type>/<repo id>/<item key>`
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
    this._touchRepo(itemPathGetRepoId(path));
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
        this.registry,
      ),
      undefined,
    );
  }

  /**
   * Bulk-insert items into a repository. Significantly faster than individual
   * `load()` calls for large batches, as it batches signing and persistence.
   *
   * @param repoPath Path to the target repository (e.g. '/data/todos').
   * @param schema   The schema for the items.
   * @param items    Array of items to insert. Each may include an optional key;
   *                 if omitted, a unique key is generated.
   *
   * Commits are buffered in memory; call `flush()` or `flushAll()` to persist.
   */
  async insert<S extends Schema>(
    repoPath: string,
    schema: S,
    items: { key?: string; data: SchemaDataType<S> }[],
  ): Promise<void> {
    const repo = await this.open(repoPath);
    const entries = [];
    for (const item of items) {
      entries.push({
        key: item.key || uniqueId(),
        value: new Item(
          { schema, data: item.data },
          this.registry,
        ) as unknown as Item,
      });
    }
    await repo.insert(entries);
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
    const id = resolveQueryId(config);
    let q = this._openQueries.get(id);
    if (!q) {
      q = new Query({
        ...config,
        db: this as unknown as GoatDB,
        id,
      }) as unknown as Query<
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
    this._touchQuery(q.id);
    return q as unknown as Query<IS, OS, CTX>;
  }

  /**
   * Flushes buffered commits for a given file to disk.
   *
   * Commits are buffered in memory until this method is called. On 3
   * consecutive write failures for a file, ALL buffered commits for that file
   * are dropped and a `WriteFailure` event is emitted. Callers can listen to
   * `WriteFailure` to react (e.g. alert the user or trigger a sync).
   *
   * Write-retry semantics:
   * - Data is removed from the queue before the write attempt to prevent
   *   double-writes if a concurrent flush fires.
   * - On failure, data is prepended back to the queue (preserving order).
   * - If new batches arrived between failure and re-queue, they merge into a
   *   single queue entry that inherits the pre-existing fail count.
   * - After MAX_WRITE_FAILURES consecutive failures the data is dropped and
   *   `WriteFailure` is emitted — callers MUST handle this event.
   */
  private async _drainPendingAppends(
    file: JSONLogFile,
    repoId: string,
  ): Promise<void> {
    const pending = this._pendingAppends.get(file);
    if (!pending || pending.values.length === 0) {
      return;
    }
    this._pendingAppends.delete(file);
    try {
      if (this._testForceAppendFailures > 0) {
        this._testForceAppendFailures--;
        throw new Error('test-forced append failure');
      }
      await JSONLogFileAppend(file, pending.values, pending.ids);
      this._appendFailCounts.delete(file);
    } catch (e) {
      const failCount = (this._appendFailCounts.get(file) ?? 0) + 1;
      if (failCount >= MAX_WRITE_FAILURES) {
        // Drop after 3 consecutive failures to prevent unbounded accumulation.
        this._appendFailCounts.delete(file);
        log({
          severity: 'ERROR',
          error: 'StorageError',
          message:
            `[GoatDB] Dropping ${pending.values.length} pending commit(s) after 3 write failures: ${e}`,
        });
        this.emit('WriteFailure', {
          droppedCommits: pending.values.length,
          error: e,
          repoPath: repoId,
          commitIds: pending.ids,
        });
        return;
      }
      // Re-queue data for the next flush — no need to surface an error yet.
      this._appendFailCounts.set(file, failCount);
      const existing = this._pendingAppends.get(file);
      if (existing) {
        existing.values = pending.values.concat(existing.values);
        existing.ids = pending.ids.concat(existing.ids);
        existing.bytes += pending.bytes;
      } else {
        this._pendingAppends.set(file, pending);
      }
    }
  }

  /**
   * Drains and retries pending appends for a single file, emitting
   * `WriteFailure` if data cannot be flushed after all retries.
   *
   * Two-layer retry design:
   *   Layer 1 (_drainPendingAppends): On failure, increments _appendFailCounts
   *   and re-queues the data. After MAX_WRITE_FAILURES consecutive failures it
   *   drops the data and emits WriteFailure itself.
   *
   *   Layer 2 (this method): Calls drain up to MAX_WRITE_FAILURES times. The
   *   loop exits early when the queue is empty (success or layer-1 drop).
   *   The safety-net below the loop handles the rare edge case where new data
   *   was concurrently enqueued between iterations faster than the counter
   *   reaches the layer-1 threshold, leaving data stranded after all retries.
   */
  private async _flushFileWithRetry(
    fileEntry: JSONLogFile,
    errorContext: string,
    repoId: string,
  ): Promise<void> {
    const inFlight = this._inFlightDrains.get(fileEntry);
    if (inFlight) await inFlight.catch(() => {});
    for (let attempt = 0; attempt < MAX_WRITE_FAILURES; attempt++) {
      await this._drainPendingAppends(fileEntry, repoId);
      if (!this._pendingAppends.has(fileEntry)) break;
    }
    // This does NOT double-emit for data already dropped by layer-1:
    // layer-1 deletes from _pendingAppends on drop, so `remaining` is
    // undefined. This only fires for NEW data enqueued between iterations.
    const remaining = this._pendingAppends.get(fileEntry);
    if (remaining) {
      this._pendingAppends.delete(fileEntry);
      this.emit('WriteFailure', {
        droppedCommits: remaining.ids.length,
        error: new Error(errorContext),
        repoPath: repoId,
        commitIds: remaining.ids,
      });
    }
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
    if (fileEntry) {
      await this._flushFileWithRetry(
        fileEntry,
        'Failed to flush pending writes',
        repoId,
      );
      return JSONLogFileFlush(fileEntry);
    }
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
   * Syncs the given repository with all configured peers and waits for
   * completion.
   *
   * @param path Path to the desired repository.
   * @returns {Promise<SyncResult>} An object with a status field:
   *   - `{ status: 'success' }` if all peers succeeded
   *   - `{ status: 'failed' }` if all peers failed
   *   - `{ status: 'partial', failedPeers: string[] }` if some peers failed
   *
   * @example
   * const result = await db.sync('/my-repo');
   * if (result.status === 'success') {
   *   console.log('All peers synced successfully!');
   * } else if (result.status === 'failed') {
   *   console.log('All peers failed to sync.');
   * } else {
   *   console.log('Some peers failed:', result.failedPeers);
   * }
   */
  async sync(path: string): Promise<SyncResult> {
    const repoId = itemPathGetRepoId(itemPathNormalize(path));
    await this.open(repoId);
    const clients = Array.from(this.clientsForRepo(repoId));
    if (clients.length === 0) return { status: 'success' };
    const results = await Promise.allSettled(clients.map((c) => c.sync()));
    const failedPeers: string[] = results
      .map((
        r,
        i,
      ) => (r.status === 'fulfilled' ? null : clients[i].scheduler.url))
      .filter((p): p is string => !!p);
    if (failedPeers.length === 0) {
      return { status: 'success' };
    }
    if (failedPeers.length === clients.length) {
      return { status: 'failed' };
    }
    return { status: 'partial', failedPeers };
  }

  /**
   * Syncs all open repositories with all configured peers and waits for completion.
   *
   * @returns {Promise<Record<string, SyncResult>>} An object mapping repoId to SyncResult.
   *
   * @example
   * const results = await db.syncAll();
   * for (const [repo, result] of Object.entries(results)) {
   *   if (result.status === 'success') {
   *     console.log(`${repo}: all peers synced!`);
   *   } else if (result.status === 'failed') {
   *     console.log(`${repo}: all peers failed!`);
   *   } else {
   *     console.log(`${repo}: some peers failed:`, result.failedPeers);
   *   }
   * }
   */
  async syncAll(): Promise<Record<string, SyncResult>> {
    const repoIds = Array.from(this._repositories.keys());
    const results = await Promise.all(repoIds.map((rid) => this.sync(rid)));
    const out: Record<string, SyncResult> = {};
    repoIds.forEach((rid, i) => {
      out[rid] = results[i];
    });
    return out;
  }

  /**
   * Returns the requested repository or undefined if it wasn't opened yet.
   *
   * Note: Prefer to use the higher level APIs of this class rather than the
   * repository instance directly.
   *
   * @param pathComps A full path or path components.
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
      this.mode,
      this._peerURLs ? this._peerURLs[0] : undefined,
    );
    if (this._path) {
      this.queryPersistence = new QueryPersistence(
        new QueryPersistenceFile(this._path),
      );
      this.queryPersistence.start();
    }

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
      const syncConfig = this.mode === 'client'
        ? kSyncConfigClient
        : kSyncConfigServer;
      this._syncSchedulers = this._peerURLs.map(
        (url) =>
          new SyncScheduler(
            url,
            syncConfig,
            this._trustPool!,
            this.orgId,
            this.registry,
          ),
      );
    }
  }

  /**
   * Checks for inactive repositories and queries and closes them if their
   * inactivity timeout has been exceeded.
   *
   * Called by the inactivity timer. Also exposed via _testFireInactivityCheck
   * for deterministic testing.
   */
  private _checkInactivity(): void {
    const now = performance.now();

    // Build active repo set from ManagedItems — single O(n) pass
    const activeReposFromItems = new Set<string>();
    for (const itemPath of this._items.keys()) {
      activeReposFromItems.add(itemPathGetRepoId(itemPath));
    }

    // ── Check queries ───────────────────────────────────────────
    if (this.queryInactivityTimeoutMs > 0) {
      const staleQueries: string[] = [];
      for (const [qid, q] of this._openQueries) {
        if ((q as any)._closed) {
          staleQueries.push(qid);
          continue;
        }
        // Keep queries that are still loading their initial scan
        if (!(q as any)._loadingFinished) {
          this._touchQuery(qid);
          continue;
        }
        // Keep queries that have external listeners attached
        if ((q as any)._hasExternalListeners) {
          this._touchQuery(qid);
          continue;
        }
        const lastActivity = this._lastActivityByQuery.get(qid) ?? 0;
        if (now - lastActivity > this.queryInactivityTimeoutMs) {
          staleQueries.push(qid);
        }
      }
      for (const qid of staleQueries) {
        const q = this._openQueries.get(qid);
        if (q && !(q as any)._closed) {
          q.close();
        }
        this._openQueries.delete(qid);
        this._lastActivityByQuery.delete(qid);
      }
    }

    // ── Check repositories ──────────────────────────────────────
    if (this.repoInactivityTimeoutMs > 0) {
      const staleRepos: string[] = [];
      for (const [repoId, repo] of this._repositories) {
        // System repos are never auto-closed
        if (repoId === '/sys/sessions' || repoId === '/sys/users') {
          this._touchRepo(repoId);
          continue;
        }

        // If any ManagedItem references this repo, keep it alive
        if (activeReposFromItems.has(repoId)) {
          this._touchRepo(repoId);
          continue;
        }

        // If any open Query depends on this repo, keep it alive
        let hasDependentQuery = false;
        for (const q of this._openQueries.values()) {
          if ((q as any).repo?.path === repoId) {
            hasDependentQuery = true;
            break;
          }
        }
        if (hasDependentQuery) {
          this._touchRepo(repoId);
          continue;
        }

        // NOTE: repo.isActive is NOT checked here: the Repository
        // internally attaches listeners (NewCommitSync, NewCommit)
        // during _openImpl, so isActive is always true regardless of
        // external listeners. Instead we rely on item & query presence
        // (checked above) to decide whether the repo is in use.

        // Check timeout
        const lastActivity = this._lastActivityByRepo.get(repoId) ?? 0;
        if (now - lastActivity > this.repoInactivityTimeoutMs) {
          staleRepos.push(repoId);
        }
      }
      if (staleRepos.length > 0) {
        const promises = staleRepos.map((repoId) =>
          this.closeRepo(repoId).catch((e) => {
            log({
              severity: 'WARNING',
              error: 'StorageError',
              message: `Auto-close of repo ${repoId} failed: ${e}`,
            });
          })
        );
        this._closeInFlight = Promise.all(promises).then(() => {});
      }
    }
  }

  /** @internal Test-only: manually fire the inactivity check. */
  async _testFireInactivityCheck(): Promise<void> {
    this._checkInactivity();
    if (this._closeInFlight) {
      await this._closeInFlight;
      this._closeInFlight = undefined;
    }
  }

  /**
   * Records activity for a repository, resetting its inactivity timer.
   */
  private _touchRepo(repoId: string): void {
    if (this.repoInactivityTimeoutMs > 0) {
      this._lastActivityByRepo.set(repoId, performance.now());
    }
  }

  /**
   * Records activity for a query, resetting its inactivity timer.
   */
  private _touchQuery(queryId: string): void {
    if (this.queryInactivityTimeoutMs > 0) {
      this._lastActivityByQuery.set(queryId, performance.now());
    }
  }

  private async _openImpl(
    repoId: string,
    opts?: OpenOptions,
  ): Promise<Repository> {
    repoId = Repository.normalizePath(repoId);
    let trustPool: TrustPool;
    // Special Case: skip the call to loadSysSessions() when loading user
    // related repos to avoid a loop.
    if (repoId === '/sys/sessions' || repoId === '/sys/users') {
      trustPool = this._trustPool!;
    } else {
      trustPool = await this.getTrustPool();
    }
    const repo = new Repository(this as unknown as GoatDB, repoId, trustPool, {
      ...opts,
      authorizer: this.registry.authRuleForRepo(repoId),
    });
    this._repositories.set(repoId, repo);
    const configuredPath = path.join(
      this.path,
      relativePathForRepo(repoId, this.storageFormat),
    );
    // Fall back to jsonl if the configured format file is missing
    const jsonlPath = path.join(
      this.path,
      relativePathForRepo(repoId, 'jsonl'),
    );
    let actualFormat: StorageFormat = this.storageFormat;
    if (!(await pathExists(configuredPath))) {
      if (await pathExists(jsonlPath)) {
        actualFormat = 'jsonl';
        if (!this._warnedLegacyRepos.has(repoId)) {
          this._warnedLegacyRepos.add(repoId);
          log({
            severity: 'WARNING',
            error: 'StorageError',
            message:
              `[GoatDB] Repo "${repoId}": ${this.storageFormat} file not found, loading jsonl instead.`,
          });
        }
      }
    }
    const file = await JSONLogFileOpen(
      path.join(
        this.path,
        relativePathForRepo(repoId, actualFormat),
      ),
      true,
    );
    this._files.set(repoId, file);
    repo.mute();
    this.queryPersistence?.get(repoId);
    const cursor = await JSONLogFileStartCursor(file);
    let loadedFromBackup = false;
    let done = false;
    let nextPromise = JSONLogFileScan(cursor);
    // actualFormat may differ from storageFormat after legacy jsonl fallback above
    const isJSONL = actualFormat === 'jsonl';
    const textDecoder = new TextDecoder();
    const textEncoder = new TextEncoder();
    do {
      const result = await nextPromise;
      done = result.done;
      if (!done) nextPromise = JSONLogFileScan(cursor);
      let commits: Commit[];
      if (result.buffer && result.offsets) {
        // Binary (.goat) single-buffer path: subarray-backed BinaryCommits
        commits = Commit.fromBinaryScanResult(
          this.orgId,
          result.buffer,
          result.offsets,
          this.registry,
        );
      } else {
        const entries = result.values ?? [];
        if (isJSONL) {
          commits = Commit.fromJSArr(
            this.orgId,
            entries.map((e) =>
              JSON.parse(textDecoder.decode(e)) as ReadonlyJSONObject
            ),
            this.registry,
          );
        } else {
          commits = Commit.fromBinaryBytesArr(
            this.orgId,
            entries as Uint8Array[],
            this.registry,
          );
        }
      }
      if (commits.length > 0) {
        loadedFromBackup = true;
      }
      await repo.persistVerifiedCommits(commits);
    } while (!done);
    repo.attach('NewCommitSync', (c: Commit) => {
      let pending = this._pendingAppends.get(file);
      if (!pending) {
        pending = { values: [], ids: [], bytes: 0 };
        this._pendingAppends.set(file, pending);
      }
      const encoded = isJSONL
        ? textEncoder.encode(JSON.stringify(c.toJS()))
        : c.toBytes();
      pending.values.push(encoded);
      pending.ids.push(c.id);
      pending.bytes += encoded.byteLength;
      if (
        pending.values.length >= AUTO_FLUSH_THRESHOLD ||
        pending.bytes >= AUTO_FLUSH_BYTES
      ) {
        const prev = this._inFlightDrains.get(file) ?? Promise.resolve();
        const p = prev.catch(() => {}).then(() =>
          this._drainPendingAppends(file, repoId)
        );
        this._inFlightDrains.set(file, p);
        p.finally(() => {
          if (this._inFlightDrains.get(file) === p) {
            this._inFlightDrains.delete(file);
          }
        });
      }
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
    repo.unmute();
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
        c.ready = true;
        if (
          !loadedFromBackup && repoId !== '/sys/sessions' &&
          repoId !== '/sys/users'
        ) {
          try {
            await c.sync();
          } catch (e: unknown) {
            log({
              severity: 'WARNING',
              error: 'UnknownSyncError',
              message: `Initial sync failed for ${repoId}`,
              trace: String(e),
            });
          }
        }
        c.startSyncing();
      }
      this._repoClients!.set(repoId, clients);
    }
    return repo;
  }

  /**
   * Checks if an item at the given path is currently loaded in memory.
   * This is a passive check that does not trigger loading the item.
   *
   * @param path The full path to the item to check
   * @returns True if the item is loaded in memory, false otherwise
   */
  itemLoaded(path: string): boolean {
    return this._items.has(itemPathNormalize(path));
  }
}

function relativePathForRepo(repoId: string, format: StorageFormat): string {
  const [storage, id] = Repository.parseId(Repository.normalizePath(repoId));
  return path.join(storage, id + '.' + format);
}

let gSelectedInstanceNumber = -1;
// Max consecutive write failures before buffered commits are dropped and a
// WriteFailure event is emitted. Also used as the retry limit in closeRepo().
const MAX_WRITE_FAILURES = 3;
// Number of buffered commits before auto-flushing to prevent unbounded growth.
const AUTO_FLUSH_THRESHOLD = 1000;
// Byte total of buffered commits before auto-flushing regardless of count.
const AUTO_FLUSH_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * Picks a unique instance number for this browser tab (or worker), used to
 * coordinate access to shared resources (such as files) in OPFS environments.
 *
 * ## Architectural Note
 * Each browser tab (or worker) is treated as a separate *replica*, with its own
 * independent copy of the data in memory. This means that if you open the
 * application in multiple tabs, each tab will act as a separate database
 * replica, and changes made in one tab will not automatically appear in
 * another until explicit synchronization occurs.
 *
 * This mechanism assigns a unique instance number per tab/worker by acquiring
 * a named lock via the `navigator.locks` API. All DB instances within the same
 * tab will share the same instance number (cached in `gSelectedInstanceNumber`).
 *
 * ⚠️ **Warning:** This per-tab replica behavior is temporary and will be
 * changed in the future. The architecture may evolve to support true
 * multi-instance coordination or shared memory between DB instances in the
 * same tab.
 *
 * @param startIndex - The starting index to try for instance number selection.
 *                     Defaults to 0.
 * @returns A Promise that resolves to the selected instance number, or
 *          `undefined` if not applicable.
 */
async function pickInstanceNumber(): Promise<number | undefined> {
  if ((await FileImplGet()) !== FileImplOPFS) {
    return undefined;
  }
  if (gSelectedInstanceNumber >= 0) {
    return gSelectedInstanceNumber;
  }
  const indefinitePromise = new Promise<void>(() => {});
  const MAX_INSTANCES = 64;
  for (let i = 0; i < MAX_INSTANCES; i++) {
    const idx = i;
    let resolve: (value: number | undefined) => void;
    const promise = new Promise<number | undefined>((res) => {
      resolve = res;
    });
    navigator.locks.request(
      'GoatDB-' + idx,
      { ifAvailable: true },
      (lockOrNull) => {
        if (lockOrNull !== null) {
          resolve(idx);
          return indefinitePromise;
        }
        resolve(undefined);
      },
    );
    const result = await promise;
    if (result !== undefined) {
      gSelectedInstanceNumber = result;
      return result;
    }
  }
  // All slots taken — block on last slot's lock to serialize access.
  // This typically means too many tabs are open simultaneously.
  log({
    severity: 'WARNING',
    error: 'StorageError',
    message:
      `[GoatDB] All ${MAX_INSTANCES} OPFS instance slots are taken; blocking on slot ${
        MAX_INSTANCES - 1
      }. Too many tabs open?`,
  });
  const idx = MAX_INSTANCES - 1;
  await new Promise<void>((resolve) => {
    navigator.locks.request('GoatDB-' + idx, () => {
      gSelectedInstanceNumber = idx;
      resolve();
      return indefinitePromise;
    });
  });
  return gSelectedInstanceNumber;
}
