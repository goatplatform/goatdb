import * as path from '../base/path.ts';
import { onSettled } from '../base/async.ts';
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
import {
  CancelledError,
  Code,
  ServerError,
  serviceUnavailable,
} from '../cfds/base/errors.ts';

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
  | { status: 'partial'; failedPeers: string[] }
  | { status: 'cancelled' };

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
   * How long close() waits for a stalled client bootstrap before aborting it
   * to unblock teardown. A healthy-but-slow bootstrap that finishes within
   * this window is never aborted. Defaults to 2000ms.
   */
  bootstrapStallMs?: number;
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
 * Rejection of close() when teardown could not persist every pending edit.
 * Carries one entry per failed item with its cause so callers can resolve the
 * listed causes and retry close(). Items recovered during teardown are
 * excluded; only still-dirty edits are listed.
 */
export class GoatDBCloseError extends Error {
  readonly failedItems: ReadonlyArray<{ path: string; cause: unknown }>;
  constructor(failedItems: { path: string; cause: unknown }[]) {
    super(
      'Database close failed; resolve the causes in failedItems, then retry close()',
    );
    this.name = 'GoatDBCloseError';
    this.failedItems = failedItems;
  }
}

// Keep this JSDoc bound to the class; docs build sources it from here.
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
  // Real error of the most recent failed append per file, thrown out of a
  // teardown flush when retries exhaust so close rejects instead of reporting
  // success over a commit that is still queued.
  private readonly _appendLastErrors = new Map<JSONLogFile, unknown>();

  /**
   * @internal Test-only fault-injection counters. commitFailures sentinels:
   * - -1: disabled (no injected failure)
   * - >0: number of commits still allowed before the next one fails
   * - 0: the next close-time commit fails, and every later one too
   */
  private _faults = {
    teardownFailures: 0,
    commitFailures: -1,
    fileCloseFailures: -1,
    appendFailures: 0,
  };

  /** @internal Test-only. Replaces all fault-injection counters at once. */
  setTestFaults(f: Partial<typeof this._faults>): void {
    Object.assign(this._faults, f);
  }

  /** @internal Consumes one close-time commit fault; returns the injected count. */
  _consumeCommitFault(): number {
    const f = this._faults.commitFailures;
    if (f > 0) this._faults.commitFailures--;
    return f;
  }

  /** @internal Test-only. Open repo file-handle + live sync scheduler counts. */
  _testResourceCounts = (): [number, number] => [
    this._files.size,
    this._syncSchedulers?.filter((s) => !s.isClosed).length ?? 0,
  ];
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
  /**
   * Bootstrap promise for TrustPool acquisition. Meanings:
   * - while booting: the live bootstrap promise (_getTrustPoolImpl())
   * - after a failed bootstrap with a usable pool: resolves to that pool
   * - after committed teardown: an eager rejection (serviceUnavailable) so
   *   any accidental post-teardown awaiter fails fast instead of hanging.
   *   Ready signaling for retried closes uses _readyAfterBootstrap, never this.
   */
  private _trustPoolPromise: Promise<TrustPool>;
  /** Resolves when bootstrap finishes; readyPromise() awaits this, not the
   * pool promise, so a parked pool after teardown cannot stall it. */
  private _readyAfterBootstrap: Promise<void>;
  /** Aborts an in-flight client bootstrap fetch so close() does not stall on it. */
  private _bootstrapAbort = new AbortController();
  /** True after the first close() surfaced a pre-pool bootstrap failure. */
  private _bootstrapFailureSurfaced = false;
  /** The bootstrap error surfaced by the first failing close(), if any. */
  private _bootstrapError: unknown;
  /** True after a bootstrap-failure teardown dropped unpersistable edits once. */
  private _bootstrapDroppedEditsLogged = false;
  /** Items whose close-time commit failed during the current close, keyed by
   * path; recovered items are filtered out before the rejection is built. */
  private _closeFailedItems = new Map<string, unknown>();
  private _state: DBState = 'booting';
  /** Set by the first close(); repeated close() calls return this promise. */
  private _closePromise: Promise<void> | undefined;
  readonly shardConfig: ShardConfig;

  // ── Inactivity auto-close config ──────────────────────────────
  readonly repoInactivityTimeoutMs: number;
  readonly queryInactivityTimeoutMs: number;
  private readonly _bootstrapStallMs: number;

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
    this._bootstrapStallMs = config.bootstrapStallMs ?? K_BOOTSTRAP_STALL_MS;
    if (
      config.bootstrapStallMs !== undefined &&
      (!Number.isFinite(config.bootstrapStallMs) ||
        config.bootstrapStallMs <= 0)
    ) {
      throw new TypeError('bootstrapStallMs must be a positive finite number');
    }
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
    // Observe the bootstrap outcome without leaving an unhandled rejection;
    // readyPromise() re-throws the captured error.
    this._readyAfterBootstrap = this._trustPoolPromise.then(
      () => {},
      (e) => {
        this._bootstrapError = e;
      },
    );
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
    await this._readyAfterBootstrap;
    if (this._bootstrapError !== undefined) {
      throw this._bootstrapError;
    }
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
   *
   * Retry rule: a rejected close() is recoverable — inspect the typed
   * `GoatDBCloseError` rejection (per-item `failedItems` causes), discard
   * invalid pending edits (`ManagedItem.discardPendingEdits()`) or fix the
   * external storage/bootstrap condition, then call close() again. Only
   * still-dirty edits appear in `failedItems`; recovered items are excluded.
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
    if (e === this._bootstrapError) {
      log({
        severity: 'INFO',
        message: `close reported earlier bootstrap failure: ${e}`,
      });
    } else {
      log({
        severity: 'ERROR',
        error: 'StorageError',
        message: `Database close failed: ${e}`,
        trace: String(e),
      });
    }
    throw e;
  }

  /**
   * Teardown body. Waits for bootstrap and pre-close opens first so a late
   * bootstrap or open cannot install resources after teardown.
   */
  private async _closeImpl(): Promise<void> {
    this._closeFailedItems.clear();
    this._abortSyncSchedulers();
    await this._waitForBootstrap();
    const { bootstrapError, surfaceNow } = this._bootstrapOutcome();
    await this._prepareTeardown();
    const committed = await this._commitDirtyItemsOrDrop();
    if (this.queryPersistence) {
      await this.queryPersistence.close();
      this.queryPersistence = undefined;
    }
    if (surfaceNow) throw bootstrapError;
    this._finalizeTeardown(committed);
    this._throwIfUncommitted(committed);
  }

  /** Synchronize/reap post-bootstrap resources before tearing repos down. */
  private async _prepareTeardown(): Promise<void> {
    // Schedulers born during the overlapping bootstrap (assigned in
    // _createTrustPool after several awaits) postdate the pre-wait abort;
    // reap them here or their 200ms intervals outlive the resolved close().
    this._abortSyncSchedulers();
    // Wait for opens that started before close so teardown sees them.
    await Promise.allSettled([...this._openPromises.values()]);
    // Unschedule idle timers to prevent concurrent fires during teardown.
    for (const repo of this._repositories.values()) {
      repo._idleTimer?.unschedule();
    }
    for (const q of this._openQueries.values()) {
      q._idleTimer?.unschedule();
    }
    for (const query of this._openQueries.values()) {
      query.close();
    }
    this._openQueries.clear();
    await this._closeAllRepositories();
  }

  /** Waits for bootstrap completion; aborts a stalled client bootstrap. */
  private async _waitForBootstrap(): Promise<void> {
    const stallTimer = setTimeout(() => {
      this._bootstrapAbort.abort();
      log({
        severity: 'WARNING',
        error: 'StorageError',
        message:
          `Bootstrap did not finish within ${this._bootstrapStallMs}ms; aborted to unblock close()`,
      });
    }, this._bootstrapStallMs);
    try {
      await this._readyAfterBootstrap;
    } finally {
      clearTimeout(stallTimer);
    }
  }

  /** Derives the one-time surfacing decision and settles a parked pool. */
  private _bootstrapOutcome(): {
    bootstrapError: unknown;
    surfaceNow: boolean;
  } {
    const bootstrapError: unknown = this._bootstrapError;
    let surfaceNow = false;
    if (bootstrapError !== undefined && !this._bootstrapFailureSurfaced) {
      this._bootstrapFailureSurfaced = true;
      surfaceNow = true;
    }
    if (bootstrapError !== undefined && this._trustPool) {
      this._trustPoolPromise = Promise.resolve(this._trustPool);
    }
    return { bootstrapError, surfaceNow };
  }

  /** Commit dirty items, or drop them with one ERROR when the pool is absent. */
  private async _commitDirtyItemsOrDrop(): Promise<boolean> {
    if (this._trustPool !== undefined) {
      return await this._commitDirtyItems();
    }
    if ([...this._items.values()].some((item) => item.isDirty)) {
      // No trust pool means edits cannot be signed/persisted; drop them with
      // an explicit once-only ERROR so a retried close settles instead of
      // rejecting forever.
      if (!this._bootstrapDroppedEditsLogged) {
        this._bootstrapDroppedEditsLogged = true;
        log({
          severity: 'ERROR',
          error: 'StorageError',
          message:
            'Bootstrap failed before a trust pool existed; pending edits could not be persisted and were discarded',
        });
      }
    }
    return true;
  }

  /** Throws the typed close failure when edits remain dirty after teardown. */
  private _throwIfUncommitted(committed: boolean): void {
    if (committed) return;
    // Typed close failure: per-item causes for edits that could not be
    // persisted. Items recovered during teardown are no longer dirty and
    // are excluded so callers only see what still needs correction.
    const failedItems = [...this._closeFailedItems]
      .filter(([path]) => this._items.get(path)?.isDirty)
      .map(([path, cause]) => ({ path, cause }));
    throw new GoatDBCloseError(failedItems);
  }

  /** Aborts peer sync before teardown so close is not held by a stalled sync. */
  private _abortSyncSchedulers(): void {
    if (!this._syncSchedulers) return;
    for (const scheduler of this._syncSchedulers) {
      scheduler.close();
    }
    // Drop the retained scheduler list so no post-close code can observe it.
    this._syncSchedulers = undefined;
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
    for (const item of [...this._items.values()]) {
      // Skip clean items: committing them would reopen an auto-closed repo
      // only for _setValueForKeyImpl() to dedup the no-op write.
      if (!item.isDirty) continue;
      const repoId = itemPathGetRepoId(item.path);
      const hadRepo = this._repositories.has(repoId);
      let committed = true;
      try {
        // _commitForClose() persists or throws; it never resolves false.
        await item._commitForClose();
      } catch (e) {
        committed = false;
        this._closeFailedItems.set(item.path, e);
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
    // A failed sibling commit may be recovered by _commitDependentItems during
    // teardown; only a failed item still dirty makes close truly fail.
    for (const path of this._closeFailedItems.keys()) {
      if (this._items.get(path)?.isDirty) return false;
    }
    return true;
  }

  /** Deactivates leftover items (kept when persistence failed) and drops session keys. */
  private _finalizeTeardown(committed: boolean): void {
    for (const item of this._items.values()) {
      item.deactivate();
    }
    if (committed) {
      this._items.clear();
      // Drop session keys: the pool is cleared and its promise permanently
      // rejected so any accidental post-teardown awaiter fails fast instead
      // of hanging. Keep the pool on failure so a retried close() can reopen
      // /sys repos.
      this._trustPool = undefined;
      this._trustPoolPromise = Promise.reject(serviceUnavailable());
      // The eager rejection is intentional; attach a no-op handler so it
      // never surfaces as an unhandled rejection when nothing awaits it.
      this._trustPoolPromise.catch(() => {});
    }
  }

  /**
   * Logs out the current user, closing all open repositories and clearing
   * local data. On browsers, this method will also reload the page to ensure
   * a clean state.
   *
   * @throws ServiceUnavailable while closing or after close. A closed
   *         instance must not wipe local data as a side effect. If teardown
   *         fails, `close()` rejects, so `logout()` throws before removing
   *         local data and the session stays active; callers should `.catch`
   *         and retry.
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
    if (
      existing &&
      (existing._closeState === 'closing' ||
        existing._closeState === 'close-failed')
    ) {
      // A previous teardown failed and its promise was cleared. Finish the
      // teardown before opening, otherwise the fresh instance would orphan the
      // old repo's file handle and listeners.
      return this._closeRepo(repoId).then(() => {
        if (!allowDuringClose) this._assertOpen();
        return this._openInternal(path, opts, allowDuringClose);
      });
    }
    let result = this._openPromises.get(repoId);
    if (!result) {
      result = this._openImpl(repoId, opts, allowDuringClose);
      onSettled(result, () => {
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
    // Coupled to _closeImpl(): close() publishes 'closing' before teardown
    // runs, and only that phase may reopen a repo to persist dirty items.
    // After 'closed'/'failed' nothing reaps a reopened repo, so any future
    // close-phase state must be added here to stay covered. The open-state
    // check is dead here: 'booting'/'ready' are not 'closing' either, so the
    // single state test fully determines the gate.
    if (this._state !== 'closing') {
      return Promise.reject(serviceUnavailable());
    }
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
    await this._registerRepoClose(
      repoId,
      () => this._buildClosePromise(repoId),
    );
  }

  /**
   * Installs a close promise under the per-repo mutex (_closePromises) and
   * awaits it, deleting the entry only if it is still the one installed
   * (identity-guarded against a concurrent replacement).
   */
  private async _registerRepoClose(
    repoId: string,
    make: () => Promise<void>,
  ): Promise<void> {
    const cp = make();
    this._closePromises.set(repoId, cp);
    try {
      await cp;
    } finally {
      if (this._closePromises.get(repoId) === cp) {
        this._closePromises.delete(repoId);
      }
    }
  }

  /**
   * Shared per-repo teardown tail: transition to 'closed' on success, keep
   * 'close-failed' on rejection so a retry can finish. Caller must have set
   * repo._closeState = 'closing'.
   */
  private async runRepoTeardown<ST extends RepoStorage<ST>>(
    repo: Repository<ST>,
  ): Promise<void> {
    try {
      await this._tearDownRepo(repo);
      repo._closeState = 'closed';
    } catch (e) {
      repo._closeState = 'close-failed';
      throw e;
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
    const repo = this._repositoryInternal(repoId);
    // 'closing' means a previous teardown failed part-way; retry it.
    if (
      !repo ||
      (repo._closeState !== 'open' &&
        repo._closeState !== 'closing' &&
        repo._closeState !== 'close-failed')
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
      if (
        item &&
        this._repoForItem(item.path) === repo &&
        !item.isDirty
      ) {
        item.deactivate();
        this._items.delete(k);
      }
    }
    // Transition to Closing and tear down. Only mark closed after teardown
    // resolves; a failure leaves 'close-failed' so a retry can finish.
    repo._closeState = 'closing';
    await this.runRepoTeardown(repo);
  }

  /** Closes queries whose source repo matches the given repoId. */
  private _closeDependentQueries(repoId: string): void {
    for (const [qid, q] of [...this._openQueries]) {
      if (!q._closed && q._repoInternal()?.path === repoId) {
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
  private async _drainPendingRepoWrites<ST extends RepoStorage<ST>>(
    repo: Repository<ST>,
  ): Promise<void> {
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
      // Internal lookup: this runs while the DB is closing, where the public
      // ManagedItem.repository getter is gated.
      if (this._repoForItem(item.path) === repo) {
        items.push(item as unknown as ManagedItem);
      }
    }
    for (const item of items) {
      // Skip clean items: they have nothing pending to persist, and
      // committing them would re-run validation for a no-op dedup write.
      if (!item.isDirty) continue;
      try {
        await item._commitTo(repo);
      } catch (e) {
        this._closeFailedItems.set(item.path, e);
        log({
          severity: 'ERROR',
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
    if (this._faults.teardownFailures > 0) {
      this._faults.teardownFailures--;
      throw new Error('test-forced teardown failure');
    }
    const repoId = repo.path;
    repo._idleTimer?.unschedule();
    // Flush log file - retry if data was re-queued after a transient failure
    const fileEntry = this._files.get(repoId);
    if (fileEntry) {
      // Retain-on-exhaust is mandatory here: a failed batch stays queued and
      // the flush throws its real append cause, so close rejects instead of
      // reporting success while a committed edit is unpersisted. A retried
      // close re-drains and persists it.
      await this._flushFileWithRetry(
        fileEntry,
        'Failed to flush pending writes on close',
        repoId,
        true,
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
      if (this._faults.fileCloseFailures > 0) {
        this._faults.fileCloseFailures--;
        throw new Error('test-forced file close failure');
      }
      await JSONLogFileClose(fileEntry);
      this._files.delete(repoId);
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
    const inFlight = this._closePromises.get(repoId);
    if (inFlight) return await inFlight;
    repo._closeState = 'closing'; // teardown failure stays retryable
    await this._registerRepoClose(repoId, () => this.runRepoTeardown(repo));
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
    if (this._state !== 'failed') this._assertOpen(); // failed: tracked items stay reachable for recovery
    for (const s of pathComps) {
      assert(typeof s === 'string'); // Sanity check
    }
    const path = itemPathNormalize(pathComps.join('/'));
    const tracked = this._items.get(path);
    if (tracked) return tracked as unknown as ManagedItem<S>;
    if (this._state === 'failed') throw serviceUnavailable();
    const item = new ManagedItem(this, path);
    this._items.set(path, item);
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
    const repo = this._repositoryInternal(repoId);
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
    return this._repositoryInternal(repoId)?.keys() || [];
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
   * Drains and retries pending appends for a single file, as the sole owner
   * of the drop/retain decision, WriteFailure emission, and close-failure
   * surfacing:
   * - Plain flush: after maxAttempts consecutive failures the stranded batch is
   *   permanently dropped and `WriteFailure` is emitted with the real I/O cause.
   * - Teardown or close-in-flight flush (retainOnExhaust): the failed batch
   *   stays queued so a retried close persists it; no WriteFailure fires (the
   *   data is not lost), but the real storage cause is thrown so this close
   *   rejects instead of reporting success.
   * - Auto-flush (retainOnExhaust + maxAttempts=1): single-attempt so a
   *   transient fault leaves the batch queued for a later flush instead of
   *   dropping it after retries.
   */
  private async _flushFileWithRetry(
    fileEntry: JSONLogFile,
    errorContext: string,
    repoId: string,
    retainOnExhaust = false,
    maxAttempts = MAX_WRITE_FAILURES,
  ): Promise<void> {
    // Serialize concurrent flushes for the same file. The slot is installed
    // before any await, so interleaved drains cannot double-write.
    const prev = this._inFlightDrains.get(fileEntry);
    if (prev) {
      await prev.catch(() => {});
      return this._flushFileWithRetry(
        fileEntry,
        errorContext,
        repoId,
        retainOnExhaust,
        maxAttempts,
      );
    }
    const drain = (async () => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // One append attempt: pull the buffered batch, try to write it, and
        // on failure re-queue it (order preserved) for the next attempt.
        const pending = this._pendingAppends.get(fileEntry);
        if (!pending || pending.values.length === 0) return;
        this._pendingAppends.delete(fileEntry);
        try {
          if (this._faults.appendFailures > 0) {
            this._faults.appendFailures--;
            throw new Error('test-forced append failure');
          }
          await JSONLogFileAppend(fileEntry, pending.values, pending.ids);
          this._appendLastErrors.delete(fileEntry);
        } catch (e) {
          this._appendLastErrors.set(fileEntry, e);
          const existing = this._pendingAppends.get(fileEntry);
          if (existing) {
            existing.values = pending.values.concat(existing.values);
            existing.ids = pending.ids.concat(existing.ids);
            existing.bytes += pending.bytes;
          } else {
            this._pendingAppends.set(fileEntry, pending);
          }
        }
      }
      const remaining = this._pendingAppends.get(fileEntry);
      if (!remaining) return;
      if (retainOnExhaust) {
        // Retained, not dropped: keep the batch queued for a later flush (a
        // retried close or the next auto-flush). Throw the real append cause
        // so a teardown flush rejects instead of reporting success; a
        // non-empty backlog of fresh appends (no recorded failure) is not an
        // error. No WriteFailure — the data still exists.
        const lastError = this._appendLastErrors.get(fileEntry);
        if (lastError !== undefined) throw lastError;
        return;
      }
      // Permanently dropped: this is the only path that emits WriteFailure.
      // Emit the real I/O cause, not the generic context string, so callers
      // can distinguish transient faults from permanent ones.
      const cause = this._appendLastErrors.get(fileEntry) ??
        new Error(errorContext);
      this._pendingAppends.delete(fileEntry);
      this._appendLastErrors.delete(fileEntry);
      log({
        severity: 'ERROR',
        error: 'StorageError',
        message:
          `[GoatDB] Dropping ${remaining.values.length} pending commit(s) after repeated write failures: ${errorContext}: ${
            String(cause)
          }`,
      });
      this.emit('WriteFailure', {
        droppedCommits: remaining.values.length,
        error: cause,
        repoPath: repoId,
        commitIds: remaining.ids,
      });
    })();
    this._inFlightDrains.set(fileEntry, drain);
    // Cleanup on both paths: a discarded finalizer child would mirror a
    // rejection as an unhandled rejection (see json-log.ts trackFileOperation).
    onSettled(drain, () => {
      if (this._inFlightDrains.get(fileEntry) === drain) {
        this._inFlightDrains.delete(fileEntry);
      }
    });
    await drain;
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
      // A close registered for this repo must own a failed batch: retain it
      // for the teardown flush instead of dropping it (which would lose a
      // committed edit while close reports success).
      const closeInFlight = this._isCloseInFlight(repoId) ||
        this._state === 'closing';
      await this._flushFileWithRetry(
        fileEntry,
        'Failed to flush pending writes',
        repoId,
        closeInFlight,
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
   *   - `{ status: 'cancelled' }` if close() cancelled every peer before any
   *     synced
   *
   * @example
   * const result = await db.sync('/my-repo');
   * if (result.status === 'success') {
   *   console.log('All peers synced successfully!');
   * } else if (result.status === 'failed') {
   *   console.log('All peers failed to sync.');
   * } else if (result.status === 'cancelled') {
   *   console.log('Sync cancelled by close.');
   * } else {
   *   console.log('Some peers failed:', result.failedPeers);
   * }
   */
  async sync(path: string): Promise<SyncResult> {
    this._assertOpen();
    const repoId = itemPathGetRepoId(itemPathNormalize(path));
    try {
      await this.open(repoId);
    } catch (e) {
      // A close racing the open cancels it: open() refuses to install a repo
      // once teardown started. That is a cancellation, not a peer failure.
      if (
        e instanceof ServerError &&
        e.code === Code.ServiceUnavailable &&
        !this.isOpen
      ) {
        return { status: 'cancelled' };
      }
      throw e;
    }
    const clients = Array.from(this.clientsForRepo(repoId));
    // No clients is success only while open; a close racing this sync
    // reports cancellation instead of a false success.
    if (clients.length === 0) {
      return this.isOpen ? { status: 'success' } : { status: 'cancelled' };
    }
    const results = await Promise.allSettled(clients.map((c) => c.sync()));
    // CancelledError means close aborted that peer; only other rejections are
    // genuine failures, and cancelled peers are never listed as failed. A
    // sync that reached at least one peer is fulfilled — it must never be
    // reported as wholly cancelled even when close cancelled the rest.
    const failedPeers: string[] = [];
    let anyCancelled = false;
    let anyFulfilled = false;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') anyFulfilled = true;
      else if (r.reason instanceof CancelledError) anyCancelled = true;
      else failedPeers.push(clients[i].scheduler.url);
    });
    if (failedPeers.length > 0) {
      return !anyFulfilled
        ? { status: 'failed' }
        : { status: 'partial', failedPeers };
    }
    // 'cancelled' only when every peer was cancelled before any synced.
    return { status: anyFulfilled || !anyCancelled ? 'success' : 'cancelled' };
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
    // Session-key-bearing handles must not be handed out while closing/closed/
    // failed; teardown internals use _repositoryInternal instead.
    if (!this.isOpen) return undefined;
    return this._repositoryInternal(
      Repository.normalizePath(pathComps.join('/')),
    );
  }

  /** @internal Unguarded repo lookup for teardown internals. */
  _repositoryInternal(repoId: string): Repository | undefined {
    return this._repositories.get(repoId);
  }

  /** @internal Single owner of item→repo ownership: resolves the repository
   * that owns an item path. Used by ManagedItem and close-time dirty-item
   * loops so the mapping has exactly one implementation. */
  _repoForItem(itemPath: string): Repository | undefined {
    return this._repositoryInternal(itemPathGetRepoId(itemPath));
  }

  /**
   * Returns the trust pool of this DB instance. The trust pool is a low level
   * object that manages all known sessions and their public keys. It is used
   * to verify the authenticity of the underlying commit graph before persisting
   * it to the local storage.
   *
   * @returns The trust pool of this DB instance.
   * @throws ServiceUnavailable while closing, closed, or failed; the pool
   *         holds session private keys, so a non-open instance must not hand
   *         it out, and a pending request rejects instead of delivering it.
   */
  async getTrustPool(): Promise<TrustPool> {
    this._assertOpen();
    const pool = await this._trustPoolPromise;
    // Recheck: a request pending when shutdown starts must not deliver the
    // key or start magic-link login after the instance left open.
    this._assertOpen();
    return pool;
  }

  private async _getTrustPoolImpl(): Promise<TrustPool> {
    await this._createTrustPool();
    // Self-abort: if close/teardown began mid-bootstrap, install nothing on a
    // non-booting instance (e.g. sys repos) before returning.
    if (this._state !== 'booting') return this._trustPool!;
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
    await this._settingsProvider.load(this._bootstrapAbort.signal);
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
    // Self-abort: if close/failure began mid-bootstrap, stop now. The trust
    // pool above stays for close-time commit signing; schedulers and query
    // persistence must not be installed on a non-booting instance.
    if (this._state !== 'booting') return;
    if (this._path) {
      this.queryPersistence = new QueryPersistence(
        new QueryPersistenceFile(this._path),
      );
      this.queryPersistence.start();
    }
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
    if (!(this.isOpen || (allowDuringClose && this._state === 'closing'))) {
      throw serviceUnavailable();
    }
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
    if (!Object.is(this._repositoryInternal(repo.path), repo)) return; // stale instance
    if (!repo._isIdleEligible()) return;
    // A manual close is in-flight; join it instead of tearing down twice.
    const inFlight = this._closePromises.get(repo.path);
    if (inFlight) return await inFlight;
    // Transition synchronously so concurrent open() and closeRepo() see the
    // in-flight close before any await.
    repo._closeState = 'closing';
    await this._registerRepoClose(
      repo.path,
      async () => {
        // Join in-flight verified writes (peer-sync ingest) before teardown,
        // so their commits reach disk through the teardown flush. New writes
        // reject once _closeState is 'closing' (Repository._canWrite), so
        // this terminates.
        await this._drainPendingRepoWrites(repo);
        await this.runRepoTeardown(repo);
      },
    );
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
      // Fail fast if committed teardown already cleared the pool; never
      // silently dereference an undefined pool.
      const pool = this._trustPool;
      assert(pool !== undefined, 'Trust pool unavailable during teardown');
      trustPool = pool;
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
      // Unguarded bootstrap seam: the reopen runs while the DB lifecycle is
      // still transitioning, where the public _canWrite() guard would reject.
      await repo._persistVerifiedCommitsForBootstrap(commits);
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
        // Single-attempt auto-flush: a transient I/O fault must leave the
        // batch queued for a later flush, never drop it after retries.
        this._flushFileWithRetry(
          file,
          'Failed to flush pending writes',
          repoId,
          true,
          1,
        ).catch(() => {});
      }
    });
    repo.attach('NewCommit', async (c: Commit) => {
      try {
        // mergeIfNeeded is write-gated; skip while a close is in flight so
        // the merge cannot race teardown.
        if (repo._canWrite()) {
          await repo.mergeIfNeeded(c.key);
        }
        const item = this._items.get(itemPathJoin(repo.path, c.key));
        item?.rebase();
        // Bump the adaptive timer back to max speed
        const clients = this._repoClients?.get(repoId);
        if (clients) {
          for (const client of clients) {
            client.touch();
          }
        }
      } catch (err: unknown) {
        // The emitter never awaits async listeners; consume the rejection so a
        // failing merge cannot surface as an unhandled rejection that kills the
        // shared worker/process.
        log({
          severity: 'ERROR',
          error: 'StorageError',
          message: `NewCommit listener failed for ${repoId}: ${err}`,
          trace: String(err),
        });
      }
    });
    repo.unmute();
    // close() closes _syncSchedulers and aborts fetches. A public open that
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
    const schedulers = this._syncSchedulers;
    if (!schedulers?.some((s) => !s.isClosed)) {
      return;
    }
    const clients: RepoClient[] = [];
    try {
      for (const scheduler of schedulers) {
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
// How long close() waits for an in-flight client bootstrap before aborting it
// so teardown cannot block forever on a stalled server.
const K_BOOTSTRAP_STALL_MS = 2000;
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
