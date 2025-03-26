import { Emitter } from '../base/emitter.ts';
// import { BloomFilter } from '../base/bloom.ts';
import {
  type Session,
  sessionFromItem,
  signCommit,
  type TrustPool,
} from '../db/session.ts';
import * as ArrayUtils from '../base/array.ts';
import { filterIterable, mapIterable } from '../base/common.ts';
import { coreValueCompare } from '../base/core-types/index.ts';
import { assert } from '../base/error.ts';
import * as SetUtils from '../base/set.ts';
import { Edit } from '../cfds/base/edit.ts';
import { Code, ServerError, serviceUnavailable } from '../cfds/base/errors.ts';
import { concatChanges, type DataChanges } from '../cfds/base/object.ts';
import { Item } from '../cfds/base/item.ts';
import {
  kNullSchema,
  kSchemaSession,
  type Schema,
  SchemaEquals,
  type SchemaTypeSession,
} from '../cfds/base/schema.ts';
import {
  Commit,
  commitContentsIsDocument,
  type DeltaContents,
} from './commit.ts';
import { AdjacencyList } from '../base/adj-list.ts';
import { RendezvousHash } from '../base/rendezvous-hash.ts';
import { kSecondMs } from '../base/date.ts';
import { randomInt } from '../base/math.ts';
import type { JSONObject, ReadonlyJSONObject } from '../base/interfaces.ts';
import { downloadJSON } from '../base/browser.ts';
import { CoroutineScheduler } from '../base/coroutine.ts';
import { SchedulerPriority } from '../base/coroutine.ts';
import { CONNECTION_ID } from './commit.ts';
import { compareStrings } from '../base/string.ts';
import { RedBlackTree } from '@std/data-structures';
import type { GoatDB } from '../db/db.ts';
import { BloomFilter } from '../base/bloom.ts';
// import { BloomFilter } from '../cpp/bloom_filter.ts';
import { itemPathIsValid, itemPathJoin } from '../db/path.ts';
import type { AuthRule, AuthRuleInfo } from '../cfds/base/data-registry.ts';

/**
 * Fired when the value of a document changes (the head of the commit graph
 * changed).
 */
export type EventDocumentChanged = 'DocumentChanged';
/**
 * Fired when a new commit is added to this repository. A lot of these events
 * won't actually affect the value of the document since their historical
 * commits that don't change the graph's head.
 *
 * This event is being fired in a coroutine as to not block the main thread.
 */
export type EventNewCommit = 'NewCommit';
/**
 * The same as EventNewCommit, except fired immediately and not in a coroutine.
 * Be very careful when attaching to this event as it'll easily block the UI
 * thread.
 */
export type EventNewCommitSync = 'NewCommitSync';
/**
 * A union type of all the events Repository instances emits.
 */
export type RepositoryEvent =
  | EventDocumentChanged
  | EventNewCommit
  | EventNewCommitSync;

export interface RepoStorage<T extends RepoStorage<T>> {
  readonly ageForKey: Record<string, number>;
  get age(): number;

  numberOfCommits(): number;
  numberOfKeys(): number;
  getCommit(id: string): Commit | undefined;
  allCommitsIds(): Iterable<string>;
  commitsForKeyDesc(key: string | null): Iterable<Commit>;
  allKeys(): Iterable<string>;
  persistCommits(c: Iterable<Commit>): Iterable<Commit>;
  close(): void;
  // ageForKey(key: string): number;
}

interface CachedHead {
  commit: Commit;
  timestamp: number;
}

export interface CommitGraph {
  commit: Commit;
  children: CommitGraph[];
}

export interface RepositoryConfig<T extends RepoStorage<T> = MemRepoStorage> {
  allowedNamespaces?: string[];
  authorizer?: AuthRule;
  priorityRepo?: boolean;
  storage?: T;
}

export class Repository<
  ST extends RepoStorage<ST> = MemRepoStorage,
