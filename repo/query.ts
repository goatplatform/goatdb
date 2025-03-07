import { type EventDocumentChanged, Repository } from './repo.ts';
import { Item } from '../cfds/base/item.ts';
import type { Commit } from './commit.ts';
import { Emitter } from '../base/emitter.ts';
import { NextEventLoopCycleTimer } from '../base/timer.ts';
import { md51 } from '../external/md5.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { BloomFilter } from '../base/bloom.ts';
import type { GoatDB } from '../db/db.ts';
import type { ReadonlyJSONValue } from '../base/interfaces.ts';
import { isBrowser } from '../base/common.ts';
import { CoroutineScheduler } from '../base/coroutine.ts';
import { itemPathGetPart, itemPathJoin } from '../db/path.ts';
import type { ManagedItem } from '../db/managed-item.ts';
import type { SchemaDataType } from '../mod.ts';
import { bsearch_idx } from '../base/algorithms.ts';
import { coreValueCompare } from '../base/core-types/comparable.ts';

const BLOOM_FPR = 0.01;

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
 * sort descriptor, schema, id, context, and limit.
 *
 * @template IS The input schema type for the query
 * @template OS The output schema type for the query
 * @template CTX The context type for additional query data
 */
export type QueryConfig<
  IS extends Schema,
  OS extends IS,
  CTX extends ReadonlyJSONValue,
