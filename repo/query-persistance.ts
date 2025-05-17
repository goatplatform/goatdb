import type { JSONObject, ReadonlyJSONValue } from '../base/interfaces.ts';
import type { Query } from './query.ts';
import { Repository } from './repo.ts';
import { SimpleTimer, type Timer } from '../base/timer.ts';
import { kSecondMs } from '../base/date.ts';
import type { Schema } from '../cfds/base/schema.ts';

const QUERY_CACHE_VERSION = 1;

/**
 * Represents a cached query result with metadata.
 *
 * @property age - Age of the cache when it was created
 * @property results - Array of item keys that matched the query
 */
export interface QueryCache {
  readonly age: number;
  // readonly filter: BloomFilter;
  readonly results: string[];
}

/**
 * Represents a serialized query cache that can be stored and loaded.
 *
 * @property age - The age of the cache when it was created
 * @property results - Array of item keys that matched the query criteria
 */
export interface EncodedQueryCache extends JSONObject {
  age: number;
  results: string[];
}

/**
 * Represents a serialized repository cache that can be stored and loaded.
 *
 * @property version - The version of the cache format, used for migration
 * @property queries - Map of query IDs to their cached results
 */
export interface EncodedRepoCache extends JSONObject {
  version: typeof QUERY_CACHE_VERSION;
  queries: Record<string, EncodedQueryCache>;
}

/**
 * Interface for storage backends that persist query results.
 *
 * Implementations of this interface handle loading and storing query cache data
 * for repositories. This enables query results to be persisted across sessions
 * and restored when the database is reopened.
 *
 * @property load - Loads cached query data for a repository
 * @property store - Stores query cache data for a repository
 */
export interface QueryPersistenceStorage {
  /**
   * Loads cached query data for a repository.
   *
   * @param repoId - The repository ID to load cache data for
   * @returns Promise resolving to the cached data or undefined if none exists
   */
  load(repoId: string): Promise<EncodedRepoCache | undefined>;

  /**
   * Stores query cache data for a repository.
   *
   * @param repoId - The repository ID to store cache data for
   * @param value - The cache data to store
   * @returns Promise resolving to true if storage was successful
   */
  store(repoId: string, value: EncodedRepoCache): Promise<boolean>;
}

/**
 * Manages persistence of query results across sessions.
 *
 * QueryPersistence handles caching and storing query results to improve performance
 * and enable offline access. It maintains a cache of query results in memory and
 * periodically flushes them to persistent storage.
 */
export class QueryPersistence {
  /** Maps repository paths to their active queries */
  private readonly _queries: Map<
    string,
    Set<Query<Schema, Schema, ReadonlyJSONValue>>
  >;

  /** Tracks the last persisted generation number for each query */
  private readonly _persistedGeneration: Map<
    Query<Schema, Schema, ReadonlyJSONValue>,
    number
  >;

  /** In-memory cache of query results by repository and query ID */
  private readonly _cachedDataForRepo: Map<string, Map<string, QueryCache>>;

  /** Timer that triggers periodic flushing of cached data */
  private readonly _flushTimer: Timer;

  /** Tracks ongoing cache loading operations */
  private readonly _loadingPromises: Map<
    string,
    Promise<Map<string, QueryCache>>
  >;

  /** Tracks ongoing flush operations */
  private readonly _flushPromises: Map<string, Promise<void>>;

  /**
   * Creates a new QueryPersistence instance.
   * @param storage Optional storage backend for persisting query results
   */
  constructor(readonly storage?: QueryPersistenceStorage) {
    this._queries = new Map();
    this._persistedGeneration = new Map();
    this._cachedDataForRepo = new Map();
    this._flushTimer = new SimpleTimer(
      5 * kSecondMs,
      false,
      () => this.flushAll(),
      'Query Persistance Flush',
    ).schedule();
    this._loadingPromises = new Map();
    this._flushPromises = new Map();
  }

  /**
   * Starts the periodic flush timer.
   */
  start(): void {
    this._flushTimer.schedule();
  }

  /**
   * Stops the periodic flush timer.
   */
  close(): void {
    this._flushTimer.unschedule();
  }

  /**
   * Registers a query for persistence.
   * @param query The query to register
   */
  register(query: Query<Schema, Schema, ReadonlyJSONValue>): void {
    let set = this._queries.get(query.repo.path);
    if (!set) {
      set = new Set();
      this._queries.set(query.repo.path, set);
    }
    set.add(query);
    this.flush(query.repo.path);
  }

  /**
   * Unregisters a query from persistence.
   * @param query The query to unregister
   */
  unregister(query: Query<Schema, Schema, ReadonlyJSONValue>): void {
    const set = this._queries.get(query.repo.path);
    if (set) {
      set.delete(query);
      if (set.size === 0) {
        this._queries.delete(query.repo.path);
        this._persistedGeneration.delete(query);
      }
    }
  }

