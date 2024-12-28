import { EventDocumentChanged, Repository } from './repo.ts';
import { Item } from '../cfds/base/item.ts';
import { Commit } from './commit.ts';
import { Emitter } from '../base/emitter.ts';
import { NextEventLoopCycleTimer } from '../base/timer.ts';
import { md51 } from '../external/md5.ts';
import { Schema } from '../cfds/base/schema.ts';
import { BloomFilter } from '../base/bloom.ts';
import { GoatDB } from '../db/db.ts';
import { ReadonlyJSONValue } from '../base/interfaces.ts';
import { isBrowser, uniqueId } from '../base/common.ts';
import { CoroutineScheduler } from '../base/coroutine.ts';
import { itemPathGetPart, itemPathJoin, ItemPathPart } from '../db/path.ts';
import { ManagedItem } from '../db/managed-item.ts';

const BLOOM_FPR = 0.01;

export type Entry<S extends Schema = Schema> = [
  path: string | null,
  item: Item<S>,
];
export type PredicateInfo<S extends Schema, CTX> = {
  path: string;
  item: Item<S>;
  ctx: CTX;
};
export type Predicate<S extends Schema, CTX extends ReadonlyJSONValue> = (
  info: PredicateInfo<S, CTX>,
) => boolean;

export type SortInfo<S extends Schema, CTX> = {
  left: ManagedItem<S>;
  right: ManagedItem<S>;
  ctx: CTX;
};
export type SortDescriptor<S extends Schema, CTX> = (
  info: SortInfo<S, CTX>,
) => number;
export type QuerySource<IS extends Schema = Schema, OS extends IS = IS> =
  | Repository
  | Query<IS, OS, ReadonlyJSONValue>
  | string;

export type QueryConfig<
  IS extends Schema,
  OS extends IS,
  CTX extends ReadonlyJSONValue,
> = {
  db: GoatDB;
  source: QuerySource<IS, OS>;
  predicate?: Predicate<IS, CTX>;
  sortDescriptor?: SortDescriptor<OS, CTX>;
  schema?: IS;
  id?: string;
  ctx?: CTX;
  limit?: number;
};

export type QueryEvent = EventDocumentChanged | 'LoadingFinished' | 'Closed';

export class Query<
  IS extends Schema,
  OS extends IS,
  CTX extends ReadonlyJSONValue,