> extends Emitter<RepositoryEvent> {
  readonly priorityRepo: boolean;
  readonly storage: ST;
  readonly trustPool: TrustPool;
  readonly allowedNamespaces: string[] | undefined;
  private readonly _cachedHeadsByKey: Map<string, CachedHead>;
  readonly authorizer?: AuthRule;
  private readonly _cachedRecordForCommit: Map<string, Item>;
  private readonly _cachedValueForKey: Map<string, [Item, Commit] | undefined>;
  private readonly _adjList: AdjacencyList;
  private readonly _pendingCommitPromises: Map<
    string,
    Promise<Commit | undefined>
  >;
  private readonly _cachedCommitsPerUser: Map<string | undefined, string[]>;
  private readonly _commitIsCorruptedResult: Map<string, boolean>;
  private readonly _cachedCommitsWithRecord: Set<string>;
  private readonly _cachedLeavesForKey: Map<string, Commit[]>;
  private readonly _authInfo: AuthRuleInfo;

  allowMerge = true;

  constructor(
    readonly db: GoatDB,
    readonly path: string,
    trustPool: TrustPool,
    {
      allowedNamespaces,
      authorizer,
      priorityRepo,
      storage,
    }: RepositoryConfig<ST> = {},
  ) {
    super();
    this.path = Repository.normalizePath(path);
    this.storage = storage || (new MemRepoStorage() as unknown as ST);
    this.trustPool = trustPool;
    this.allowedNamespaces = allowedNamespaces;
    this.authorizer = authorizer;
    this._cachedHeadsByKey = new Map();
    this._cachedValueForKey = new Map();
    this._cachedRecordForCommit = new Map();
    this._adjList = new AdjacencyList();
    this._pendingCommitPromises = new Map();
    this._cachedCommitsPerUser = new Map();
    this._commitIsCorruptedResult = new Map();
    this.priorityRepo = priorityRepo === true;
    this._cachedCommitsWithRecord = new Set();
    this._cachedLeavesForKey = new Map();
    this._authInfo = {
      db: this.db,
      repoPath: this.path,
      itemKey: '',
      session: this.trustPool.currentSession,
      op: 'read',
    };
  }

  static path(storage: string, id: string): string {
    return this.normalizePath(`${storage}/${id}`);
  }

  static parseId(id: string): [storage: string, id: string] {
    while (id.startsWith('/')) {
      id = id.substring(1);
    }
    const comps = id.split('/');
    assert(comps.length === 2);
    return comps as [string, string];
  }

  static normalizePath(id: string): string {
    if (!id.startsWith('/')) {
      id = '/' + id;
    }
    if (id.endsWith('/')) {
      id = id.substring(0, id.length - 1);
    }
    return id;
  }

  static readonly sysDirId: string = this.path('sys', 'dir');

  get orgId(): string {
    return this.trustPool.orgId;
  }

  numberOfCommits(session?: Session): number {
    const { authorizer } = this;
    if (
      session &&
      session.id !== this.trustPool.currentSession.id &&
      session.owner !== 'root' &&
      authorizer
    ) {
      let count = 0;
      for (const _ of this.commits(session)) {
        ++count;
      }
      return count;
    }
    return this.storage.numberOfCommits();
  }

  getCommit(id: string, session?: Session): Commit {
    const c = this.storage.getCommit(id);
    if (!c) {
      throw serviceUnavailable();
    }
    const { authorizer } = this;
    if (
      !this.db.trusted &&
      session &&
      session.id !== this.trustPool.currentSession.id &&
      session.owner !== 'root' &&
      authorizer
    ) {
      this._authInfo.itemKey = c.key;
      this._authInfo.session = session;
      this._authInfo.op = 'read';
      if (!authorizer(this._authInfo)) {
        throw serviceUnavailable();
      }
    }
    return c;
  }

  hasCommit(id: string): boolean {
    return this.storage.getCommit(id) !== undefined;
  }

  *commits(session?: Session): Generator<Commit> {
    const { authorizer } = this;
    const checkAuth = !this.db.trusted && session &&
      session.id !== this.trustPool.currentSession.id &&
      session.owner !== 'root' && authorizer;
    let resultIds: Iterable<string>;
    if (!checkAuth) {
      resultIds = this.storage.allCommitsIds();
    } else {
      const uid = session.owner;
      let cachedCommits = this._cachedCommitsPerUser.get(uid);
      if (!cachedCommits) {
        cachedCommits = Array.from(
          filterIterable(
            this.storage.allCommitsIds(),
            (id) => {
              this._authInfo.itemKey = id;
              this._authInfo.session = session;
              this._authInfo.op = 'read';
              return authorizer(this._authInfo);
            },
          ),
        );
        this._cachedCommitsPerUser.set(uid, cachedCommits);
      }
      resultIds = cachedCommits;
    }
    for (const id of resultIds) {
      yield this.getCommit(id);
    }
  }

  *commitsForKey(key: string, session?: Session): Generator<Commit> {
    const { authorizer } = this;
    const commits = this.storage.commitsForKeyDesc(key);
    for (const c of commits) {
      if (
        this.db.trusted ||
        (
          !session ||
          session.id === this.trustPool.currentSession.id ||
          session.owner === 'root' ||
          !authorizer
        )
      ) {
        yield c;
        continue;
      }
      if (authorizer) {
        this._authInfo.itemKey = c.key;
        this._authInfo.session = session || this.trustPool.currentSession;
        this._authInfo.op = 'read';
        if (authorizer(this._authInfo)) {
          yield c;
        }
      }
    }
  }

  keyExists(key: string): boolean {
    for (const _c of this.storage.commitsForKeyDesc(key)) {
      return true;
    }
    return false;
  }

  /**
   * This method computes a quick diff between the given commit and all of its
   * parents. It determines which fields were changed in this commit, rather
   * than what the changes were.
   *
   * @param commit The commit to inspect.
   * @returns An array of fields changed in this commit or null if the full
   *          information isn't yet available for this commit due to partial
   *          commit graph.
   */
  changedFieldsInCommit(commit: Commit | string): string[] | null {
    if (typeof commit === 'string') {
      if (!this.hasCommit(commit)) {
        return null;
      }
      commit = this.getCommit(commit);
    }
    if (!this.hasItemForCommit(commit)) {
      return null;
    }
    const finalRecord = this.itemForCommit(commit);
    const fields = new Set<string>();
    for (const p of commit.parents) {
      if (!this.hasItemForCommit(p)) {
        return null;
      }
      const rec = this.itemForCommit(p);
      SetUtils.update(fields, rec.diffKeys(finalRecord, false));
    }
    return Array.from(fields);
  }

  /**
   * This method determines, to a high probability, whether the given commit is
   * a leaf commit or not, even when the full graph isn't available.
   *
   * It works by inspecting the bloom filters of the newest 2log[4](N) commits,
   * and checking for the presence of the candidate commit. If present in all
   * filters, the commit guaranteed not to be a leaf.
   *
   * @param candidate The commit to inspect.
   * @returns true if the commit is a leaf and can be safely included in a merge
   *          commit, false otherwise.
   */
  commitIsHighProbabilityLeaf(candidate: Commit | string): boolean {
    const id = typeof candidate === 'string' ? candidate : candidate.id;
    if (this._adjList.hasInEdges(id)) {
      return false;
    }
    if (typeof candidate === 'string') {
      if (!this.hasCommit(id)) {
        return false;
      }
      candidate = this.getCommit(id);
    }
    const commitsForKey = Array.from(this.commitsForKey(candidate.key));
    const graphSize = Math.max(
      commitsForKey.length,
      commitsForKey[commitsForKey.length - 1].ancestorsCount,
    );
    // 2log[fpr](N) = K. Since FPR = 0.25, we're using 2log[4](N).
    const agreementSize = 2 * (Math.log2(graphSize) / Math.log2(4));
    // We must consider the newest commits as leaves, otherwise we'd deadlock
    // and not converge on all branches. These cases work out OK because the
    // merge will take the latest commit per connection thus skipping
    // temporary gaps in the graph.
    if (commitsForKey.length < agreementSize) {
      return true;
    }
    // For older commits we can consult their ancestors filter
    for (let i = 0; i <= agreementSize; ++i) {
      const c = commitsForKey[i];
      if (!c.ancestorsFilter.has(id)) {
        return true;
      }
    }
    return false;
  }

  leavesForKey(key: string, session?: Session): readonly Commit[] {
    let leaves = this._cachedLeavesForKey.get(key);
    if (!leaves) {
      const adjList = this._adjList;
      // const result: Commit[] = [];
      leaves = [];
      for (const c of this.commitsForKey(key, session)) {
        if (!adjList.hasInEdges(c.id) && this.hasItemForCommit(c)) {
          leaves.push(c);
        }
      }
      // leaves = this.filterLatestCommitsByConnection(result);
      Object.freeze(leaves);
      this._cachedLeavesForKey.set(key, leaves);
    }
    return leaves;
  }

  keys(session?: Session): Iterable<string> {
    const { authorizer } = this;
    if (
      !this.db.trusted &&
      session &&
      session.id !== this.trustPool.currentSession.id &&
      session.owner !== 'root' &&
      authorizer
    ) {
      return filterIterable(
        this.storage.allKeys(),
        (key) => {
          this._authInfo.itemKey = key;
          this._authInfo.session = session;
          this._authInfo.op = 'read';
          return authorizer(this._authInfo);
        },
      );
    }
    return this.storage.allKeys();
  }

  paths(session?: Session): Iterable<string> {
    return mapIterable(
      this.keys(session),
      (key) => itemPathJoin(this.path, key),
    );
  }

  /**
   * Given an iterable of commits, this method returns their Lowest Common
   * Ancestor or undefined if no such ancestor exists (meaning the commits
   * belong to disconnected histories).
   *
   * @param commits An iterable of commits.
   *
   * @returns A tuple of 3 values:
   *          1. The commits to include in the merge. Commits with broken
   *             ancestry path are skipped from the merge if a common base can't
   *             be found.
   *
   *          2. The base commit (LCA) to use for the merge, or undefined if
   *             one can't be found.
   *
   *          3. The scheme to use for the merge.
   */
  findMergeBase(
    commits: Commit[],
  ): [
    commits: Commit[],
    base: Commit | undefined,
    scheme: Schema,
    reachedRoot: boolean,
  ] {
    let result: Commit | undefined;
    let scheme = kNullSchema;
    let reachedRoot = false;
    const includedCommits: Commit[] = [];
    for (const c of commits) {
      if (!result) {
        if (this.hasItemForCommit(c)) {
          result = c;
          scheme = this.itemForCommit(c).schema;
          includedCommits.push(c);
        }
        continue;
      }
      if (!this.hasItemForCommit(c)) {
        continue;
      }
      const [newBase, foundRoot] = this._findLCAMergeBase(result, c);
      reachedRoot = reachedRoot || foundRoot;
      // if (!newBase) {
      //   [newBase, foundRoot] = this._findChronologicalMergeBase(result, c);
      //   reachedRoot = reachedRoot || foundRoot;
      // }
      if (!newBase) {
        continue;
      }
      result = newBase;
      includedCommits.push(c);
      const s = this.itemForCommit(c).schema;
      assert(scheme.ns === null || scheme.ns === s.ns); // Sanity check
      if (s.version > (scheme?.version || 0)) {
        scheme = s;
      }
    }
    // if (result && commits.includes(result)) {
    //   result = undefined;
    // }
    return [includedCommits, result, scheme, reachedRoot];
  }

  /**
   * Given two commits, this method finds the base from which to perform a 3 way
   * merge for c1 and c2. This is a simple iterative LCA implementation based on
   * the assumption of a DAG (if it's not, something is terribly broken).
   *
   * NOTE: This method ignores any broken branches and treats them as the end
   *       of the chain. This has a few effects:
   *
   *       1. A band actor can't bring the entire system to a freeze by not
   *          sending part of the graph.
   *
   *       2. The system is much more responsive by not waiting for the full
   *          graph to be available.
   *
   *       3. A slow party may have some of its edits reverted if not acting
   *          fast enough during concurrent editing.
   *
   * @param c1 First commit.
   * @param c2 Second commit.
   *
   * @returns The base for a 3-way merge between c1 and c2, or undefined if no
   *          such base can be found.
   */
  private _findLCAMergeBase(
    c1: Commit,
    c2: Commit,
  ): [Commit | undefined, boolean] {
    if (!c1.parents.length || !c2.parents.length) {
      return [undefined, true];
    }
    if (c1.key !== c2.key) {
      return [undefined, false];
    }
    // if (c1.contentsChecksum === c2.contentsChecksum) {
    //   return [c1, false];
    // }
    if (c1.parents.includes(c2.id)) {
      return [c2, false];
    }
    if (c2.parents.includes(c1.id)) {
      return [c1, false];
    }
    const parents1 = new Set<string>(c1.parents);
    const parents2 = new Set<string>(c2.parents);
    // parents1.add(c1.id);
    // parents2.add(c2.id);

    let reachedRoot = false;
    while (true) {
      const bases = SetUtils.intersection(parents1, parents2);
      if (bases.size > 0) {
        const prioritizedBases = Array.from(bases)
          .filter((id) => this.hasCommit(id))
          .map((id) => this.getCommit(id))
          .sort(compareCommitsDesc);
        for (const base of prioritizedBases) {
          if (this.hasItemForCommit(base)) {
            return [base, reachedRoot];
          }
        }
      }
      let updated = false;
      for (const parentId of Array.from(parents1)) {
        if (this.hasCommit(parentId)) {
          const parent = this.getCommit(parentId);
          if (parent.parents.length == 0) {
            reachedRoot = true;
            continue;
          }
          for (const p of parent.parents) {
            if (!parents1.has(p)) {
              parents1.add(p);
              updated = true;
            }
          }
        }
      }
      for (const parentId of Array.from(parents2)) {
        if (this.hasCommit(parentId)) {
          const parent = this.getCommit(parentId);
          if (parent.parents.length == 0) {
            reachedRoot = true;
            continue;
          }
          for (const p of parent.parents) {
            if (!parents2.has(p)) {
              parents2.add(p);
              updated = true;
            }
          }
        }
      }
      if (!updated) {
        break;
      }
    }
    return [undefined, reachedRoot];
  }

  private _findChronologicalMergeBase(
    c1: Commit,
    c2: Commit,
  ): [base: Commit | undefined, reachedRoot: boolean] {
    if (commitInGracePeriod(c1)) {
      return [undefined, false];
    }
    if (commitInGracePeriod(c2)) {
      return [undefined, false];
    }
    const minTs = Math.min(c1.timestamp, c2.timestamp);
    const base = this.findCommitBefore(c1.key, minTs, [c1.session, c2.session]);
    return [base, base === undefined];
  }

  private findCommitBefore(
    key: string,
    ts: number,
    sessions?: string | Iterable<string>,
  ): Commit | undefined {
    const commits = this.commitsForKey(key);
    if (!sessions) {
      sessions = [];
    } else if (typeof sessions === 'string') {
      sessions = [sessions];
    } else {
      sessions = Array.from(sessions);
    }
    for (const candidate of commits) {
      if (
        candidate.timestamp < ts &&
        (sessions as string[]).includes(candidate.session) &&
        this.hasItemForCommit(candidate)
      ) {
        return candidate;
      }
    }
    return undefined;
  }

  hasItemForCommit(c: Commit | string): boolean {
    // let tail: Commit[] = [];
    while (c !== undefined) {
      if (this._cachedCommitsWithRecord.has(typeof c === 'string' ? c : c.id)) {
        return true;
      }
      if (typeof c === 'string') {
        if (!this.hasCommit(c)) {
          return false;
        }
        c = this.getCommit(c);
      }
      if (commitContentsIsDocument(c.contents)) {
        this._cachedCommitsWithRecord.add(c.id);
        return true;
      }
      // tail.push(c);
      c = c.contents.base;
      // if (
      //   this.hasRecordForCommit(c.contents.base)
      //   //&& !this.commitIsCorrupted(c)
      // ) {
      //   this._cachedCommitsWithRecord.add(c.id);
      //   return true;
      // }
    }
    return false;
  }

  commitIsCorrupted(c: Commit): boolean {
    if (commitContentsIsDocument(c.contents)) {
      return false;
    }
    if (this._commitIsCorruptedResult.has(c.id)) {
      return this._commitIsCorruptedResult.get(c.id)!;
    }
    const contents: DeltaContents = c.contents as DeltaContents;
    // Assume everything is good if we don't have the base commit to check with
    if (!this.hasCommit(contents.base)) {
      this._commitIsCorruptedResult.set(c.id, false);
      return false;
    }
    const result = this.itemForCommit(contents.base).clone();
    if (result.checksum === contents.edit.srcChecksum) {
      result.patch(contents.edit.changes);
      if (result.checksum === contents.edit.dstChecksum) {
        this._commitIsCorruptedResult.set(c.id, false);
        return false;
      }
    }
    this._commitIsCorruptedResult.set(c.id, true);
    return true;
  }

  findNonCorruptedParentsFromCommits(parents: (Commit | string)[]): Commit[] {
    const parentsToCheck: Commit[] = [];
    for (const p of parents) {
      if (typeof p === 'string') {
        if (this.hasCommit(p)) {
          parentsToCheck.push(this.getCommit(p));
        }
      } else {
        parentsToCheck.push(p);
      }
    }
    const result: Commit[] = [];
    for (const p of parentsToCheck) {
      if (this.commitIsCorrupted(p) || !this.hasItemForCommit(p)) {
        ArrayUtils.append(
          result,
          this.findNonCorruptedParentsFromCommits(p.parents),
        );
      } else {
        result.push(p);
      }
    }
    return result;
  }

  findLatestNonCorruptedCommitForKey(key: string): Commit | undefined {
    const commits = this.commitsForKey(key);
    for (const c of commits) {
      if (!this.commitIsCorrupted(c) && this.hasItemForCommit(c)) {
        return c;
      }
    }
    return undefined;
  }

  static callCount = 0;

  itemForCommit<S extends Schema>(c: Commit | string): Item<S> {
    try {
      if (++Repository.callCount === 2) {
        // debugger;
      }
      let result = this._cachedRecordForCommit.get(
        typeof c === 'string' ? c : c.id,
      );
      if (!result) {
        if (typeof c === 'string') {
          c = this.getCommit(c);
        }
        if (commitContentsIsDocument(c.contents)) {
          result = c.contents.record;
        } else {
          let commitCorrupted = this._commitIsCorruptedResult.get(c.id);
          if (commitCorrupted !== true) {
            const contents: DeltaContents = c.contents as DeltaContents;
            result = this.itemForCommit(contents.base).clone();
            if (result.checksum === contents.edit.srcChecksum) {
              result.patch(contents.edit.changes);
              commitCorrupted = result.checksum !== contents.edit.dstChecksum;
            } else {
              commitCorrupted = true;
            }
            this._commitIsCorruptedResult.set(c.id, commitCorrupted);
          }
          if (commitCorrupted) {
            // if (!readonly) {
            //   const goodCommitsToMerge =
            //     this.findNonCorruptedParentsFromCommits(c.parents);
            //   if (goodCommitsToMerge.length > 0) {
            //     // If any of the checksums didn't match, we create a new commit that
            //     // reverts the bad one we've just found. While discarding data, this
            //     // allows parties to continue their work without being stuck.
            //     this.createMergeCommit(
            //       goodCommitsToMerge,
            //       undefined,
            //       c.id,
            //       false,
            //     );
            //   }
            // }
            const lastGoodCommit = this.findLatestNonCorruptedCommitForKey(
              c.key,
            );
            // No good parents are available. This key is effectively null.
            result = lastGoodCommit
              ? this.itemForCommit(lastGoodCommit)
              : Item.nullItem(this.db.registry);
          }
          // assert(result.checksum === contents.edit.srcChecksum);
          // result.patch(contents.edit.changes);
          // assert(result.checksum === contents.edit.dstChecksum);
        }
        result!.lock();
        this._cachedRecordForCommit.set(c.id, result!);
      }
      return result! as unknown as Item<S>;
    } finally {
      --Repository.callCount;
    }
  }

  private cacheHeadForKey(
    key: string,
    head: Commit | undefined,
  ): Commit | undefined {
    if (!head) {
      return undefined;
    }
    const entry = this._cachedHeadsByKey.get(key);
    if (entry?.commit.id === head.id) {
      // entry.timestamp = performance.now();
      return head;
    }
    if (!this.hasItemForCommit(head)) {
      return undefined;
      // const ancestors = this.findNonCorruptedParentsFromCommits(head.parents);
      // if (!ancestors || ancestors.length === 0) {
      //   head = this.findLatestNonCorruptedCommitForKey(head.key);
      // } else {
      //   ancestors.sort(compareCommitsDesc);
      //   head = ancestors[0];
      // }
    }
    if (head) {
      this._cachedHeadsByKey.set(key, {
        commit: head,
        timestamp: 0, //performance.now(),
      });
    }
    return head;
  }

  private pickBestCommitForCurrentClient(
    commits: Iterable<Commit>,
  ): Commit | undefined {
    commits = Array.from(commits).sort(compareCommitsDesc);
    for (const c of commits) {
      if (c.connectionId === CONNECTION_ID && this.hasItemForCommit(c)) {
        return c;
      }
    }
    const sessionId = this.trustPool.currentSession.id;
    for (const c of commits) {
      if (c.session === sessionId && this.hasItemForCommit(c)) {
        return c;
      }
    }
    for (const c of commits) {
      if (this.hasItemForCommit(c)) {
        return c;
      }
    }
    // No good commits found
    return undefined;
  }

  /**
   * This method finds and returns the head for the given key. This is a
   * readonly operation and does not attempt to merge any leaves.
   *
   * @param key The key to search for.
   *
   * @returns The head commit, or undefined if no commit can be found for this
   *          key. Note that while this method may return undefined, some
   *          commits may still be present for this key. This happens when these
   *          commits are delta commits, and their base isn't present thus
   *          rendering them unreadable.
   */
  headForKey(key: string): Commit | undefined {
    const cacheEntry = this._cachedHeadsByKey.get(key);
    if (
      cacheEntry &&
      cacheEntry.commit.session === CONNECTION_ID
      // && performance.now() - cacheEntry.timestamp <= HEAD_CACHE_EXPIRATION_MS
    ) {
      return cacheEntry.commit;
    }
    const leaves = this.leavesForKey(key);
    if (leaves.length === 1 && this.hasItemForCommit(leaves[0])) {
      return this.cacheHeadForKey(key, leaves[0]);
    }
    if (leaves.length > 1) {
      const head = this.pickBestCommitForCurrentClient(leaves);
      if (head) {
        return this.cacheHeadForKey(key, head);
      }
    }
    return this.cacheHeadForKey(
      key,
      this.pickBestCommitForCurrentClient(this.commitsForKey(key)),
    );
  }

  private createMergeCommit(
    commitsToMerge: Commit[],
    // parents?: string[],
    mergeLeader?: string,
    revert?: string,
    deltaCompress = true,
  ): Promise<Commit | undefined> {
    if (commitsToMerge.length <= 0 /*|| !this.allowMerge*/) {
      return Promise.resolve(undefined);
    }
    const key = commitsToMerge[0].key;
    let result = this._pendingCommitPromises.get(key);
    if (!result) {
      result = this._createMergeCommitImpl(
        commitsToMerge,
        // parents,
        mergeLeader,
        revert,
        deltaCompress,
      );
      result.finally(() => {
        if (this._pendingCommitPromises.get(key) === result) {
          this._pendingCommitPromises.delete(key);
        }
      });
      this._pendingCommitPromises.set(key, result);
    } else {
      // Disallow concurrent commits for any given key
      return Promise.resolve(undefined);
    }
    return result;
  }

  private filterLatestCommitsByConnection(commits: Iterable<Commit>): Commit[] {
    const connectionToCommit = new Map<string, Commit>();
    for (const c of commits) {
      const prev = connectionToCommit.get(c.connectionId);
      if (!prev || prev.timestamp < c.timestamp) {
        connectionToCommit.set(c.connectionId, c);
      }
    }
    return Array.from(connectionToCommit.values());
  }

  private createMergeRecord(
    commitsToMerge: Commit[],
  ): [Item, Commit | undefined] {
    commitsToMerge = this.filterLatestCommitsByConnection(
      commitsToMerge,
    ).filter((c) => this.hasItemForCommit(c));
    if (!commitsToMerge.length) {
      return [Item.nullItem(this.db.registry), undefined];
    }
    const session = this.trustPool.currentSession.id;
    const roots = commitsToMerge
      .filter((c) => c.parents.length === 0)
      .sort(compareCommitsAsc);
    commitsToMerge = commitsToMerge
      .filter((c) => c.parents.length > 0)
      .sort(compareCommitsAsc);
    // Find the base for our N-way merge
    let lca: Commit | undefined, scheme: Schema, foundRoot: boolean;
    // When merging roots, we use the null record as the merge base
    if (roots.length > 0) {
      scheme = roots[0].scheme!;
      foundRoot = true;
    } else if (commitsToMerge.length === 1) {
      // Special case: a single chain of commits.
      scheme = this.itemForCommit(commitsToMerge[0]).schema || kNullSchema;
      foundRoot = false;
    } else {
      [commitsToMerge, lca, scheme, foundRoot] = this.findMergeBase(
        commitsToMerge,
      );
    }
    if (commitsToMerge.length === 0 && !foundRoot && roots.length === 0) {
      return [Item.nullItem(this.db.registry), undefined];
    }
    // If no LCA is found then we're dealing with concurrent writers who all
    // created of the same key unaware of each other.
    // Use the null record as a base in this case.
    const base = lca
      ? this.itemForCommit(lca).clone()
      : Item.nullItem(this.db.registry).clone();
    // Upgrade base to merge scheme
    if (scheme.ns !== null) {
      base.upgradeSchema(scheme);
    }
    // Compute all changes to be applied in this merge
    let changes: DataChanges = {};
    // First, handle any new roots that may have appeared as leaves.
    // We transform them to diff format by computing a diff from null.
    // Note that we start with these changes in order to let later changes
    // override them as concurrent root creation is likely a temporary
    // error.
    const nullRecord = Item.nullItem(this.db.registry);
    for (const c of roots) {
      const record = this.itemForCommit(c);
      if (record.isNull) {
        continue;
      }
      changes = concatChanges(
        changes,
        nullRecord.diff(record as unknown as Item, c.session === session),
      );
    }
    // Second, compute a compound diff from our base to all unique records
    for (const c of commitsToMerge) {
      let record = this.itemForCommit(c);
      // Before computing the diff, upgrade the record to the scheme decided
      // for this merge.
      if (scheme.ns !== null) {
        record = record.clone();
        record.upgradeSchema(scheme);
      }
      changes = concatChanges(
        changes,
        base.diff(record, c.session === session),
      );
    }
    // Patch, and we're done.
    base.patch(changes);
    return [base, lca];
  }

  private ancestorsFilterForKey(key: string): [BloomFilter, number] {
    const adjList = this._adjList;
    const ancestors = new Set<string>();
    for (const commit of this.commitsForKey(key)) {
      if (adjList.hasInEdges(commit.id)) {
        ancestors.add(commit.id);
      }
    }
    const result = new BloomFilter({
      size: ancestors.size,
      fpr: 0.25,
    });
    for (const id of ancestors) {
      result.add(id);
    }
    return [result, ancestors.size];
  }

  private async _createMergeCommitImpl(
    commitsToMerge: Commit[],
    // parents?: string[],
    mergeLeader?: string,
    revert?: string,
    deltaCompress = true,
  ): Promise<Commit | undefined> {
    if (commitsToMerge.length <= 0 /*|| !this.allowMerge*/) {
      return undefined;
    }
    const key = commitsToMerge[0].key;
    const session = this.trustPool.currentSession.id;
    const [ancestorsFilter, ancestorsCount] = this.ancestorsFilterForKey(key);
    assert(ancestorsCount > 0, 'Merge commit got empty ancestors filter'); // Sanity check
    try {
      const [merge, base] = this.createMergeRecord(commitsToMerge);
      if (merge.isNull) {
        return undefined;
      }
      let mergeCommit = new Commit({
        session,
        key,
        contents: merge,
        parents: commitsToMerge.map((c) => c.id),
        ancestorsFilter,
        ancestorsCount,
        mergeBase: base?.id,
        mergeLeader,
        revert,
        orgId: this.orgId,
      });
      if (deltaCompress) {
        mergeCommit = this.deltaCompressIfNeeded(mergeCommit);
      }
      const signedCommit = await signCommit(
        this.trustPool.currentSession,
        mergeCommit,
      );
      await this.persistVerifiedCommits([signedCommit]);
      return this.cacheHeadForKey(key, signedCommit);
    } catch (e) {
      if (!(e instanceof ServerError && e.code === Code.ServiceUnavailable)) {
        debugger;
        throw e; // Unknown error. Rethrow.
      }
    }
  }

  async mergeIfNeeded(key: string): Promise<Commit | undefined> {
    const leaves = this.leavesForKey(key);
    if (!leaves.length) {
      return undefined;
    }
    if (leaves.length === 1) {
      return undefined;
    }
    const sessionId = this.trustPool.currentSession.id;
    // In order to keep merges simple and reduce conflicts and races,
    // concurrent editors choose a soft leader amongst all currently active
    // writers. Non-leaders will back off and not perform any merge commits,
    // instead waiting for the leader(s) to merge.
    const mergeLeaderSession = mergeLeaderFromLeaves(leaves) || sessionId;
    if (
      leaves.length > 1 &&
      //this.allowMerge &&
      mergeLeaderSession === sessionId
    ) {
      // Filter out any commits with equal records
      const commitsToMerge = this.commitsWithUniqueItems(
        leaves.filter((c) => this.commitIsHighProbabilityLeaf(c)),
      ).sort(coreValueCompare);
      if (commitsToMerge.length === 1) {
        return undefined;
      }
      const mergeCommit = await this.createMergeCommit(
        commitsToMerge,
        mergeLeaderSession,
      );
      if (mergeCommit) {
        return mergeCommit;
      }
    }
    return undefined;
  }

  private commitsWithUniqueItems(commits: readonly Commit[]): Commit[] {
    const result: Commit[] = [];
    const items: Item[] = [];
    for (const c of commits) {
      if (this.hasItemForCommit(c)) {
        const item = this.itemForCommit(c);
        let foundMatch = false;
        for (const i of items) {
          if (i.isEqual(item)) {
            foundMatch = true;
            break;
          }
        }
        if (!foundMatch) {
          items.push(item);
          result.push(c);
        }
      }
    }
    return result;
  }

  valueForKey<T extends Schema = Schema>(
    key: string,
  ): [Item<T>, Commit] | undefined {
    let result = this._cachedValueForKey.get(key);
    if (!this._cachedValueForKey.has(key)) {
      const head = this.headForKey(key);
      if (head) {
        result = [this.itemForCommit(head), head];
      }
      // if (!result) {
      //   result = Document.nullDocument();
      // }
      this._cachedValueForKey.set(key, result);
    }
    return result as [Item<T>, Commit] | undefined;
  }

  /**
   * Updates the head record for a given key.
   *
   * @param key The key who's head to update.
   * @param value The value to write.
   *
   * @returns Whether or not a new commit had been generated. Regardless of the
   * returned value, future calls to `valueForKey` will return the updated
   * record.
   */
  async setValueForKey<S extends Schema>(
    key: string,
    value: Item<S>,
    parentCommit: string | Commit | undefined,
  ): Promise<Commit | undefined> {
    assert(
      itemPathIsValid(itemPathJoin(this.path, key)),
      `Invalid key: ${key}`,
    );
    if (this._pendingCommitPromises.has(key)) {
      // Refuse editing while an existing edit is in progress
      throw serviceUnavailable();
    }
    this._pendingCommitPromises.set(
      key,
      this._setValueForKeyImpl(key, value, parentCommit).finally(() => {
        this._pendingCommitPromises.delete(key);
      }),
    );
    return this._pendingCommitPromises.get(key);
  }

  private async _setValueForKeyImpl<S extends Schema>(
    key: string,
    value: Item<S>,
    parentCommit: string | Commit | undefined,
  ): Promise<Commit | undefined> {
    // All keys start with null records implicitly, so need need to persist
    // them. Also, we forbid downgrading a record back to null once initialized.
    if (value.isNull) {
      return undefined;
    }
    assert(
      !this.allowedNamespaces ||
        this.allowedNamespaces.includes(value.schema.ns!),
    );
    const latest = this.valueForKey(key);
    if (latest && latest[0].isEqual(value as unknown as Item)) {
      return undefined;
    }
    const session = this.trustPool.currentSession;
    if (typeof parentCommit === 'string') {
      if (!this.hasCommit(parentCommit)) {
        throw serviceUnavailable();
      }
      parentCommit = this.getCommit(parentCommit);
    }
    if (!parentCommit && latest) {
      parentCommit = latest[1];
    }
    if (parentCommit) {
      const headRecord = this.itemForCommit(parentCommit);
      if (headRecord.isEqual(value as unknown as Item)) {
        return undefined;
      }
    }
    const [ancestorsFilter, ancestorsCount] = this.ancestorsFilterForKey(key);
    let commit = new Commit({
      session: session.id,
      key,
      contents: value.clone() as unknown as Item,
      parents: parentCommit?.id,
      ancestorsFilter,
      ancestorsCount,
      orgId: this.orgId,
    });
    commit = this.deltaCompressIfNeeded(commit);
    const signedCommit = this.db.trusted
      ? commit
      : await signCommit(session, commit);
    await this.persistVerifiedCommits([signedCommit]);
    this.invalidateCachesForKey(key);
    return (await this.mergeIfNeeded(key)) || signedCommit;
  }

  async create<S extends Schema>(key: string, value: Item<S>): Promise<Commit> {
    return (await this.setValueForKey(key, value, undefined))!;
  }

  /**
   * Given a key and an edited record for this key, this method rebases the
   * changes from the record on top of the any changes made concurrently for
   * this key. Use it to merge remote changes with any local edits before
   * committing them.
   *
   * @param key The key to rebase.
   * @param record The locally edited record.
   * @param headId The commit from which the edited record was derived from.
   *
   * @returns A new record with local changes rebased on top of remote changes.
   *          This record can be used to safely update the UI, as well as update
   *          the repo value.
   */
  rebase<S extends Schema>(
    key: string,
    record: Item<S>,
    headId: string | Commit | undefined,
  ): [Item<S>, string | undefined] {
    const currentHead = this.headForKey(key);
    if (!currentHead || currentHead.id === headId) {
      return [record, headId instanceof Commit ? headId.id : undefined];
    }
    const headRecord = this.itemForCommit<S>(currentHead);
    if (headRecord.isEqual(record)) {
      return [record, headId instanceof Commit ? headId.id : undefined];
    }
    const baseRecord = (
      headId
        ? this.itemForCommit<S>(headId)
        : (Item.nullItem(this.db.registry) as Item<S>)
    ).clone();
    if (
      !headRecord.isNull &&
      !SchemaEquals(baseRecord.schema, headRecord.schema)
    ) {
      baseRecord.upgradeSchema(headRecord.schema);
    }
    if (!record.isNull && !SchemaEquals(baseRecord.schema, record.schema)) {
      baseRecord.upgradeSchema(record.schema);
    }
    const changes = concatChanges(
      baseRecord.diff(headRecord, false),
      baseRecord.diff(record, true),
    );
    baseRecord.patch(changes);
    return [baseRecord, currentHead.id];
  }

  private deltaCompressIfNeeded(fullCommit: Commit): Commit {
    assert(commitContentsIsDocument(fullCommit.contents));
    if (
      // Periodically create a full commit to prevent all parties from being stuck
      // to a specific commit.
      randomInt(0, 20) === 0 ||
      // Sessions are too important to apply delta compression to, since they
      // bootstrap everything else.
      fullCommit.scheme?.ns === kSchemaSession.ns
    ) {
      return fullCommit;
    }
    const key = fullCommit.key;
    const lastRecordCommit = this.lastRecordCommitForKey(key);
    let deltaCommit: Commit | undefined;
    if (lastRecordCommit) {
      const baseRecord = this.itemForCommit(lastRecordCommit);
      const changes = baseRecord.diff(fullCommit.contents.record, false);
      const edit = new Edit({
        changes: changes,
        srcChecksum: baseRecord.checksum,
        dstChecksum: fullCommit.contentsChecksum,
      });
      const deltaLength = JSON.stringify(edit.toJS()).length;
      const fullLength = JSON.stringify(
        fullCommit.contents.record.toJS(),
      ).length;
      // Only if our delta format is small enough relative to the full format,
      // then it's worth switching to it
      if (deltaLength <= fullLength * 0.85) {
        deltaCommit = new Commit({
          id: fullCommit.id,
          session: fullCommit.session,
          key,
          contents: { base: lastRecordCommit.id, edit },
          parents: fullCommit.parents,
          ancestorsFilter: fullCommit.ancestorsFilter,
          ancestorsCount: fullCommit.ancestorsCount,
          mergeBase: fullCommit.mergeBase,
          mergeLeader: fullCommit.mergeLeader,
          revert: fullCommit.revert,
          orgId: this.orgId,
        });
        // log({
        //   severity: 'METRIC',
        //   name: 'DeltaFormatSavings',
        //   value: Math.round((100 * (fullLength - deltaLength)) / fullLength),
        //   unit: 'Percent',
        // });
      }
    }
    return deltaCommit || fullCommit;
  }

  private lastRecordCommitForKey(key: string): Commit | undefined {
    let result: Commit | undefined;
    for (const c of this.commitsForKey(key)) {
      if (!commitContentsIsDocument(c.contents)) {
        continue;
      }
      if (!result || c.timestamp > result.timestamp) {
        result = c;
      }
    }
    return result;
  }

  hasKey(key: string): boolean {
    return this.keyExists(key);
  }

  async verifyCommits(commits: Iterable<Commit>): Promise<Commit[]> {
    if (this.db.trusted) {
      return Array.from(commits);
    }
    const authorizer = this.authorizer;
    commits = Array.from(commits).sort((c1, c2) => c1.timestamp - c2.timestamp);
    const result: Commit[] = [];
    for (
      const batch of ArrayUtils.slices(
        commits,
        navigator.hardwareConcurrency,
      )
    ) {
      const promises: Promise<void>[] = [];
      for (const c of batch) {
        promises.push(
          (async () => {
            if (await this.trustPool.verify(c)) {
              if (authorizer) {
                const session = this.trustPool.getSession(c.session);
                if (!session) {
                  return;
                }
                this._authInfo.itemKey = c.key;
                this._authInfo.session = session;
                this._authInfo.op = 'write';
                if (
                  session.owner === 'root' ||
                  authorizer(this._authInfo)
                ) {
                  result.push(c);
                } else {
                  // debugger;
                  // authorizer(this, c, session, true);
                }
              } else {
                result.push(c);
              }
            } else {
              // debugger;
              // this.trustPool.verify(c);
            }
          })(),
        );
      }
      await Promise.allSettled(promises);
    }
    return result;
  }

  private invalidateCachesForKey(key: string): void {
    this._cachedHeadsByKey.delete(key);
    this._cachedLeavesForKey.delete(key);
    this._cachedValueForKey.delete(key);
    this._cachedCommitsPerUser.clear();
  }

  async persistCommits(commits: Iterable<Commit>): Promise<Commit[]> {
    const batchSize = 50;
    const result: Commit[] = [];
    let batch: Commit[] = [];
    commits = filterIterable(
      commits,
      (c) =>
        this.storage.getCommit(c.id) === undefined &&
        typeof c.scheme?.ns !== null &&
        (this.allowedNamespaces === undefined ||
          c.scheme?.ns === undefined ||
          this.allowedNamespaces?.includes(c.scheme!.ns!)),
    );
    for (const verifiedCommit of await this.verifyCommits(commits)) {
      batch.push(verifiedCommit);
      if (batch.length >= batchSize) {
        ArrayUtils.append(result, await this.persistVerifiedCommits(batch));
        batch = [];
      }
    }
    if (batch.length > 0) {
      ArrayUtils.append(result, await this.persistVerifiedCommits(batch));
    }
    return result;
  }

  async persistVerifiedCommits(commits: Iterable<Commit>): Promise<Commit[]> {
    const adjList = this._adjList;
    const result: Commit[] = [];
    let batch: Commit[] = [];
    for (const c of commits) {
      if (c.orgId !== undefined && c.orgId !== this.orgId) {
        continue;
      }
      batch.push(c);
      if (batch.length >= 500) {
        for (
          const persisted of await this._persistCommitsBatchToStorage(
            batch,
          )
        ) {
          result.push(persisted);
        }
        for (const c of batch) {
          for (const p of c.parents) {
            adjList.addEdge(c.id, p, 'parent');
          }
        }
        batch = [];
      }
    }
    if (batch.length > 0) {
      for (const persisted of await this._persistCommitsBatchToStorage(batch)) {
        result.push(persisted);
      }
      for (const c of batch) {
        for (const p of c.parents) {
          adjList.addEdge(c.id, p, 'parent');
        }
      }
    }

    // const leaves = result.filter((c) => this.commitIsHighProbabilityLeaf(c));
    // for (const c of leaves) {
    //   this._cachedHeadsByKey.delete(c.key);
    // }

    // for (const c of SetUtils.unionIter(
    //   commitsAffectingTmpRecords,
    //   result.filter((c) => this.commitIsHighProbabilityLeaf(c)),
    // )) {
    for (const c of result) {
      if (!this._adjList.hasInEdges(c.id)) {
        await this._runUpdatesOnNewLeafCommit(c);
      }
    }
    // Notify everyone else
    for (const c of result) {
      this.emit('NewCommitSync', c);
    }
    if (this.priorityRepo || typeof Deno !== 'undefined') {
      // Do it synchronously in the server
      for (const c of result) {
        this.emit('NewCommit', c);
      }
    } else {
      // And asynchronously in the client
      CoroutineScheduler.sharedScheduler().forEach(
        result,
        (c) => this.emit('NewCommit', c),
        SchedulerPriority.Background,
      );
    }
    return result;
  }

  private async _runUpdatesOnNewLeafCommit(commit: Commit): Promise<void> {
    // Auto add newly discovered sessions to our trust pool
    if (commit.scheme?.ns === kSchemaSession.ns) {
      this._cachedHeadsByKey.delete(commit.key);
      const headEntry = this.valueForKey<SchemaTypeSession>(commit.key);
      if (!headEntry) {
        return;
      }
      await this.trustPool.addSession(
        await sessionFromItem(headEntry[0]),
        commit,
      );
    }
    this.invalidateCachesForKey(commit.key);
    this.emit('DocumentChanged', commit.key);
  }

  private async _persistCommitsBatchToStorage(
    batch: Iterable<Commit>,
  ): Promise<Commit[]> {
    const storage = this.storage;
    const result: Commit[] = [];
    for (const persistedCommit of await storage.persistCommits(batch)) {
      this.invalidateCachesForKey(persistedCommit.key);
      result.push(persistedCommit);
    }
    return result;
  }

  graphForKey(key: string): CommitGraph[] {
    const commits = Array.from(this.commitsForKey(key));
    const roots = commits.filter((c) => !c.parents || !c.parents.length);
    const result: CommitGraph[] = [];
    for (const r of roots) {
      result.push(this.subGraphForCommit(r.id));
    }
    return result;
  }

  private subGraphForCommit(id: string): CommitGraph {
    const adjList = this._adjList;
    const root = this.getCommit(id);
    const graph: CommitGraph = {
      commit: root,
      children: [],
    };
    for (const { vertex } of adjList.inEdges(root.id)) {
      graph.children.push(this.subGraphForCommit(vertex));
    }
    return graph;
  }

  debugNetworkForKey(key: string): ReadonlyJSONObject {
    const nodes: JSONObject[] = [];
    const edges: JSONObject[] = [];
    const knownCommits = new Set<string>();
    const localCommits = new Set<string>();
    for (const commit of this.commitsForKey(key)) {
      localCommits.add(commit.id);
      knownCommits.add(commit.id);
      nodes.push({
        data: {
          id: commit.id,
          name: `${commit.connectionId}-${
            new Date(
              commit.timestamp,
            ).toLocaleString()
          }`,
          session: commit.session,
          connectionId: commit.connectionId,
          ts: commit.timestamp,
          mergeBase: commit.mergeBase || null,
          mergeLeader: commit.mergeLeader || null,
          checksum: commit.contentsChecksum,
          revert: commit.revert,
        },
      });
      for (const p of commit.parents) {
        knownCommits.add(p);
        edges.push({
          data: {
            id: `${commit.id}-${p}`,
            source: commit.id,
            target: p,
          },
        });
      }
    }
    for (const id of knownCommits) {
      if (!localCommits.has(id)) {
        nodes.push({
          data: {
            id,
            name: `Missing-${id}`,
            session: 'Missing',
          },
        });
      }
    }

    return {
      elements: {
        nodes,
        edges,
      },
    };
  }

  downloadDebugNetworkForKey(key: string): void {
    downloadJSON(
      `${key}-${new Date().toISOString()}.json`,
      this.debugNetworkForKey(key),
    );
  }

  revertAllKeysToBefore(ts: number): void {
    for (const key of this.keys()) {
      const commits = Array.from(this.commitsForKey(key));
      for (let i = 0; i < commits.length; ++i) {
        const c = commits[i];
        if (c.timestamp <= ts) {
          if (i === 0) {
            break;
          }
          if (this.hasItemForCommit(c)) {
            console.log(
              `Reverting ${key} to ${new Date(c.timestamp).toLocaleString()}`,
            );
            this.setValueForKey(key, this.itemForCommit(c), undefined);
            break;
          }
        }
      }
    }
  }

  findLatestAncestorFromCommit(
    commit: Commit | string,
    filter: (c: Commit) => boolean,
  ): Commit | undefined {
    if (typeof commit === 'string') {
      if (!this.hasCommit(commit)) {
        return undefined;
      }
      commit = this.getCommit(commit);
    }
    for (const c of this.commitsForKey(commit.key)) {
      if (
        this.hasItemForCommit(c) &&
        c.timestamp < commit.timestamp &&
        filter(c)
      ) {
        return c;
      }
    }
    // let parentsToCheck: Set<string> = new Set(commit.parents);
    // while (parentsToCheck.size > 0) {
    //   let latestParent: undefined | Commit;
    //   const parents = parentsToCheck;
    //   parentsToCheck = new Set();
    //   for (const id of parents) {
    //     if (this.hasCommit(id)) {
    //       const c = this.getCommit(id);
    //       if (
    //         (!latestParent ||
    //           c.timestamp.getTime() > latestParent.timestamp.getTime()) &&
    //         filter(c)
    //       ) {
    //         latestParent = c;
    //       } else {
    //         SetUtils.update(parentsToCheck, c.parents);
    //       }
    //     }
    //   }
    //   if (latestParent !== undefined) {
    //     return latestParent;
    //   }
    // }
    return undefined;
  }

  revertHeadsByConnectionId(connectionIds: string | string[]): void {
    if (!(connectionIds instanceof Array)) {
      connectionIds = [connectionIds];
    }
    for (const key of this.keys()) {
      const head = this.headForKey(key);
      if (head && connectionIds.includes(head.connectionId)) {
        const parent = this.findLatestAncestorFromCommit(
          head,
          (c) => !connectionIds.includes(c.connectionId),
        );
        if (parent && this.hasItemForCommit(parent)) {
          console.log(
            `Reverting ${key} to ${parent.timestamp.toLocaleString()}`,
          );
          this.setValueForKey(key, this.itemForCommit(parent), undefined);
        }
      }
    }
  }
}