  /**
   * Retrieves cached query results for a repository and optional query ID.
   * @param repoId The repository path
   * @param queryId Optional query ID to filter results
   * @returns The cached query results or undefined if not found
   */
  async get(repoId: string, queryId?: string): Promise<QueryCache | undefined> {
    repoId = Repository.normalizePath(repoId);
    let map = this._cachedDataForRepo.get(repoId);
    if (!map) {
      map = await this.loadCacheForRepo(repoId);
      this._cachedDataForRepo.set(repoId, map || new Map());
    }

    return queryId ? map?.get(queryId) : undefined;
  }

  /**
   * Loads the cache for a repository, handling concurrent requests.
   * @param repoId The repository path
   * @returns A promise resolving to the repository's query cache
   */
  private loadCacheForRepo(repoId: string): Promise<Map<string, QueryCache>> {
    let promise = this._loadingPromises.get(repoId);
    if (!promise) {
      promise = this._loadCacheForRepoImpl(repoId);
      this._loadingPromises.set(repoId, promise);
      promise.finally(() => {
        if (this._loadingPromises.get(repoId) === promise) {
          this._loadingPromises.delete(repoId);
        }
      });
    }
    return promise;
  }

  /**
   * Implementation of cache loading for a repository.
   * @param repoId The repository path
   * @returns A promise resolving to the repository's query cache
   */
  private async _loadCacheForRepoImpl(
    repoId: string,
  ): Promise<Map<string, QueryCache>> {
    repoId = Repository.normalizePath(repoId);
    const json = await this.storage?.load(repoId);
    if (json?.version !== QUERY_CACHE_VERSION) {
      return new Map();
    }
    const map = new Map();
    for (const queryId in json.queries) {
      map.set(queryId, json.queries[queryId]);
    }
    return map;
  }

  /**
   * Flushes all cached query results to storage.
   */
  async flushAll(): Promise<void> {
    for (const repoId of this._queries.keys()) {
      await this.flush(repoId);
    }
    this._flushTimer.unschedule();
  }

  /**
   * Flushes cached query results for a repository to storage.
   * @param repoId The repository path
   * @returns A promise that resolves when the flush is complete
   */
  flush(repoId: string): Promise<void> {
    repoId = Repository.normalizePath(repoId);
    // No-op if repo isn't loaded
    if (!this.repoExists(repoId)) {
      return Promise.resolve();
    }
    let promise = this._flushPromises.get(repoId);
    if (!promise) {
      promise = this._flushImpl(repoId);
      this._flushPromises.set(repoId, promise);
    }
    return promise;
  }

  /**
   * Implementation of flushing cached query results to storage.
   * @param repoId The repository path
   */
  private async _flushImpl(repoId: string): Promise<void> {
    // No-op if repo isn't loaded
    if (!this.repoExists(repoId)) {
      return;
    }
    if (!this.storage) {
      return;
    }
    repoId = Repository.normalizePath(repoId);
    let changed = false;
    const queries = this._queries.get(repoId) || [];
    for (const q of queries) {
      const prevGen = this._persistedGeneration.get(q) || 0;
      if (prevGen !== q.age) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      return;
    }
    const repoCache: EncodedRepoCache = {
      version: QUERY_CACHE_VERSION,
      queries: {},
    };
    for (const q of queries) {
      repoCache.queries[q.id] = {
        age: q.age,
        results: Array.from(q.paths()),
      };
    }
    this._cachedDataForRepo.delete(repoId);
    await this.storage.store(repoId, repoCache);
    this._flushPromises.delete(repoId);
  }

  /**
   * Closes a repository and clears all related caches and pending operations.
   * Waits for any in-progress flushes to finish before clearing state.
   * @param repoId The repository path
   */
  async closeRepo(repoId: string): Promise<void> {
    repoId = Repository.normalizePath(repoId);
    // Wait for any in-progress flushes
    const flushPromise = this._flushPromises.get(repoId);
    if (flushPromise) {
      try {
        await flushPromise;
      } catch {
        // Ignore errors from flush
      }
    }
    // Remove all queries for this repo
    const queries = this._queries.get(repoId);
    if (queries) {
      for (const q of queries) {
        this._persistedGeneration.delete(q);
      }
      this._queries.delete(repoId);
    }
    // Remove cached data
    this._cachedDataForRepo.delete(repoId);
    // Remove any pending loading or flush promises
    this._loadingPromises.delete(repoId);
    this._flushPromises.delete(repoId);
  }

  /**
   * Checks if any caches or state exist for a given repo.
   * Returns true if any internal maps have entries for the repo.
   */
  repoExists(repoId: string): boolean {
    repoId = Repository.normalizePath(repoId);
    const hasQueries = this._queries.has(repoId);
    const hasCache = this._cachedDataForRepo.has(repoId);
    const hasLoading = this._loadingPromises.has(repoId);
    const hasFlush = this._flushPromises.has(repoId);
    // Check if any query in persistedGeneration belongs to this repo
    let hasPersisted = false;
    for (const q of this._persistedGeneration.keys()) {
      if (q.repo.path === repoId) {
        hasPersisted = true;
        break;
      }
    }
    return hasQueries || hasCache || hasLoading || hasFlush || hasPersisted;
  }
}