> extends Emitter<QueryEvent> {
  readonly id: string;
  readonly db: GoatDB;
  readonly context: CTX;
  readonly scheme?: IS;
  readonly limit: number = 0;
  private readonly source: QuerySource<IS, OS>;
  private _predicateInfo?: PredicateInfo<IS, CTX>;
  private readonly predicate: Predicate<IS, CTX>;
  private _sortInfo?: SortInfo<OS, CTX>;
  private readonly sortDescriptor: SortDescriptor<OS, CTX> | undefined;
  private readonly _headIdForKey: Map<string, string>; // Key -> Commit ID
  private readonly _tempRecordForKey: Map<string, Item<OS>>;
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

  // static open<
  //   IS extends Scheme = Scheme,
  //   OS extends IS = IS,
  //   ST extends RepoStorage<ST> = MemRepoStorage,
  // >(config: QueryConfig<IS, OS, ST>): Query<IS, OS, ST> {
  //   let id = config.id;
  //   if (!id) {
  //     id = md51(
  //       config.predicate.toString() + config.sortDescriptor?.toString(),
  //     );
  //   }
  //   let q = this._openQueries.get(id);
  //   if (!q) {
  //     q = new this(config) as unknown as Query;
  //     this._openQueries.set(id, q);
  //   }
  //   return q as unknown as Query<IS, OS, ST>;
  // }

  constructor({
    db,
    id,
    source,
    predicate,
    sortDescriptor,
    ctx,
    schema,
    limit,
  }: QueryConfig<IS, OS, CTX>) {
    super();
    this.db = db;
    if (!predicate) {
      predicate = () => true;
    }
    this.id = id || generateQueryId(predicate, sortDescriptor, ctx, schema?.ns);
    this.context = ctx as CTX;
    this.source = source;
    this.scheme = schema;
    this.limit = limit || 0;
    this.predicate = predicate;
    this.sortDescriptor = sortDescriptor;
    this._headIdForKey = new Map();
    this._tempRecordForKey = new Map();
    // this._includedKeys = new Set();
    this._includedPaths = [];
    this._bloomFilterSize = 1024;
    this._bloomFilter = new BloomFilter({
      size: this._bloomFilterSize,
      fpr: BLOOM_FPR,
      maxHashes: 2,
    });
  }

  get repo(): Repository {
    if (typeof this.source === 'string') {
      return this.db.repository(this.source)!;
    }
    return this.source instanceof Repository ? this.source : this.source.repo;
  }

  get count(): number {
    return this._includedPaths.length;
  }

  get scanTimeMs(): number {
    return this._scanTimeMs;
  }

  get bloomFilter(): BloomFilter {
    return this._bloomFilter;
  }

  get age(): number {
    return this._age;
  }

  get loading(): boolean {
    return this._loading;
  }

  has(path: string): boolean {
    if (!this._bloomFilter.has(path)) {
      return false;
    }
    return this._includedPaths.includes(path);
  }

  paths(): Iterable<string> {
    return this._includedPaths;
  }

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
      Object.freeze(this._cachedResults);
    }
    return this._cachedResults;
  }

  valueForPath(key: string): Item<OS> {
    const head = this._headIdForKey.get(key);
    return ((head && this.repo.recordForCommit(head)) ||
      this._tempRecordForKey.get(key))!;
  }

  *entries(): Generator<Entry<OS>> {
    for (const key of this._includedPaths) {
      yield [key, this.valueForPath(key)!];
    }
  }

  onResultsChanged(handler: () => void): () => void {
    this.attach('DocumentChanged', () => {
      handler();
    });
    return () => {
      this.detach('DocumentChanged', handler);
    };
  }

  onLoadingFinished(handler: () => void): () => void {
    if (this._loadingFinished) {
      return NextEventLoopCycleTimer.run(handler);
    }
    return this.once('LoadingFinished', () => {
      handler();
    });
  }

  loadingFinished(): Promise<true> {
    let resolve;
    const result = new Promise<true>((res, rej) => {
      resolve = res;
    });
    this.onLoadingFinished(() => resolve!(true));
    return result;
  }

  protected async resume(): Promise<void> {
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
        ).attach('DocumentChanged', (key: string) =>
          this.onNewCommit(this.repo.headForKey(key)!),
        );
      }
    }
  }

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
      // if (Query._openQueries.get(this.id) === (this as unknown as Query)) {
      //   Query._openQueries.delete(this.id);
      // }
    }
  }

  protected suspend(): void {
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
    if (
      this.has(path) ||
      (this.limit > 0 && this._includedPaths.length >= this.limit)
    ) {
      return;
    }
    this._includedPaths.push(path);
    // Rebuild bloom filter if it became too big, to maintain its FPR
    if (++this._bloomFilterCount >= this._bloomFilterSize) {
      this._rebuildBloomFilter();
    } else {
      this._bloomFilter.add(path);
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
      this._tempRecordForKey.delete(path);
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
        ? repo.recordForCommit(prevHeadId)
        : Item.nullItem();
      const currentDoc = currentHead
        ? repo.recordForCommit(currentHead)
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
      const key = itemPathGetPart(path, 'item');
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

export function generateQueryId<
  IS extends Schema = Schema,
  OS extends IS = IS,
  CTX extends ReadonlyJSONValue = ReadonlyJSONValue,
>(
  predicate: Predicate<IS, CTX> | undefined,
  sortDescriptor: SortDescriptor<OS, CTX> | undefined,
  ctx: CTX | undefined,
  ns: string | null | undefined,
): string {
  const baseId =
    predicate !== undefined && sortDescriptor !== undefined
      ? predicate?.toString() + sortDescriptor?.toString()
      : 'null';
  const key = baseId + JSON.stringify(ctx) + ns;
  let hash = gGeneratedQueryIds.get(key);
  if (!hash) {
    hash = md51(key);
    gGeneratedQueryIds.set(key, hash);
  }
  return hash;
}