function compareCommitsDesc(c1: Commit, c2: Commit): number {
  if (c2.timestamp > c1.timestamp) {
    return 1;
  }
  if (c2.timestamp < c2.timestamp) {
    return -1;
  }
  return compareStrings(c2.id, c1.id);
}

function compareCommitsAsc(c1: Commit, c2: Commit): number {
  // Use the commit id as a consistent tie breaker when timestamps are equal
  const dt = c1.timestamp - c2.timestamp;
  return dt === 0 ? compareStrings(c1.id, c2.id) : dt;
}

function mergeLeaderFromLeaves(leaves: readonly Commit[]): string | undefined {
  const hash = new RendezvousHash<string>();
  const now = Date.now();
  for (const c of leaves) {
    if (Math.abs(now - c.timestamp) <= 5 * kSecondMs) {
      hash.addPeer(c.session);
    }
  }
  return hash.peerForKey(leaves[0].key);
}

export class MemRepoStorage implements RepoStorage<MemRepoStorage> {
  // Key -> Commit Id -> Commit
  private readonly _commitsByKey: Map<string, RedBlackTree<Commit>>;
  private readonly _commitsById: Map<string, Commit>;
  private readonly _cachedCommitsByKeyDescArr: Map<string, Commit[]>;
  readonly ageForKey: Record<string, number>;
  private _age = 0;
  private _cachedKeys?: string[];

