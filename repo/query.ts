import { type EventDocumentChanged, Repository } from './repo.ts';
import { Item } from '../cfds/base/item.ts';
import type { Commit } from './commit.ts';
import { Emitter } from '../base/emitter.ts';
import { NextEventLoopCycleTimer } from '../base/timer.ts';
import { murmur3 } from '../base/hash.ts';
import type { Schema } from '../cfds/base/schema.ts';
import type { GoatDB } from '../db/db.ts';
import type { ReadonlyJSONValue } from '../base/interfaces.ts';
import { isBrowser } from '../base/common.ts';
import { CoroutineScheduler } from '../base/coroutine.ts';
import {
  itemPathGetPart,
  itemPathGetRepoId,
  itemPathJoin,
} from '../db/path.ts';
import type { ManagedItem } from '../db/managed-item.ts';
import type { SchemaDataType } from '../mod.ts';
import { bsearch_idx } from '../base/algorithms.ts';
import { coreValueCompare } from '../base/core-types/comparable.ts';

/**
 * A tuple representing a query result entry, containing a path and an item.
 *
 * @template S The schema type for the item, defaults to base Schema
 *
 * @property path The path to the item
 * @property item The actual item instance with the specified schema
 */
export type Entry<S extends Schema = Schema> = [
  path: string,
  item: Item<S>,
];
/**
 * Information passed to a query predicate function to help determine if an
 * item matches.
 *
 * @template S The schema type for the item, defaults to base Schema
 * @template CTX The context type for additional query data
 *
 * @property path The full path to the item being evaluated
 * @property item The actual item instance with the specified schema. Note that
 *                this item is locked and should not be modified within the
 *                predicate.
 * @property ctx Additional context data passed to the query
 */
export type PredicateInfo<S extends Schema, CTX> = {
  path: string;
  item: Item<S>;
  ctx: CTX;
};

/**
 * A predicate function used to determine if an item matches the query.
 *
 * @template S The schema type for the item, defaults to base Schema
 * @template CTX The context type for additional query data
 *
 * @param info The predicate info containing the item path and item instance
 * @returns true if the item matches the query, false otherwise
 */
export type Predicate<S extends Schema, CTX extends ReadonlyJSONValue> = (
  info: PredicateInfo<S, CTX>,
) => boolean;

/**
 * Information passed to a query sort descriptor function to help determine
 * the order of items. Note that items are locked and should not be modified
 * within the sort descriptor.
 *
 * @template S The schema type for the item, defaults to base Schema
 * @template CTX The context type for additional query data
 *
 * @property left  The left item to compare.
 *                 This item is locked and should not be modified.
 * @property right The right item to compare.
 *                 This item is locked and should not be modified.
 * @property ctx   The context data for the query.
 */
export type SortInfo<S extends Schema, CTX> = {
  left: ManagedItem<S>;
  right: ManagedItem<S>;
  ctx: CTX;
};
/**
 * A sort descriptor function used to determine the order of items in a query.
 *
 * @template S The schema type for the item, defaults to base Schema
 * @template CTX The context type for additional query data
 *
 * @param info The sort info containing the left and right items to compare
 * @returns A negative number if left should be before right, positive if right
 *          should be before left, or 0 if they are equal
 */
export type SortDescriptor<S extends Schema, CTX> = (
  info: SortInfo<S, CTX>,
) => number;

/**
 * The source of a query, which can be a repository, another query, or a string
 * representing a repository path.
 *
 * @template IS The input schema type for the query
 * @template OS The output schema type for the query
 */
export type QuerySource<IS extends Schema = Schema, OS extends IS = IS> =
  | Repository
  | Query<IS, OS, ReadonlyJSONValue>
  | string;

/**
 * The configuration for a query, specifying the database, source, predicate,
 * sort order, schema, id, context, and limit.
 *
 * @template IS The input schema type for the query
 * @template OS The output schema type for the query
 * @template CTX The context type for additional query data
 * @group Querying
 */
export type QueryConfig<
  IS extends Schema,
  OS extends IS,
  CTX extends ReadonlyJSONValue,
