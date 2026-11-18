import * as path from '../base/path.ts';
import { log } from '../logging/log.ts';
import { sessionFromItem, TrustPool } from './session.ts';
import {
  Repository,
  type RepositoryConfig,
  type RepoStorage,
} from '../repo/repo.ts';
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
import { makeShardConfig, type ShardConfig } from '../repo/shard-format.ts';
import { assertOpen, serviceUnavailable } from '../cfds/base/errors.ts';

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
 * Lifecycle of a DB instance. This is the single source of truth; `isOpen` is
 * the only derived signal. `failed` means bootstrap or teardown failed; a
 * failed instance rejects work but `close()` can still retry teardown.
 */
export type DBState =
  | 'booting'
  | 'ready'
  | 'closing'
  | 'closed'
  | 'failed';

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
   * Each resource owns its own one-shot timer. Set to 0 (default)
   * to disable. System repos (/sys/) are never auto-closed.
   *
   * When a repo is manually closed via closeRepo(), any open queries
   * sourcing from it are closed first.
   * Auto-close does NOT close queries — listener pins prevent that.
   *
   * Repo and query timeouts are independent: a query keeps its source
   * repo alive via a listener pin even after the repo's own idle timer
   * would have fired. Only after all dependent queries close does the
   * repo become eligible for idle close.
   */
  repoInactivityTimeoutMs?: number;

  /**
   * Auto-close queries after this many ms of inactivity.
   * A query is inactive when no external DocumentChanged listeners
   * are attached. Set to 0 (default) to disable.
   *
   * A closed query releases its source-repo listener, which may make
   * the repo eligible for idle close.
   */
  queryInactivityTimeoutMs?: number;
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
 * Emitted on every real lifecycle transition. Payload: (state: DBState).
 * @group Database
 */
export type EventLifecycleChanged = 'LifecycleChanged';

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
export class GoatDB<US extends Schema = Schema> extends Emitter<
  | EventUserChanged
  | EventWriteFailure
  | EventItemChanged
  | EventLifecycleChanged