  get age(): number {
    return this._age;
  }

  constructor(commits?: Iterable<Commit>) {
    this._commitsByKey = new Map();
    this._commitsById = new Map();
    this._cachedCommitsByKeyDescArr = new Map();
    // this.ageForKey = new Map();
    this.ageForKey = {};
    if (commits) {
      // for (const c of commits) {
      //   let keyMap = this._commitsByKey.get(c.key);
      //   if (!keyMap) {
      //     keyMap = new RedBlackTree(compareCommitsDesc);
      //     this._commitsByKey.set(c.key, keyMap);
      //   }
      //   keyMap.insert(c);
      //   this._commitsById.set(c.id, c);
      // }
      this.persistCommits(commits);
    }
  }

  numberOfCommits(): number {
    return this._commitsById.size;
  }

  numberOfKeys(): number {
    return this._commitsByKey.size;
  }

  getCommit(id: string): Commit | undefined {
    return this._commitsById.get(id);
  }

  allCommitsIds(): Iterable<string> {
    return this._commitsById.keys();
  }

  commitsForKeyDesc(key: string): Iterable<Commit> {
    // let res = this._cachedCommitsByKeyDescArr.get(key);
    // if (!res) {
    //   res = Array.from(this._commitsByKey.get(key) || []).sort(
    //     compareCommitsDesc,
    //   );
    //   this._cachedCommitsByKeyDescArr.set(key, res);
    // }
    // return res;
    return this._commitsByKey.get(key) || [];
    // const keyMap = this._commitsByRecordKey.get(key);
    // if (!keyMap) {
    //   return [];
    // }
    // return SetUtils.mapToArray(keyMap, (id) => this.getCommit(id));
  }