> = {
  /** The database instance this query will operate on */
  db: GoatDB<Schema>;
  /** The source repository, query or path to query from */
  source: QuerySource<IS, OS>;
  /** Optional predicate function to filter items */
  predicate?: Predicate<IS, CTX>;
  /** Optional function or field name to determine sort order of results.
   * If a function is provided, it will be used as a custom comparator.
   * If a field name is provided, results will be sorted by that field's values
   * using standard comparison rules. */
  sortBy?: SortDescriptor<OS, CTX> | keyof SchemaDataType<OS>;
  /** Optional flag that if true, flips the natural order of the sortBy
   *
   * WARNING: When adding a field that changes query behavior (sorting,
   * filtering, limiting, live updates), you MUST also add it to the key
   * computation in `generateQueryId()` below so the cache identity captures
   * the difference. Otherwise distinct configurations will collide. */
  sortDescending?: boolean;
  /** Optional schema to restrict query results to */
  schema?: IS;
  /** Optional unique identifier for this query */
  id?: string;
  /** Optional context data passed to predicate and sort functions */
  ctx?: CTX;
  /** Optional maximum number of results to return */
  limit?: number;
  /**
   * When true (default), query membership and sort order update immediately
   * when a ManagedItem is edited via `set()`, without waiting for the 300ms
   * commit delay. Set to false to revert to commit-only update behavior.
   * Rebase events are always ignored since they do not change the document's
   * logical value.
   */
  liveUpdates?: boolean;
};

/**
 * The events that can be emitted by a Query.
 * - `DocumentChanged`: Emitted when a document in the query results changes
 * - `LoadingFinished`: Emitted when the initial query loading completes
 * - `Closed`: Emitted when the query is closed
 */
export type QueryEvent = EventDocumentChanged | 'LoadingFinished' | 'Closed';

/**
 * A Query represents a live view over a repository or another query,
 * supporting:
 *
 * - Query chaining: Queries can be chained together, where one query's results
 *   become the input for another query. This allows building complex data
 *   transformations through composition.
 *
 * - Incremental updates: When the underlying data changes, queries
 *   automatically update their results. Changes propagate efficiently through
 *   query chains - only the affected results are recomputed rather than
 *   re-running the entire query.
 *
 * - Persistent caching: Results are continuously cached to disk, both during
 *   the initial linear scan and as the source data changes. This allows
 *   queries to be efficiently resumed after being suspended or closed,
 *   without having to re-scan the entire dataset.
 *
 * - Efficient indexing: When sorted by a field, queries act as persistent indexes
 *   enabling O(log n) lookups on that field. The index stays up-to-date as data
 *   changes and results are cached for immediate availability.
 *
 * Query chaining example:
 * ```ts
 * // Chain queries to find recent important todos
 * const importantTodos = new Query({
 *   source: repo,
 *   predicate: todo => todo.important
 * });
 * const recentImportant = new Query({
 *   source: importantTodos,
 *   predicate: todo => isRecent(todo.date)
 * });
 * ```
 *
 * You can also use queries as efficient indexes:
 * ```ts
 * // Create an index over user emails
 * const usersByEmail = new Query({
 *   source: '/sys/users',
 *   schema: kSchemaUser,
 *   sortBy: 'email'
 * });
 *
 * // O(log n) lookup by email after index is built
 * await usersByEmail.loadingFinished();
 * const user = usersByEmail.find('email', 'user@example.com');
 * ```
 * @group Querying
 */

// Safety net: if a Query is GC'd without close(), tear down its live listener
// to prevent a GoatDB.ItemChanged listener leak. Not a substitute for close().
const LIVE_QUERY_CLEANUP = new FinalizationRegistry<() => void>((cleanup) =>
  cleanup()
);

export class Query<
  IS extends Schema,
  OS extends IS,
  CTX extends ReadonlyJSONValue,