> = {
  /** The database instance this query will operate on */
  db: GoatDB;
  /** The source repository, query or path to query from */
  source: QuerySource<IS, OS>;
  /** Optional predicate function to filter items */
  predicate?: Predicate<IS, CTX>;
  /** Optional function or field name to determine sort order of results.
   * If a function is provided, it will be used as a custom comparator.
   * If a field name is provided, results will be sorted by that field's values
   * using standard comparison rules. */
  sortBy?: SortDescriptor<OS, CTX> | keyof SchemaDataType<OS>;
  /** Optional flag that if true, flips the natural order of the sortBy */
  sortDescending?: boolean;
  /** Optional schema to restrict query results to */
  schema?: IS;
  /** Optional unique identifier for this query */
  id?: string;
  /** Optional context data passed to predicate and sort functions */
  ctx?: CTX;
  /** Optional maximum number of results to return */
  limit?: number;
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
 */
export class Query<
  IS extends Schema,
  OS extends IS,
  CTX extends ReadonlyJSONValue,
> extends Emitter<QueryEvent> {
  /** Unique identifier for this query */
  readonly id: string;

  /** Database instance this query operates on */
  readonly db: GoatDB;

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
  private readonly _headIdForKey: Map<string, string>; // Key -> Commit ID
  private readonly _includedPaths: string[];
  private _loadingFinished = false;
  private _scanTimeMs = 0;
  private _bloomFilter: BloomFilter;
  private _bloomFilterSize: number;
  private _bloomFilterCount = 0;
  private _bloomFilterDeleteCount = 0;
  private _age = 0;
  private _sourceListenerCleanup?: () => void;
  private _closed = false;
  private _cachedResults: ManagedItem<OS>[] | undefined;
  private _cachedResultsAge = 0;
  private _loading: boolean = true;

  /**
   * Creates a new Query instance.
   *
   * @param config The query configuration object containing:
   * @param config.db The database instance to query
   * @param config.id Optional unique identifier for the query
   * @param config.source The data source to query (repository or path)
   * @param config.predicate Optional predicate function to filter items
   * @param config.sortDescriptor Optional function to determine sort order
   * @param config.ctx Optional context data passed to predicate/sort functions
   * @param config.schema Optional schema type for the query
   * @param config.limit Optional maximum number of results (0 for unlimited)
   */
  constructor({
    db,
    id,
    source,
    predicate,
    sortBy,
    sortDescending,
    ctx,
    schema,
    limit,
  }: QueryConfig<IS, OS, CTX>) {
    super();
    this.db = db;
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
    this.id = id ||
      generateQueryId(
        source as QuerySource,
        predicate,
        sortBy,
        ctx,
        schema?.ns,
      );
    this.context = ctx as CTX;
    this.source = source;
    this.scheme = schema;
    this.limit = limit || 0;
    this.predicate = predicate;
    this.sortDescriptor = sortBy;
    this.sortDescending = sortDescending ?? false;
    this._headIdForKey = new Map();
    // this._includedKeys = new Set();
    this._includedPaths = [];
    this._bloomFilterSize = 1024;
    this._bloomFilter = new BloomFilter({
      size: this._bloomFilterSize,
      fpr: BLOOM_FPR,
      maxHashes: 2,
    });
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
    return this._includedPaths.length;
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
   * Checks if a given path is included in the query results.
   *
   * @param path The path to check.
   * @returns true if the path is included in the query results, false otherwise.
   */
  has(path: string): boolean {
    if (!this._bloomFilter.has(path)) {
      return false;
    }
    return this._includedPaths.includes(path);
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
    if (!this._cachedResults || this._cachedResultsAge !== this.age) {
      this._cachedResults = [];
      this._cachedResultsAge = this.age;
      for (const path of this._includedPaths) {
        this._cachedResults.push(this.db.item(path));
      }
      if (this.sortDescriptor) {
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
      if (this.limit > 0) {
        const delta = this._cachedResults.length - this.limit;
        this._cachedResults = this._cachedResults.splice(
          this._cachedResults.length - delta - 1,
          delta,
        );
      }
      Object.freeze(this._cachedResults);
    }
    return this._cachedResults;
  }

  /**
   * Gets the item value for a given path key. The value is retrieved from the
   * repository's committed head or temporary records.
   *
   * @param key The path key to look up in the repository
   * @returns The item value if found, undefined otherwise
   */
  valueForPath(key: string): Item<OS> | undefined {
    const head = this._headIdForKey.get(key);
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
    this.attach('DocumentChanged', () => {
      handler();
    });
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
        this._sourceListenerCleanup = (
          (typeof this.source === 'string'
            ? this.repo
            : this.source) as Emitter<EventDocumentChanged>
        ).attach(
          'DocumentChanged',
          (key: string) => this.onNewCommit(this.repo.headForKey(key)!),
        );
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
   */
  close(): void {
    if (!this._closed) {
      this.emit('Closed');
      this.repo.db.queryPersistence?.unregister(
        this as unknown as Query<Schema, Schema, ReadonlyJSONValue>,
      );
      if (this._sourceListenerCleanup) {
        this._sourceListenerCleanup();
        this._sourceListenerCleanup = undefined;
      }
    }
  }

  protected override suspend(): void {
    if (!this._closed) {
      this.repo.db.queryPersistence?.unregister(
        this as unknown as Query<Schema, Schema, ReadonlyJSONValue>,
      );
      this._sourceListenerCleanup!();
      this._sourceListenerCleanup = undefined;
    }
    super.suspend();
  }

  private addPathToResults(path: string, currentDoc: Item<IS>): void {
    // Insert to the results set
    if (!this.has(path)) {
      this._includedPaths.push(path);
      // Rebuild bloom filter if it became too big, to maintain its FPR
      if (++this._bloomFilterCount >= this._bloomFilterSize) {
        this._rebuildBloomFilter();
      } else {
        this._bloomFilter.add(path);
      }
    }
    // Report this change downstream
    this.emit('DocumentChanged', path, currentDoc);
  }

  private handleDocChange(
    path: string,
    prevDoc: Item<IS> | undefined,
    currentDoc: Item<IS>,
    head?: Commit,
  ): void {
    this._age = Math.max(this._age, head?.age || 0);
    if (!prevDoc?.isEqual(currentDoc)) {
      if (head) {
        this._headIdForKey.set(path, head.id);
      } else {
        this._headIdForKey.delete(path);
      }
      if (!this._predicateInfo) {
        this._predicateInfo = { path, item: currentDoc, ctx: this.context };
      } else {
        this._predicateInfo.path = path;
        this._predicateInfo.item = currentDoc;
        this._predicateInfo.ctx = this.context;
      }
      if (
        (!this.scheme || this.scheme.ns === currentDoc.schema.ns) &&
        !currentDoc.isDeleted &&
        this.predicate(this._predicateInfo!)
      ) {
        this.addPathToResults(path, currentDoc);
      } else if (this._bloomFilter.has(path)) {
        const idx = this._includedPaths.indexOf(path);
        if (idx >= 0) {
          this._includedPaths.splice(idx, 1);
          // If the number of removed items gets above the desired threshold,
          // rebuild our filter to maintain a reasonable FPR
          if (++this._bloomFilterDeleteCount >= this._bloomFilterCount * 0.1) {
            this._rebuildBloomFilter();
          }
          this.emit('DocumentChanged', path, currentDoc);
        }
      }
    }
  }

  private onNewCommit(commit: Commit): void {
    const repo = this.repo;
    const key = commit.key;
    const prevHeadId = this._headIdForKey.get(key);
    const currentHead = repo.headForKey(key);
    this._age = Math.max(this._age, commit.age || 0);
    if (currentHead && prevHeadId !== currentHead?.id) {
      const prevDoc = prevHeadId
        ? repo.itemForCommit(prevHeadId)
        : Item.nullItem();
      const currentDoc = currentHead
        ? repo.itemForCommit(currentHead)
        : Item.nullItem();
      this.handleDocChange(
        itemPathJoin(repo.path, key),
        prevDoc as unknown as Item<IS>,
        currentDoc as unknown as Item<IS>,
        currentHead,
      );
    }
  }

  private async scanRepo(): Promise<void> {
    const startTime = performance.now();
    const repo = this.repo;
    const cache = await repo.db.queryPersistence?.get(repo.path, this.id);
    let skipped = 0;
    let total = 0;
    let maxAge = 0;
    const cachedPaths = new Set(cache?.results || []);

    const processPath = (path: string, stopHandle: () => void) => {
      const key = itemPathGetPart(path, 'item')!;
      ++total;
      if (!this.isActive) {
        stopHandle();
        return;
      }
      const commitAge = repo.storage.ageForKey[path] || 0;
      if (commitAge > maxAge) {
        maxAge = commitAge;
      }
      this._age = maxAge;
      if (cache && commitAge <= cache.age) {
        if (cachedPaths.has(path)) {
          const head = repo.headForKey(key);
          if (head) {
            this._headIdForKey.set(path, head.id);
            this.addPathToResults(path, repo.valueForKey<IS>(key)![0]);
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
    }
    if (this.isActive) {
      this._scanTimeMs = performance.now() - startTime;
      this._age = Math.max(this._age, maxAge);
      if (!this._loadingFinished) {
        this._loadingFinished = true;
        this.repo.db.queryPersistence?.register(
          this as unknown as Query<Schema, Schema, ReadonlyJSONValue>,
        );
        await this.repo.db.queryPersistence?.flush(this.id);
        this._loading = false;
        this.emit('LoadingFinished');
      }
    }
    // console.log(
    //   `Age change = ${ageChange.toLocaleString()}, Skipped ${skipped.toLocaleString()}, Total ${total.toLocaleString()}`,
    // );
  }

  private _rebuildBloomFilter(): void {
    // Since bloom filters are so cheap, we use an order of magnitude increments
    // in size, to minimize allocation overhead
    this._bloomFilterSize *= 10;
    this._bloomFilter = new BloomFilter({
      size: this._bloomFilterSize,
      fpr: BLOOM_FPR,
      maxHashes: 2,
    });
    // Reset the counter before re-adding all keys
    this._bloomFilterCount = 0;
    for (const key of this.paths()) {
      this._bloomFilter.add(key);
      ++this._bloomFilterCount;
    }
    // The new filter doesn't include all previously deleted keys, thus we
    // can safely reset the delete count
    this._bloomFilterDeleteCount = 0;
  }
}

const gGeneratedQueryIds = new Map<string, string>();

/**
 * Generates a unique identifier for a query based on its configuration.
 * The ID is deterministic and will be the same for queries with identical:
 * - Source (repository or path)
 * - Predicate function
 * - Sort descriptor
 * - Context data
 * - Schema namespace
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
  source: QuerySource,
  predicate: Predicate<IS, CTX> | undefined,
  sortDescriptor:
    | keyof SchemaDataType<OS>
    | SortDescriptor<OS, CTX>
    | undefined,
  ctx: CTX | undefined,
  ns: string | null | undefined,
): string {
  let key: string;
  if (typeof source === 'string') {
    key = source;
  } else if (source instanceof Repository) {
    key = source.path;
  } else {
    key = source.id;
  }
  key += '|';
  key += predicate ? predicate.toString() : 'null';
  key += '|';
  key += sortDescriptor ? sortDescriptor.toString() : 'null';
  key += '|';
  key += JSON.stringify(ctx);
  key += '|';
  key += ns;
  let hash = gGeneratedQueryIds.get(key);
  if (!hash) {
    hash = md51(key);
    gGeneratedQueryIds.set(key, hash);
  }
  return hash;
}