  allKeys(): Iterable<string> {
    if (!this._cachedKeys) {
      this._cachedKeys = Array.from(this._commitsByKey.keys());
    }
    return this._cachedKeys;
  }

  persistCommits(commits: Iterable<Commit>): Iterable<Commit> {
    const result: Commit[] = [];
    for (const c of commits) {
      const localCommit = this._commitsById.get(c.id);
      if (localCommit !== undefined) {
        // Sanity check: Both copies of the same commit must be equal.
        // TODO: Rather than crash, assume the other side may be malicious
        // assert(coreValueEquals(c, localCommit));
        continue;
      }
      this._commitsById.set(c.id, c);
      let set = this._commitsByKey.get(c.key);
      if (!set) {
        set = new RedBlackTree(compareCommitsDesc);
        this._commitsByKey.set(c.key, set);
        this._cachedKeys = undefined;
      }
      set.insert(c);
      this._cachedCommitsByKeyDescArr.delete(c.key);
      if (!c.age) {
        c.age = ++this._age;
      } else {
        assert(this._age < c.age);
        this._age = Math.max(this._age, c.age);
      }
      const ageForKey = this.ageForKey[c.key]; // this.ageForKey.get(c.key);
      if (!ageForKey || c.age > ageForKey) {
        // this.ageForKey.set(c.key, c.age);
        this.ageForKey[c.key] = c.age;
      }
      result.push(c);
    }
    return result;
  }

  // ageForKey(key: string): number {
  //   return this.ageForKey.get(key) || 0;
  // }

  close(): void {}
}

const gFirstSeenCommit = new Map<string, number>();
function commitInGracePeriod(c: Commit): boolean {
  let firstSeen = gFirstSeenCommit.get(c.id);
  if (!firstSeen) {
    firstSeen = Date.now();
    gFirstSeenCommit.set(c.id, firstSeen);
  }
  return Date.now() - firstSeen > 3 * kSecondMs;
}