> extends Emitter<QueryEvent> {
  /** Unique identifier for this query */
  readonly id: string;

  /** Database instance this query operates on */
  readonly db: GoatDB<Schema>;

  /** Optional context data passed to predicate and sort functions */
  readonly context: CTX;

  /** Schema type for items in this query */
  readonly scheme?: IS;

  /** Maximum number of results to return, 0 means unlimited */
  readonly limit: number = 0;

  private readonly source: QuerySource<IS, OS>;
  private _predicateInfo?: PredicateInfo<IS, CTX>;
  private readonly predicate: Predicate<IS, CTX>;
  private _sortInfo?: SortInfo<OS, CTX>;
  private readonly _sortField?: keyof SchemaDataType<OS> & string;
  private readonly sortDescriptor: SortDescriptor<OS, CTX> | undefined;
  private readonly sortDescending: boolean;
  private readonly _headIdForKey: Map<string, string>; // Path -> Commit ID
  private readonly _includedPaths: Set<string>;
  private _loadingFinished = false;
  private _scanTimeMs = 0;
  private _age = 0;
  private _sourceListenerCleanup?: () => void;
  private _liveListenerCleanup?: () => void;
  private _liveUpdates: boolean;
  private _resultsGeneration: number = 0;
  private _repoPrefix: string | undefined;
  private _closed = false;
  private _cachedResults: ManagedItem<OS>[] | undefined;
  private _cachedResultsAge = -1;
  private _loading: boolean = true;

  /**
   * Creates a new Query instance.
   *
   * @param config The query configuration object containing:
   * @param config.db The database instance to query
   * @param config.id Optional unique identifier for the query
   * @param config.source The data source to query (repository or path)
   * @param config.predicate Optional predicate function to filter items
   * @param config.sortBy Optional function to determine sort order
   * @param config.ctx Optional context data passed to predicate/sort functions
   * @param config.schema Optional schema type for the query
   * @param config.limit Optional maximum number of results (0 for unlimited)
   * @param config.sortDescending Optional flag to reverse sort order
   * @param config.liveUpdates Optional flag for live uncommitted updates (default true)
   */
  constructor(config: QueryConfig<IS, OS, CTX>) {
    super();
    this.id = resolveQueryId(config);
    const { db, sortDescending, ctx, schema, limit, liveUpdates } = config;
    let { source, predicate, sortBy } = config;
    this.db = db;
    if (typeof source === 'string') {
      source = itemPathGetRepoId(source);
    }
    if (!predicate) {
      predicate = () => true;
    }
    if (sortBy !== undefined && typeof sortBy !== 'function') {
      this._sortField = sortBy as keyof SchemaDataType<OS> & string;
      sortBy = ({ left, right }) =>
        coreValueCompare(
          left.get(this._sortField!),
          right.get(this._sortField!),
        ) * (sortDescending ? -1 : 1);
    } else if (typeof sortBy === 'function' && sortDescending) {
      sortBy = (info) => (sortBy as SortDescriptor<OS, CTX>)(info) * -1;
    }
    this.context = ctx as CTX;
    this.source = source;
    this.scheme = schema;
    this.limit = limit || 0;
    this.predicate = predicate;
    this.sortDescriptor = sortBy;
    this.sortDescending = sortDescending ?? false;
    this._liveUpdates = liveUpdates ?? true;
    this._headIdForKey = new Map();
    this._includedPaths = new Set();
  }

  /**
   * Gets the repository associated with this query's data source.
   *
   * @returns The repository that this query operates on.
   */
  get repo(): Repository {
    if (typeof this.source === 'string') {
      return this.db.repository(this.source)!;
    }
    return this.source instanceof Repository ? this.source : this.source.repo;
  }

  /**
   * Gets the number of items in the query results. This is more efficient than
   * calling results().length since it directly returns the cached path count
   * rather than constructing the results array first.
   *
   * @returns The number of items in the query results.
   */
  get count(): number {
    return this.limit > 0
      ? Math.min(this._includedPaths.size, this.limit)
      : this._includedPaths.size;
  }

  /**
   * Gets the total time spent scanning items during query execution.
   *
   * @returns The total scan time in milliseconds.
   */
  get scanTimeMs(): number {
    return this._scanTimeMs;
  }

  /**
   * Gets the age (generation) of the query results, which is a monotonically
   * increasing number. The age is incremented each time the query results are
   * updated due to changes in the underlying data source. This allows tracking
   * whether cached results are stale.
   *
   * @returns The current generation number of the query results, which only
   *          increases over time.
   */
  get age(): number {
    return this._age;
  }

  /**
   * Gets the loading status of the query. Checking this status allows building
   * more responsive interfaces by showing intermediate results while the full
   * query loads. See {@link loadingFinished()} for waiting until loading
   * completes.
   *
   * @returns true if the query is still loading results, false if loading is
   *          complete.
   */
  get loading(): boolean {
    return this._loading;
  }

  /**
   * Returns true if `path` matches this query's predicate, regardless of
   * the `limit` setting. Use `results()` to get the bounded result set.
   *
   * @param path The path to check.
   * @returns true if the path is included in the query results, false otherwise.
   */
  has(path: string): boolean {
    return this._includedPaths.has(path);
  }

  /**
   * Gets an iterable of all paths included in the query results.
   *
   * @remarks The returned paths may change during iteration if the underlying
   *          data source changes. Consider using {@link results()} for a stable
   *          snapshot if consistency is needed during iteration.
   *
   * @returns An iterable containing all paths that match the query criteria.
   */
  paths(): Iterable<string> {
    return this._includedPaths;
  }

  /**
   * Gets the results of the query as an array of managed items. The returned
   * items are mutable - any changes made to them will automatically trigger the
   * query to update its results.
   *
   * @returns An array of managed items that match the query criteria.
   */
  results(): readonly ManagedItem<OS>[] {
    if (
      !this._cachedResults || this._cachedResultsAge !== this._resultsGeneration
    ) {
      this._cachedResultsAge = this._resultsGeneration;
      const arr = new Array<ManagedItem<OS>>(this._includedPaths.size);
      let i = 0;
      for (const path of this._includedPaths) {
        arr[i++] = this.db.item<OS>(path);
      }
      this._cachedResults = arr;
      if (this.sortDescriptor) {
        if (!this._liveUpdates && this._sortField) {
          // In deferred mode with a field-based sort, use committed values so
          // sort order is consistent with valueForPath()/entries().
          const sign = this.sortDescending ? -1 : 1;
          const field = this._sortField;
          this._cachedResults.sort((left, right) => {
            const lHead = this._headIdForKey.get(left.path);
            const rHead = this._headIdForKey.get(right.path);
            const lVal = lHead
              ? this.repo.itemForCommit(lHead)?.get(field)
              : left.get(field);
            const rVal = rHead
              ? this.repo.itemForCommit(rHead)?.get(field)
              : right.get(field);
            return coreValueCompare(lVal, rVal) * sign;
          });
        } else {
          this._cachedResults.sort((left, right) => {
            if (!this._sortInfo) {
              this._sortInfo = {
                left,
                right,
                ctx: this.context,
              };
            } else {
              this._sortInfo.left = left;
              this._sortInfo.right = right;
              this._sortInfo.ctx = this.context;
            }
            return this.sortDescriptor!(this._sortInfo);
          });
        }
      }
      if (this.limit > 0 && this._cachedResults.length > this.limit) {
        this._cachedResults = this._cachedResults.slice(0, this.limit);
      }
      Object.freeze(this._cachedResults);
    }
    return this._cachedResults;
  }

  /**
   * Gets the item value for a given path key. The value is retrieved from the
   * repository's committed head or temporary records.
   *
   * @param path The path key to look up in the repository
   * @returns The item value if found, undefined otherwise
   */
  valueForPath(path: string): Item<OS> | undefined {
    if (this._liveUpdates && this.db.itemLoaded(path)) {
      return this.db.item<OS>(path).currentItem;
    }
    const head = this._headIdForKey.get(path);
    return head !== undefined ? this.repo.itemForCommit(head) : undefined;
  }

  /**
   * Returns a generator that yields key-value pairs for all items in the query
   * results. Each entry contains the item's path key and its corresponding
   * value.
   *
   * @returns A generator yielding [key, value] tuples for each item in the
   *          query
   */
  *entries(): Generator<Entry<OS>> {
    for (const key of this._includedPaths) {
      yield [key, this.valueForPath(key)!];
    }
  }

  /**
   * Registers a callback to be invoked when the query results change due to
   * updates in the underlying data source.
   *
   * @param handler The callback function to execute when results change
   * @returns A cleanup function that removes the event listener when called
   */
  onResultsChanged(handler: () => void): () => void {
    this.attach('DocumentChanged', handler);
    return () => {
      this.detach('DocumentChanged', handler);
    };
  }

  /**
   * Registers a callback to be invoked when the query finishes loading its
   * initial results. If loading is already finished, the callback will be
   * scheduled to run on the next event loop cycle.
   *
   * @param handler The callback function to execute when loading finishes
   * @returns A cleanup function that removes the event listener when called
   */
  onLoadingFinished(handler: () => void): () => void {
    if (this._loadingFinished) {
      return NextEventLoopCycleTimer.run(handler);
    }
    return this.once('LoadingFinished', () => {
      handler();
    });
  }

  /**
   * Returns a promise that resolves to true when the query finishes loading
   * its initial results. If loading is already finished, the promise resolves
   * on the next event loop cycle.
   *
   * @returns A promise that resolves to true when loading is finished
   */
  loadingFinished(): Promise<true> {
    let resolve;
    const result = new Promise<true>((res, _rej) => {
      resolve = res;
    });
    this.onLoadingFinished(() => resolve!(true));
    return result;
  }

  /**
   * Finds the first item in the query results where the specified field matches
   * the given value. If the field is the sort field, uses binary search for
   * O(log n) lookup. Otherwise performs a linear scan.
   *
   * @param fieldName The name of the field to search on
   * @param value The value to search for
   * @returns The first matching item, or undefined if no match found
   */
  find(
    fieldName: keyof SchemaDataType<OS>,
    value: SchemaDataType<OS>[keyof SchemaDataType<OS>],
  ): ManagedItem<OS> | undefined {
    const results = this.results();
    if (fieldName === this._sortField) {
      const userIdx = bsearch_idx(
        results.length,
        (idx) =>
          coreValueCompare(
            value,
            results[idx].get(fieldName as string),
          ) * (this.sortDescending ? -1 : 1),
      );
      if (
        userIdx >= 0 && userIdx < results.length &&
        results[userIdx].get(fieldName as string) === value
      ) {
        return results[userIdx];
      }
    } else {
      for (const item of results) {
        if (item.get(fieldName as string) === value) {
          return item;
        }
      }
    }
    return undefined;
  }

  protected override async resume(): Promise<void> {
    super.resume();
    if (!this._closed) {
      if (typeof this.source === 'string') {
        await this.db.open(this.source);
      }
      this.scanRepo();
      if (!this._sourceListenerCleanup) {
        // Repo emits the plain item key; a chained Query emits the full path.
        const isChainedQuery = this.source instanceof Query;
        this._sourceListenerCleanup = (
          (typeof this.source === 'string'
            ? this.repo
            : this.source) as Emitter<EventDocumentChanged>
        ).attach('DocumentChanged', (keyOrPath: string) => {
          const key = isChainedQuery
            ? itemPathGetPart(keyOrPath, 'item')!
            : keyOrPath;
          const commit = this.repo.headForKey(key);
          if (commit) {
            this.onNewCommit(commit);
          }
        });
      }
      if (this._liveUpdates && !this._liveListenerCleanup) {
        this._liveListenerCleanup = this.db.attach(
          'ItemChanged',
          (path: string, isRebase: boolean) =>
            this.onItemChanged(path, isRebase),
        );
        LIVE_QUERY_CLEANUP.register(this, this._liveListenerCleanup);
      }
    }
  }

  /**
   * Closes this query and cleans up its resources. This:
   * - Emits a 'Closed' event
   * - Unregisters from query persistence to stop caching
   * - Removes source change listeners
   * - Marks the query as closed
   *
   * Once closed, a query cannot be reopened. Create a new query instance
   * instead.
   *
   * Callers MUST call close() when a query is no longer needed to release
   * its event listeners. A FinalizationRegistry safety net exists for the
   * live-updates listener, but GC timing is non-deterministic.
   */
  close(): void {
    if (!this._closed) {
      this._closed = true;
      this.emit('Closed');
      this.repo.db.queryPersistence?.unregister(
        this as unknown as Query<Schema, Schema, ReadonlyJSONValue>,
      );
      if (this._sourceListenerCleanup) {
        this._sourceListenerCleanup();
        this._sourceListenerCleanup = undefined;
      }
      if (this._liveListenerCleanup) {
        LIVE_QUERY_CLEANUP.unregister(this);
        this._liveListenerCleanup();
        this._liveListenerCleanup = undefined;
      }
    }
  }

  protected override suspend(): void {
    if (!this._closed) {
      this.repo.db.queryPersistence?.unregister(
        this as unknown as Query<Schema, Schema, ReadonlyJSONValue>,
      );
      // After initial load completes, keep source and live listeners alive
      // so the query stays consistent even when no external listeners are
      // attached (e.g. after loadingFinished() resolves its once-listener).
      // Listeners are permanently torn down by close().
      if (!this._loadingFinished) {
        this._sourceListenerCleanup?.();
        this._sourceListenerCleanup = undefined;
        if (this._liveListenerCleanup) {
          this._liveListenerCleanup();
          this._liveListenerCleanup = undefined;
        }
      }
    }
    super.suspend();
  }

  // forceEmit: emit DocumentChanged even when the item was already included.
  // Used from handleDocChange with liveUpdates:false so that chained derived
  // queries hear about committed value-changes in items that stay in this query.
  // With liveUpdates:true the emit is skipped (onItemChanged already fired).
  private addPathToResults(
    path: string,
    currentDoc: Item<IS>,
    forceEmit = false,
  ): void {
    // Insert to the results set
    const isNew = !this._includedPaths.has(path);
    if (isNew) {
      this._includedPaths.add(path);
    }
    // Emit when membership changes, sort order may differ, or when the caller
    // needs downstream chained queries to be notified (forceEmit).
    if (isNew || this.sortDescriptor || forceEmit) {
      this.emit('DocumentChanged', path, currentDoc);
    }
  }

  private handleDocChange(
    path: string,
    prevDoc: Item<IS> | undefined,
    currentDoc: Item<IS>,
    head?: Commit,
  ): void {
    this._age = Math.max(this._age, head?.age || 0);
    // Always track committed head, regardless of whether the effective doc changed
    if (head) {
      this._headIdForKey.set(path, head.id);
    } else {
      this._headIdForKey.delete(path);
    }
    // When live updates are enabled and the item is already loaded, evaluate
    // the predicate against live (possibly uncommitted) state so that edits
    // made before the query was created are visible during the initial scan.
    const effectiveDoc = (this._liveUpdates && this.db.itemLoaded(path))
      ? this.db.item<IS>(path).currentItem as Item<IS>
      : currentDoc;
    if (!prevDoc?.isEqual(effectiveDoc)) {
      if (!this._predicateInfo) {
        this._predicateInfo = { path, item: effectiveDoc, ctx: this.context };
      } else {
        this._predicateInfo.path = path;
        this._predicateInfo.item = effectiveDoc;
        this._predicateInfo.ctx = this.context;
      }
      if (
        (!this.scheme || this.scheme.ns === effectiveDoc.schema.ns) &&
        !effectiveDoc.isDeleted &&
        this.predicate(this._predicateInfo!)
      ) {
        ++this._resultsGeneration;
        this.addPathToResults(path, effectiveDoc, !this._liveUpdates);
      } else if (this._includedPaths.has(path)) {
        if (this._removePath(path)) {
          this.emit('DocumentChanged', path, effectiveDoc);
        }
      }
    }
  }

  private onNewCommit(commit: Commit): void {
    if (this._closed) return;
    const repo = this.repo;
    const key = commit.key;
    const path = itemPathJoin(repo.path, key);
    // For local commits, onItemChanged fires before onNewCommit (set() →
    // onItemChanged → DocumentChanged), so we can skip handleDocChange here.
    // For remote commits the ordering is reversed: the isRebase parameter on
    // onItemChanged causes it to bail early, meaning we must fall through to
    // handleDocChange to emit DocumentChanged. During initial scan
    // (_loadingFinished=false) we must also run handleDocChange to populate
    // results.
    if (
      this._liveUpdates &&
      this._loadingFinished &&
      this.db.itemLoaded(path) &&
      commit.createdLocally
    ) {
      const currentHead = repo.headForKey(key);
      if (currentHead) this._headIdForKey.set(path, currentHead.id);
      this._age = Math.max(this._age, commit.age || 0);
      return;
    }
    const prevHeadId = this._headIdForKey.get(path);
    const currentHead = repo.headForKey(key);
    this._age = Math.max(this._age, commit.age || 0);
    if (currentHead && prevHeadId !== currentHead?.id) {
      const prevDoc = prevHeadId
        ? repo.itemForCommit(prevHeadId)
        : Item.nullItem(repo.db.registry);
      const currentDoc = currentHead
        ? repo.itemForCommit(currentHead)
        : Item.nullItem(repo.db.registry);
      this.handleDocChange(
        path,
        prevDoc as unknown as Item<IS>,
        currentDoc as unknown as Item<IS>,
        currentHead,
      );
    }
  }

  private onItemChanged(path: string, isRebase: boolean): void {
    if (this._closed) return;
    if (isRebase) {
      return;
    }
    // Only handle items in this query's repository
    if (!this._repoPrefix) this._repoPrefix = this.repo.path + '/';
    if (!path.startsWith(this._repoPrefix)) {
      return;
    }
    const wasIncluded = this.has(path);
    // For chained queries: if source no longer has this item, remove it from
    // derived and stop. This relies on the source query's onItemChanged running
    // before ours — guaranteed because the source query is always constructed
    // before the derived query, so its attach() call registers its listener
    // first, and Emitter dispatches in registration order (FIFO).
    if (this.source instanceof Query && !this.source.has(path)) {
      if (wasIncluded) {
        this._removePath(path);
        if (this.db.itemLoaded(path)) {
          this.emit(
            'DocumentChanged',
            path,
            this.db.item<IS>(path).currentItem,
          );
        }
      }
      return;
    }
    // Get current live state
    if (!this.db.itemLoaded(path)) {
      return;
    }
    const currentDoc = this.db.item<IS>(path).currentItem;
    if (!this._predicateInfo) {
      this._predicateInfo = { path, item: currentDoc, ctx: this.context };
    } else {
      this._predicateInfo.path = path;
      this._predicateInfo.item = currentDoc;
      this._predicateInfo.ctx = this.context;
    }
    const matchesPredicate =
      (!this.scheme || this.scheme.ns === currentDoc.schema.ns) &&
      !currentDoc.isDeleted &&
      this.predicate(this._predicateInfo);
    if (matchesPredicate && !wasIncluded) {
      ++this._resultsGeneration;
      this.addPathToResults(path, currentDoc, true);
    } else if (!matchesPredicate && wasIncluded) {
      this._removePath(path);
      this.emit('DocumentChanged', path, currentDoc);
    } else if (matchesPredicate && wasIncluded) {
      if (this.sortDescriptor) {
        // Re-sort on next results() call
        ++this._resultsGeneration;
      }
      this.emit('DocumentChanged', path, currentDoc);
    }
  }

  private _removePath(path: string): boolean {
    if (this._includedPaths.delete(path)) {
      ++this._resultsGeneration;
      return true;
    }
    return false;
  }

  private async scanRepo(): Promise<void> {
    const startTime = performance.now();
    const repo = this.repo;
    const cache = await repo.db.queryPersistence?.get(repo.path, this.id);
    let skipped = 0;
    let total = 0;
    let maxAge = 0;
    const cachedPaths = new Set(cache?.results || []);

    // Fast path: if cache covers all changes, replay cached results in O(k)
    if (cache && cache.age >= repo.storage.age) {
      for (const path of cache.results) {
        const key = itemPathGetPart(path, 'item')!;
        const head = repo.headForKey(key);
        if (head) {
          this._headIdForKey.set(path, head.id);
          // On initial load (_loadingFinished=false), populate _includedPaths
          // from cache. On re-scans (_loadingFinished=true), _includedPaths is
          // already maintained by onItemChanged — don't re-add items that were
          // removed by live state changes before this commit landed.
          if (!this._loadingFinished) {
            const val = repo.valueForKey<IS>(key);
            if (val) this.addPathToResults(path, val[0]);
          }
        }
      }
      this._age = cache.age;
      this._scanTimeMs = performance.now() - startTime;
      if (!this._loadingFinished) {
        this._loadingFinished = true;
        this.repo.db.queryPersistence?.register(
          this as unknown as Query<Schema, Schema, ReadonlyJSONValue>,
        );
        this._loading = false;
        this.emit('LoadingFinished');
      }
      return;
    }

    const processPath = (path: string, stopHandle: () => void) => {
      const key = itemPathGetPart(path, 'item')!;
      ++total;
      if (!this.isActive) {
        stopHandle();
        return;
      }
      const commitAge = repo.storage.ageForKey[key] || 0;
      if (commitAge > maxAge) {
        maxAge = commitAge;
      }
      this._age = maxAge;
      if (cache && commitAge <= cache.age) {
        if (cachedPaths.has(path)) {
          const head = repo.headForKey(key);
          if (head) {
            this._headIdForKey.set(path, head.id);
            const val = repo.valueForKey<IS>(key);
            if (val) this.addPathToResults(path, val[0]);
          }
        }
        ++skipped;
        return;
      }
      const head = repo.headForKey(key)!;
      if (head) {
        this.onNewCommit(head);
      }
    };
    const pathsIter = (
      typeof this.source === 'string' ? repo : this.source
    ).paths();

    const cleanup = async () => {
      if (this.isActive) {
        this._scanTimeMs = performance.now() - startTime;
        this._age = Math.max(this._age, maxAge);
        if (!this._loadingFinished) {
          this._loadingFinished = true;
          this.repo.db.queryPersistence?.register(
            this as unknown as Query<Schema, Schema, ReadonlyJSONValue>,
          );
          await this.repo.db.queryPersistence?.flush(this.repo.path);
          this._loading = false;
          this.emit('LoadingFinished');
        }
      }
    };

    if (isBrowser()) {
      let cancelCallback: undefined | (() => void);
      const cancelPromise = CoroutineScheduler.sharedScheduler().forEach(
        pathsIter,
        (path) => {
          if (!cancelCallback) {
            cancelCallback = () => cancelPromise.cancel();
          }
          processPath(path, cancelCallback);
        },
      );
      cancelPromise.then(cleanup, cleanup);
    } else {
      let stopProcessing = false;
      const stopProcessingHandle = () => {
        stopProcessing = true;
      };
      for (const key of pathsIter) {
        processPath(key, stopProcessingHandle);
        if (stopProcessing) {
          break;
        }
      }
      await cleanup();
    }
  }
}