> {
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
  /**
   * @internal Test-only. When > 0, _drainPendingAppends throws instead of
   * writing, simulating I/O failures. Decremented on each triggered failure.
   */
  _testForceAppendFailures = 0;
  /**
   * @internal Test-only. When > 0, _tearDownRepo throws before releasing
   * resources, simulating a failed teardown. Decremented per failure.
   */
  _testForceTeardownFailures = 0;
  /** @internal Test-only. Close-time item commits to allow before the next fails; 0 fails next, -1 disables. */
  _testForceCommitFailures = -1;
  /** @internal Test-only. When > 0, the next JSONLogFileClose throws (after detach). */
  _testForceFileCloseFailures = -1;
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
  /**
   * In-flight repo closes, keyed by repoId. Doubles as the per-repo mutex:
   * the entry is installed synchronously before the first await, so JS's
   * single-threaded scheduling makes concurrent close/open callers observe it.
   */
  private readonly _closePromises = new Map<string, Promise<void>>();
  private _path: string | undefined;
  private _settingsProvider: DBSettingsProvider | undefined;
  queryPersistence?: QueryPersistence;
  private _trustPool: TrustPool | undefined;
  private _syncSchedulers: SyncScheduler[] | undefined;
  private _trustPoolPromise: Promise<TrustPool>;
  private _state: DBState = 'booting';
  /** Set by the first close(); repeated close() calls return this promise. */
  private _closePromise: Promise<void> | undefined;
  readonly shardConfig: ShardConfig;

  // ── Inactivity auto-close config ──────────────────────────────
  readonly repoInactivityTimeoutMs: number;
  readonly queryInactivityTimeoutMs: number;

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
    if (
      config.repoInactivityTimeoutMs !== undefined &&
      config.repoInactivityTimeoutMs < 0
    ) {
      throw new Error('repoInactivityTimeoutMs must be >= 0');
    }
    if (
      config.queryInactivityTimeoutMs !== undefined &&
      config.queryInactivityTimeoutMs < 0
    ) {
      throw new Error('queryInactivityTimeoutMs must be >= 0');
    }

    if (config?.peers !== undefined) {
      this._peerURLs = typeof config.peers === 'string'
        ? [config.peers]
        : Array.from(new Set(config.peers));
      this._repoClients = new Map();
    }
    // DB logs bootstrap failures; readyPromise() still rejects.
    this._trustPoolPromise = this._getTrustPoolImpl();
    this._trustPoolPromise.catch((err) => {
      // Only a genuine bootstrap failure (while still booting) is an error; a
      // close() mid-bootstrap cancels via _assertOpen: no ERROR log, no state.
      if (this._state === 'booting') {
        log({
          severity: 'ERROR',
          error: 'StorageError',
          message: `Database bootstrap failed: ${err}`,
        });
        this._setState('failed');
      }
    });

    // Inactivity is now handled per-resource via one-shot timers
    // (owned by Repository and Query classes). No global poller needed.
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
    if (!this.isOpen) return false; // failed teardown keeps the pool for retry
    return this._trustPool?.currentSession.owner !== undefined;
  }

  /**
   * Returns the current user item or undefined if the current session is
   * anonymous.
   */
  get currentUser(): ManagedItem<US> | undefined {
    this._assertOpen();
    const userId = this._trustPool?.currentSession.owner;
    return userId ? this.item('sys', 'users', userId) : undefined;
  }

  /**
   * Returns the current session.
   * @throws This method throws if called before the DB is ready.
   */
  get currentSession(): ManagedItem<SchemaTypeSession> {
    this._assertOpen();
    const sessionId = this._trustPool?.currentSession.id;
    assert(
      sessionId !== undefined,
      'Session not available yet. Wait for the DB to be ready before accessing the current session.',
    );
    return this.item('sys', 'sessions', sessionId);
  }

  /**
   * Lifecycle phase of this instance. Only `ready` runs against fully
   * bootstrapped state; see `isOpen` for the narrower "accepts work" question
   * and `readyPromise()` for the awaitable form.
   */
  get state(): DBState {
    return this._state;
  }

  /** Single writer: publish every real lifecycle transition to observers. */
  private _setState(state: DBState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit('LifecycleChanged', state);
  }

  /**
   * True while the instance accepts work. Booting permits pre-ready calls;
   * closing, closed, and failed do not. Once closed, create a new GoatDB
   * instance instead of reopening this one.
   */
  get isOpen(): boolean {
    return this._state === 'booting' || this._state === 'ready';
  }

  /**
   * A convenience promise form of the ready lifecycle phase. When the promise
   * returns, this DB instance is ready to receive commands.
   *
   * @throws The original bootstrap error if the initial load failed, or
   *         ServiceUnavailable if the instance is closing or closed.
   */
  async readyPromise(): Promise<void> {
    await this._trustPoolPromise;
    if (this._state !== 'ready') {
      throw serviceUnavailable();
    }
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
    this._assertOpen();
    return await sendLoginEmail(
      (
        await this.getTrustPool()
      ).currentSession,
      normalizeEmail(email),
    );
  }

  /**
   * Closes the database, releasing all resources including repositories,
   * sync schedulers, queries, and file handles. Call this method when you're
   * done using the database instance.
   *
   * Single-flight: the first call starts teardown synchronously; calls made
   * while it is in flight and after it succeeds return the same promise.
   * `state` becomes `closing` immediately and `closed` after teardown settles.
   * If teardown fails, `state` becomes `failed` and the promise rejects; a
   * later `close()` retries the remaining teardown.
   */
  close(): Promise<void> {
    if (this._closePromise) return this._closePromise;
    // Publish closing only after installing the single-flight promise.
    this._closePromise = this._closeImpl().then(
      () => this._setState('closed'),
      (e: unknown) => this._onCloseRejected(e),
    );
    this._setState('closing');
    return this._closePromise;
  }

  /**
   * Records a failed teardown. Partial teardown is recoverable: clearing the
   * single-flight promise lets a later close() retry, and `failed` replaces a
   * false `closed`.
   */
  private _onCloseRejected(e: unknown): never {
    this._closePromise = undefined;
    this._setState('failed');
    log({
      severity: 'ERROR',
      error: 'StorageError',
      message: `Database close failed: ${e}`,
      trace: String(e),
    });
    throw e;
  }

  /**
   * Teardown body. Waits for bootstrap and pre-close opens first so a late
   * bootstrap or open cannot install resources after teardown.
   */
  private async _closeImpl(): Promise<void> {
    // Abort peer sync before waiting on bootstrap so repos opened during a
    // close-overlapping bootstrap spawn no sync clients.
    this._abortSyncSchedulers();
    // Wait for bootstrap: its sys-repo opens survive a concurrent close
    // (allowDuringClose), so accepted pre-ready edits can be persisted below.
    // A genuinely failed bootstrap rejects here, retaining dirty items instead
    // of silently discarding them.
    await this._trustPoolPromise;
    // Schedulers born during the overlapping bootstrap (assigned in
    // _createTrustPool after several awaits) postdate the pre-wait abort;
    // reap them here or their 200ms intervals outlive the resolved close().
    this._abortSyncSchedulers();
    await this._awaitPreCloseOpens();
    this._unscheduleIdleTimers();
    this._closeAllQueries();
    await this._closeAllRepositories();

    // Commit dirty items last so every opened repo from the prep phase is
    // closed before a close-time commit reopens an auto-closed one.
    const committed = await this._commitDirtyItems();
    await this._clearQueryPersistence();
    this._finalizeTeardown(committed);

    if (!committed) {
      throw new Error('Failed to persist pending item edits during close');
    }
  }

  /** Aborts peer sync before teardown so close is not held by a stalled sync. */
  private _abortSyncSchedulers(): void {
    if (!this._syncSchedulers) return;
    for (const scheduler of this._syncSchedulers) {
      scheduler.close();
    }
    this._syncSchedulers = undefined;
  }

  /** Waits for opens that started before close so teardown sees them. */
  private async _awaitPreCloseOpens(): Promise<void> {
    await Promise.allSettled([...this._openPromises.values()]);
  }

  /** Unschedules idle timers to prevent concurrent fires during teardown. */
  private _unscheduleIdleTimers(): void {
    for (const repo of this._repositories.values()) {
      repo._idleTimer?.unschedule();
    }
    for (const q of this._openQueries.values()) {
      q._idleTimer?.unschedule();
    }
  }

  private _closeAllQueries(): void {
    for (const query of this._openQueries.values()) {
      query.close();
    }
    this._openQueries.clear();
  }

  private async _closeAllRepositories(): Promise<void> {
    for (const repoPath of [...this._repositories.keys()]) {
      await this._closeRepo(repoPath);
    }
  }

  /**
   * Persists dirty managed items (auto-closed repos included) via the
   * close-time commit path. Returns true only when every dirty item committed;
   * failures are logged and the item stays dirty so a retried close() can
   * re-attempt persistence.
   */
  private async _commitDirtyItems(): Promise<boolean> {
    const pendingRepos = new Set<string>();
    const failedItems = new Set<string>();
    for (const item of [...this._items.values()]) {
      // Skip clean items: committing them would reopen an auto-closed repo
      // only for _setValueForKeyImpl() to dedup the no-op write.
      if (!item.isDirty) continue;
      const repoId = itemPathGetRepoId(item.path);
      const hadRepo = this._repositories.has(repoId);
      let committed = true;
      try {
        await item._commitForClose();
      } catch (e) {
        committed = false;
        failedItems.add(item.path);
        log({
          severity: 'ERROR',
          error: 'StorageError',
          message:
            `Commit of pending item ${item.path} during close() failed: ${e}`,
        });
        // Only discard a half-open repo THIS commit introduced; a pre-existing
        // one holds successful sibling commits that must still be torn down.
        if (!hadRepo) await this._discardHalfOpenRepo(repoId);
      }
      // Close only repos reopened by SUCCESSFUL commits. A failed reopen left a
      // half-open repo; closing it here would discard the pending edit, so a
      // retried close() finishes it instead.
      if (committed && this._repositories.has(repoId)) {
        pendingRepos.add(repoId);
      }
    }
    for (const repoId of pendingRepos) {
      await this._closeRepo(repoId);
    }
    // Final success is decided after repo-close retries: a failed sibling
    // commit may be recovered by _commitDependentItems during teardown. Only
    // a failed item still dirty means close truly failed; the half-open
    // failure case keeps its item dirty, preserving retryability.
    for (const path of failedItems) {
      if (this._items.get(path)?.isDirty) return false;
    }
    return true;
  }

  private async _clearQueryPersistence(): Promise<void> {
    if (!this.queryPersistence) return;
    await this.queryPersistence.close();
    this.queryPersistence = undefined;
  }

  /** Deactivates leftover items (kept when persistence failed) and drops session keys. */
  private _finalizeTeardown(committed: boolean): void {
    for (const item of this._items.values()) {
      item.deactivate();
    }
    if (committed) {
      this._items.clear();
      // Keep the pool on failure so a retried close() can reopen /sys repos.
      this._trustPool = undefined;
    }
  }

  /**
   * Logs out the current user, closing all open repositories and clearing
   * local data. On browsers, this method will also reload the page to ensure
   * a clean state.
   *
   * @throws ServiceUnavailable while closing or after close. A closed
   *         instance must not wipe local data as a side effect.
   */
  async logout(): Promise<void> {
    this._assertOpen();
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
   * An open deferred behind an in-flight closeRepo()/auto-close is cancelled
   * with serviceUnavailable if db.close() starts first: close is terminal, so
   * no repository may be installed after its teardown snapshots.
   *
   * @param path The path to the given repository.
   * @param opts Configuration options when opening this repository.
   */
  async open(path: string, opts?: OpenOptions): Promise<Repository> {
    this._assertOpen();
    return await this._openInternal(path, opts);
  }

  /**
   * @internal Open body that bypasses the DB lifecycle guard.
   *
   * @param allowDuringClose Set by close-time persistence, which must reopen
   *   auto-closed repos after `state` left 'ready'.
   */
  private _openInternal(
    path: string,
    opts?: OpenOptions,
    allowDuringClose = false,
  ): Promise<Repository> {
    path = itemPathNormalize(path);
    const repoId = itemPathGetRepoId(path);
    const existing = this._repositories.get(repoId);
    // Only hand out an already-open repo when no close is in flight. During a
    // manual closeRepo() the state stays 'open' through the commit/flush phase,
    // so without the in-flight check open() would return the very instance
    // that is about to be torn down (close/open overlap). Auto-close sets
    // 'closing' synchronously, but manual close must be guarded here too.
    if (
      existing && existing._closeState === 'open' &&
      !this._isCloseInFlight(repoId)
    ) {
      existing._touchIdle();
      return Promise.resolve(existing);
    }
    // No open repo, or one mid-close. If a close promise is registered (by
    // closeRepo or auto-close), wait for it so the previous repo state is fully
    // torn down before we open a fresh instance. This must be checked BEFORE
    // reusing an in-flight open: when closeRepo() is called while an
    // _openImpl() is still in flight, that open promise resolves with the very
    // repo the close is about to tear down, so handing it out would return the
    // closing instance. Waiting on _closePromises (which itself awaits the
    // in-flight open) and then reopening is the only safe path.
    const closeP = this._closePromises.get(repoId);
    if (closeP) {
      // A rejected close (failed auto-close teardown) is retried from the
      // fresh open below; the recursion re-checks the registry after settling.
      return closeP.catch(() => {}).then(() => {
        // Close wins: db.close() may have started while this open waited.
        // Recursing unguarded would install a repo after close snapshotted
        // _openPromises, leaking it behind the cached terminal close promise.
        // The guard is the sole post-await step, so close cannot interleave.
        if (!allowDuringClose) this._assertOpen();
        return this._openInternal(path, opts, allowDuringClose);
      });
    }
    if (existing && existing._closeState === 'closing') {
      // An auto-close teardown failed and its promise was cleared. Finish the
      // teardown before opening, otherwise the fresh instance would orphan the
      // old repo's file handle and listeners.
      return this._closeRepo(repoId).then(() => {
        if (!allowDuringClose) this._assertOpen();
        return this._openInternal(path, opts, allowDuringClose);
      });
    }
    let result = this._openPromises.get(repoId);
    if (!result) {
      result = this._openImpl(repoId, opts, allowDuringClose).finally(() => {
        if (this._openPromises.get(repoId) === result) {
          this._openPromises.delete(repoId);
        }
      });
      this._openPromises.set(repoId, result);
    }
    return result;
  }

  /**
   * Acquires an open repository and an idle lease that pins it from being
   * auto-closed until the returned RepoLease is disposed (e.g. via a using
   * block or explicit dispose()). Reopening waits for any in-flight close
   * to finish.
   *
   * @param pathComps A full repository path or path components.
   * @returns A disposable lease; releasing it re-arms the idle timer.
   * @group Database
   */
  async acquireRepo(...pathComps: string[]): Promise<RepoLease> {
    this._assertOpen();
    return await this._acquireRepoImpl(pathComps.join('/'));
  }

  /**
   * @internal Close-time variant of acquireRepo(). Bypasses the lifecycle
   * guard so db.close() can persist dirty items after closing begins.
   */
  _acquireRepoForClose(...pathComps: string[]): Promise<RepoLease> {
    return this._acquireRepoImpl(pathComps.join('/'), true);
  }

  private async _acquireRepoImpl(
    repoPath: string,
    allowDuringClose = false,
  ): Promise<RepoLease> {
    const path = itemPathNormalize(repoPath);
    const repo = await this._openInternal(path, undefined, allowDuringClose);
    repo.acquireIdleLease();
    return new RepoLease(repo, () => repo.releaseIdleLease());
  }

  /**
   * Closes a repository, flushing any pending writes to disk before releasing
   * all memory associated with this repository.
   *
   * Closes any open queries sourcing from this repository first, then commits
   * pending item edits, then tears the repository down. Writes that begin after
   * the close starts are rejected with serviceUnavailable (use `acquireRepo()`
   * for a lease-pinned write instead). Concurrent `open()` calls wait for the
   * close to finish before reopening a fresh repository.
   *
   * This method does nothing if the repository isn't currently loaded.
   *
   * @param path Path to the desired repository.
   */
  async closeRepo(path: string): Promise<void> {
    this._assertOpen();
    return await this._closeRepo(path);
  }

  /** @internal closeRepo() body; db.close() uses it while closing. */
  private async _closeRepo(path: string): Promise<void> {
    path = itemPathNormalize(path);
    const repoId = itemPathGetRepoId(path);
    // The map entry is the mutex: it is installed synchronously below, before
    // any await, so a concurrent caller always joins the in-flight close here.
    const inFlight = this._closePromises.get(repoId);
    if (inFlight) return await inFlight;
    // Build the close promise synchronously so concurrent callers and db.open()
    // can await it. It captures the whole lifecycle: commit, flush, teardown.
    const cp = this._buildClosePromise(repoId);
    this._closePromises.set(repoId, cp);
    try {
      await cp;
    } finally {
      // Identity check: a later close may have replaced this entry.
      if (this._closePromises.get(repoId) === cp) {
        this._closePromises.delete(repoId);
      }
    }
  }

  /**
   * Builds the close promise for a repo. Registered in _closePromises before
   * any await so serialization (mutex + promise chain) works correctly:
   * concurrent closeRepo() and open() can properly await the in-flight close.
   *
   * The repo's state stays 'open' through the commit phase so concurrent
   * ManagedItem commits are never blocked on this close promise (which would
   * otherwise resume after teardown and reopen the repo). New direct writes
   * are rejected by Repository._canWrite() via GoatDB._isCloseInFlight(), and
   * pending edits are flushed directly through ManagedItem._commitTo() (not
   * item.commit(), which would await this close promise via acquireRepo).
   */
  private async _buildClosePromise(repoId: string): Promise<void> {
    // Wait for any in-flight open (do not close a half-loaded repo).
    const openP = this._openPromises.get(repoId);
    if (openP) await openP;
    // The caller holds the _closePromises mutex. Double-check: a previous
    // close may have already cleared the repo.
    const repo = this.repository(repoId);
    // 'closing' means a previous teardown failed part-way; retry it.
    if (
      !repo ||
      (repo._closeState !== 'open' && repo._closeState !== 'closing')
    ) {
      return;
    }
    // Unschedule idle timer so it cannot fire during the close.
    repo._idleTimer?.unschedule();
    // Wait for writes that began before this close was registered. New writes
    // are rejected by Repository._canWrite() while the close is in flight, so
    // this terminates.
    await this._drainPendingRepoWrites(repo);
    // Tear down dependent queries (manual close owns this; auto-close never
    // reaches here with queries attached because listener pins prevent it).
    this._closeDependentQueries(repoId);
    // Flush pending item edits directly to this closing repo, bypassing
    // item.commit()/acquireRepo (deadlock). Skip when a previous teardown
    // already detached listeners: committing would lose the edit silently.
    if (!repo._teardownDetached) {
      await this._commitDependentItems(repo);
    }
    for (const k of [...this._items.keys()]) {
      const item = this._items.get(k);
      // Skip dirty items: they failed to persist and must survive teardown so
      // a later close() can retry them (see _commitDirtyItems).
      if (item && item.repository === repo && !item.isDirty) {
        item.deactivate();
        this._items.delete(k);
      }
    }
    // Transition to Closing and tear down. Only mark closed after teardown
    // resolves; a failure leaves 'closing' so a retry can finish.
    repo._closeState = 'closing';
    await this._tearDownRepo(repo);
    repo._closeState = 'closed';
  }

  /** Closes queries whose source repo matches the given repoId. */
  private _closeDependentQueries(repoId: string): void {
    for (const [qid, q] of [...this._openQueries]) {
      if (!q._closed && q.repo?.path === repoId) {
        q.close();
        this._openQueries.delete(qid);
      }
    }
  }

  /**
   * Waits for writes that began before a manual close was registered. Without
   * this, an in-flight setValueForKey()/insert() would run after teardown
   * detaches the NewCommitSync listener and its commit would never reach disk.
   */
  private async _drainPendingRepoWrites(repo: Repository): Promise<void> {
    // New writes are rejected by Repository._canWrite() while the close is in
    // flight, so this loop terminates.
    while (repo._pendingWrites.size > 0) {
      await Promise.allSettled([...repo._pendingWrites]);
    }
  }

  /**
   * Flushes pending item edits for a repo being manually closed. Each item is
   * committed directly to the closing repo via ManagedItem._commitTo(), which
   * bypasses acquireRepo/open() so it cannot deadlock on this close promise.
   */
  private async _commitDependentItems(repo: Repository): Promise<void> {
    const items: ManagedItem[] = [];
    for (const item of this._items.values()) {
      if (item.repository === repo) {
        items.push(item as unknown as ManagedItem);
      }
    }
    for (const item of items) {
      try {
        await item._commitTo(repo);
      } catch (e) {
        log({
          severity: 'WARNING',
          error: 'StorageError',
          message:
            `Commit of pending item ${item.path} during closeRepo() failed: ${e}`,
        });
      }
    }
  }

  /**
   * Shared teardown: flush+close the log file, drain query caches, drop repo
   * clients, detach listeners, and remove the repo from the registry. Does
   * NOT commit items and does NOT close dependent queries (callers control
   * that). Caller must have set repo._closeState = 'closing'.
   */
  private async _tearDownRepo<ST extends RepoStorage<ST>>(
    repo: Repository<ST>,
  ): Promise<void> {
    if (this._testForceTeardownFailures > 0) {
      this._testForceTeardownFailures--;
      throw new Error('test-forced teardown failure');
    }
    const repoId = repo.path;
    repo._idleTimer?.unschedule();
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
    repo._teardownDetached = true;
    // Close log file. Drop the map entry as soon as the close succeeds so a
    // retried teardown (after a later throw) does not close it twice.
    if (fileEntry) {
      if (this._testForceFileCloseFailures > 0) {
        this._testForceFileCloseFailures--;
        throw new Error('test-forced file close failure');
      }
      await JSONLogFileClose(fileEntry);
      this._files.delete(repoId);
      this._appendFailCounts.delete(fileEntry);
    }
    // Identity guard: a concurrent open() may have installed a fresh repo.
    if (Object.is(this._repositories.get(repoId), repo)) {
      this._repositories.delete(repoId);
    }
    this._warnedLegacyRepos.delete(repoId);
  }

  // Disposes a repo reopened only by a failed close-time commit; old code
  // deleted only the registry entry, leaking its _files handle and listeners.
  private async _discardHalfOpenRepo(repoId: string): Promise<void> {
    const repo = this._repositories.get(repoId);
    if (!repo) return;
    repo._closeState = 'closing'; // teardown failure stays retryable
    await this._tearDownRepo(repo);
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
    this._assertOpen();
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
    this._assertOpen();
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
    this._assertOpen();
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
    this._assertOpen();
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
   * @throws ServiceUnavailable while closing or after close.
   */
  count(path: string): number {
    this._assertOpen();
    const repoId = itemPathGetRepoId(path);
    const repo = this.repository(repoId);
    if (!repo) return -1;
    repo._touchIdle();
    return repo.storage.numberOfKeys();
  }

  /**
   * Returns the keys at the specified path.
   *
   * NOTE: Currently only paths to repositories are supported.
   *
   * @param path Full path to a repository.
   * @returns    The keys at the specified path.
   * @throws ServiceUnavailable while closing or after close.
   */
  keys(path: string): Iterable<string> {
    this._assertOpen();
    path = itemPathNormalize(path);
    const repoId = itemPathGetRepoId(path);
    return this.repository(repoId)?.keys() || [];
  }

  /**
   * Open a new query or access an already open one. Once opened, the query
   * remains open until explicitly closed, and tracks updates to items as they
   * happen.
   *
   * Loading is lazy: creating or reading from a query does not start a scan.
   * Results begin loading on the first subscription ({@link
   * Query.onResultsChanged}) or when waiting via {@link
   * Query.loadingFinished}/{@link Query.onLoadingFinished}. Reads
   * (`results()`, `has()`, `paths()`, ...) are side-effect free and return the
   * current snapshot only.
   *
   * When `queryInactivityTimeoutMs` is set, an unobserved query (no external
   * `DocumentChanged` listeners) is eligible for auto-close, including one
   * that never started loading. A closed query is replaced by calling
   * `db.query()` again.
   *
   * @param config The configuration for the desired query.
   * @returns      A live query instance.
   */
  query<IS extends Schema, CTX extends ReadonlyJSONValue, OS extends IS = IS>(
    config: Omit<QueryConfig<IS, OS, CTX>, 'db'>,
  ): Query<IS, OS, CTX> {
    this._assertOpen();
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
      this._openQueries.set(id, q);
    }
    return q as unknown as Query<IS, OS, CTX>;
  }

  /**
   * @internal Removes a closed query from the open-query registry. Called from
   * Query.close() so cleanup does not depend on a detachable 'Closed' listener
   * that a bare detachAll() can remove.
   */
  _forgetQuery(id: string, q: unknown): void {
    if (this._openQueries.get(id) === q) this._openQueries.delete(id);
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
    this._assertOpen();
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
    this._assertOpen();
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
    this._assertOpen();
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
    this._assertOpen();
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
   * @throws ServiceUnavailable once the instance leaves `booting` (closing,
   *         closed, or failed). The pool holds session private keys, so a
   *         non-open instance must not hand it out.
   */
  async getTrustPool(): Promise<TrustPool> {
    this._assertOpen();
    return this._trustPoolPromise;
  }

  private async _getTrustPoolImpl(): Promise<TrustPool> {
    await this._createTrustPool();
    // Open /sys/sessions so all known sessions are properly loaded into our
    // new trust pool
    // allowDuringClose: close() may overlap bootstrap; its sys-repo opens must
    // finish so accepted pre-ready edits persist instead of being discarded.
    const sessionsRepo = await this._openInternal(
      '/sys/sessions',
      undefined,
      true,
    );
    // Although the repository automatically adds new sessions to the trust
    // pool, the initial bootstrapping must happen explicitly as the chain of
    // sessions won't be loaded in the correct order.
    for (const key of sessionsRepo.keys()) {
      const s = sessionsRepo.valueForKey<SchemaTypeSession>(key)![0];
      this._trustPool?.addSessionUnsafe(await sessionFromItem(s));
    }
    // Open /sys/users so we can perform login and basic operations without
    // waiting
    await this._openInternal('/sys/users', undefined, true);
    // close() may have started during bootstrap; never revive a closing DB.
    if (this._state === 'booting') {
      this._setState('ready');
    }
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
   * @internal Throws serviceUnavailable while close is in flight or after it
   * completes. Public data operations call this before side effects so callers
   * see the failure at the API boundary, not inside a repository. Close-time
   * persistence passes allowDuringClose so it may reopen auto-closed repos.
   */
  private _assertOpen(allowDuringClose = false): void {
    if (!allowDuringClose) assertOpen(this.isOpen);
  }

  /**
   * @internal True while any close (manual or auto) is registered for the repo.
   * Used by Repository._canWrite() to reject writes that would silently land
   * on a repo whose teardown is already in flight.
   */
  _isCloseInFlight(repoId: string): boolean {
    return this._closePromises.has(repoId);
  }

  /**
   * @internal Called by a Repository idle timer. Uses the same per-repo mutex
   * (_closePromises) as closeRepo() so manual close and db.open() see the
   * in-flight close. Does NOT commit pending items or close dependent
   * queries — pending edits reopen the repo on demand via acquireRepo, and
   * listener-pinned queries keep repos ineligible for idle close.
   *
   * A failed teardown rejects and leaves the repo in 'closing' with no
   * registered promise, so the next open()/closeRepo() retries it instead of
   * leaking the file handle.
   */
  async _requestRepoIdleClose<ST extends RepoStorage<ST>>(
    repo: Repository<ST>,
  ): Promise<void> {
    if (!this.isOpen) return;
    if (repo._closeState !== 'open') return;
    if (!Object.is(this.repository(repo.path), repo)) return; // stale instance
    if (!repo._isIdleEligible()) return;
    // A manual close is in-flight; join it instead of tearing down twice.
    const inFlight = this._closePromises.get(repo.path);
    if (inFlight) return await inFlight;
    // Transition synchronously so concurrent open() and closeRepo() see the
    // in-flight close before any await.
    repo._closeState = 'closing';
    const cp = this._tearDownRepo(repo).then(() => {
      repo._closeState = 'closed';
    });
    this._closePromises.set(repo.path, cp);
    try {
      await cp;
    } finally {
      // Only success marks 'closed' (inside the then above). A rejection
      // leaves 'closing' so the next open() retries the teardown.
      if (this._closePromises.get(repo.path) === cp) {
        this._closePromises.delete(repo.path);
      }
    }
  }

  private async _openImpl(
    repoId: string,
    opts?: OpenOptions,
    allowDuringClose = false,
  ): Promise<Repository> {
    repoId = Repository.normalizePath(repoId);
    let trustPool: TrustPool;
    // Special Case: skip the call to loadSysSessions() when loading user
    // related repos to avoid a loop.
    if (repoId === '/sys/sessions' || repoId === '/sys/users') {
      trustPool = this._trustPool!;
    } else {
      // Read the promise directly: close-time commits reopen repos while the
      // public getter rejects (see _acquireRepoForClose).
      trustPool = await this._trustPoolPromise;
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
    // close() nulls _syncSchedulers and aborts fetches. A public open that
    // lost the race must not revive clients or return a repo teardown destroys.
    this._assertOpen(allowDuringClose);
    // Backup loads and sys repos have nothing to reconcile with peers yet.
    await this._startRepoClients(
      repo,
      repoId,
      allowDuringClose,
      loadedFromBackup || repoId === '/sys/sessions' ||
        repoId === '/sys/users',
    );
    // Arm the idle timer only after the repo is fully loaded, so a slow open
    // cannot immediately expire itself.
    repo._startIdleTimer();
    return repo;
  }

  /** One REST client per peer scheduler; owns this repo's adaptive sync timer. */
  private _newRepoClient(
    repo: Repository,
    repoId: string,
    scheduler: SyncScheduler,
  ): RepoClient {
    return new RepoClient(
      repo,
      repoId,
      scheduler.syncConfig,
      scheduler,
      this.orgId,
    );
  }

  /**
   * Initial peer sync of a freshly opened repo. A close() abort rethrows through
   * the guard so the open is abandoned; a real sync error is logged and the
   * open continues.
   */
  private async _initialSync(
    client: RepoClient,
    repoId: string,
    allowDuringClose: boolean,
  ): Promise<void> {
    try {
      await client.sync();
    } catch (e: unknown) {
      this._assertOpen(allowDuringClose);
      log({
        severity: 'WARNING',
        error: 'UnknownSyncError',
        message: `Initial sync failed for ${repoId}`,
        trace: String(e),
      });
    }
  }

  /**
   * Creates and starts one client per sync scheduler, then registers them for
   * teardown. An abort leaves the clients created so far unregistered, hence
   * invisible to _tearDownRepo: close them here or their repeating timers
   * outlive the closed state.
   */
  private async _startRepoClients(
    repo: Repository,
    repoId: string,
    allowDuringClose: boolean,
    skipInitialSync: boolean,
  ): Promise<void> {
    if (!this._syncSchedulers) {
      return;
    }
    const clients: RepoClient[] = [];
    try {
      for (const scheduler of this._syncSchedulers) {
        const client = this._newRepoClient(repo, repoId, scheduler);
        clients.push(client);
        client.ready = true;
        if (!skipInitialSync) {
          await this._initialSync(client, repoId, allowDuringClose);
        }
        this._assertOpen(allowDuringClose);
        client.startSyncing();
      }
    } catch (e: unknown) {
      for (const client of clients) client.close();
      throw e;
    }
    this._repoClients!.set(repoId, clients);
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

/**
 * Disposable lease returned by GoatDB.acquireRepo. Holding it keeps a
 * repository open (its idle timer is unscheduled); releasing it (via
 * dispose(), a using block, or Symbol.dispose) re-arms the timer. Used by
 * ManagedItem commits so an in-flight write prevents an idle close from
 * tearing down the target repo; releasing it only updates liveness and
 * reschedules the timer. dispose() is idempotent: disposing the same lease
 * more than once does not release another holder's lease.
 * @group Database
 */
export class RepoLease implements Disposable {
  private _disposed = false;
  constructor(
    readonly repo: Repository,
    private readonly _release: () => void,
  ) {}
  /**
   * Releases the lease. Idempotent: repeat calls are no-ops, so disposing the
   * same lease more than once never releases another holder's lease.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._release();
  }
  [Symbol.dispose](): void {
    this.dispose();
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