const gGeneratedQueryIds = new Map<string, string>();

/** Resolves an explicit ID or derives one from the unnormalized query config. */
export function resolveQueryId<
  IS extends Schema = Schema,
  OS extends IS = IS,
  CTX extends ReadonlyJSONValue = ReadonlyJSONValue,
>(
  config: Pick<
    QueryConfig<IS, OS, CTX>,
    | 'id'
    | 'source'
    | 'predicate'
    | 'sortBy'
    | 'ctx'
    | 'schema'
    | 'sortDescending'
    | 'limit'
    | 'liveUpdates'
  >,
): string {
  return config.id ??
    generateQueryId(
      config.source,
      config.predicate,
      config.sortBy,
      config.ctx,
      config.schema?.ns,
      config.sortDescending,
      config.limit,
      config.liveUpdates,
    );
}

/**
 * Generates a unique identifier for a query based on its configuration.
 * The ID is deterministic and will be the same for queries with identical:
 * - Source (repository or path)
 * - Predicate function
 * - Sort descriptor
 * - Context data
 * - Schema namespace
 * - sortDescending flag
 * - limit value
 * - liveUpdates flag
 *
 * @param IS The input schema type for items in the query
 * @param OS The output schema type for items in the query
 * @param CTX The context type passed to predicate/sort functions
 */
export function generateQueryId<
  IS extends Schema = Schema,
  OS extends IS = IS,
  CTX extends ReadonlyJSONValue = ReadonlyJSONValue,
>(
  source: QuerySource<IS, OS>,
  predicate: Predicate<IS, CTX> | undefined,
  sortDescriptor:
    | keyof SchemaDataType<OS>
    | SortDescriptor<OS, CTX>
    | undefined,
  ctx: CTX | undefined,
  ns: string | null | undefined,
  sortDescending?: boolean,
  limit?: number,
  liveUpdates?: boolean,
): string {
  const sourceId = typeof source === 'string'
    ? source
    : source instanceof Repository
    ? source.path
    : source.id;
  const key = [
    sourceId,
    predicate,
    sortDescriptor,
    ctx,
    ns,
    sortDescending,
    limit,
    liveUpdates,
  ].map(queryIdPart).join('');
  let hash = gGeneratedQueryIds.get(key);
  if (!hash) {
    hash = murmur3(key, 0).toString(36);
    gGeneratedQueryIds.set(key, hash);
  }
  return hash;
}

function queryIdPart(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const type = typeof value;
  const text = type === 'object' ? JSON.stringify(value) : String(value);
  return `${type}:${text.length}:${text}`;
}
