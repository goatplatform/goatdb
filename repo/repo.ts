import { Emitter } from '../base/emitter.ts';
import { log } from '../logging/log.ts';
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
import { SimpleTimer } from '../base/timer.ts';
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
  commitContentsIsDelta,
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
import { itemPathIsValid, itemPathJoin } from '../db/path.ts';
import type {
  AuthOp,
  AuthRule,
  AuthRuleInfo,
} from '../cfds/base/data-registry.ts';

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

/** @group Database */
export class Repository<
  ST extends RepoStorage<ST> = MemRepoStorage,
> extends Emitter<RepositoryEvent> {
  readonly priorityRepo: boolean;
  readonly storage: ST;
  readonly trustPool: TrustPool;
  readonly allowedNamespaces: string[] | undefined;
  private readonly _cachedHeadsByKey: Map<string, CachedHead>;
  readonly authorizer?: AuthRule;
  private readonly _cachedRecordForCommit: Map<string, WeakRef<Item>>;
  private readonly _itemCleanup: FinalizationRegistry<string>;
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
  // Pool of pre-allocated AuthRuleInfo objects, one per hardware thread.
  // Sync callers use index 0 (single-threaded, no concurrency risk).
  // verifyCommits uses the batch-item index to give each concurrent promise
  // its own object — no per-call allocation on the hot path.
  private readonly _concurrency: number;
  private readonly _authInfoPool: AuthRuleInfo[];
  /** @internal One-shot idle close timer (scheduled only after open completes). */
  private _idleTimer: SimpleTimer | undefined;
  /**
   * @internal Close lifecycle state. Serializes Open -> Closing -> Closed so
   * that db.open() during a close awaits the in-flight close then reopens,
   * and so an idle timer cannot fire on a half-initialized repo.
   */
  _closeState: 'open' | 'closing' | 'closed' = 'open';
  /** @internal Active idle leases (e.g. in-flight item commits via acquireRepo). */
  _idleLeaseCount = 0;
  /** @internal Guards timer scheduling until _openImpl completes (no slow-open expiry). */
  private _idleReady = false;

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
    this._itemCleanup = new FinalizationRegistry((id: string) =>
      this._cachedRecordForCommit.delete(id)
    );
    this._adjList = new AdjacencyList();
    this._pendingCommitPromises = new Map();
    this._cachedCommitsPerUser = new Map();
    this._commitIsCorruptedResult = new Map();
    this.priorityRepo = priorityRepo === true;
    this._cachedCommitsWithRecord = new Set();
    this._cachedLeavesForKey = new Map();
    this._concurrency =
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
    this._authInfoPool = Array.from({ length: this._concurrency }, () => ({
      db: this.db,
      repoPath: this.path,
      itemKey: '',
      session: this.trustPool.currentSession,
      op: 'read' as AuthOp,
    }));
    // Create idle close timer if configured. The timer is NOT scheduled
    // here: db.open() arms it (_startIdleTimer) only after _openImpl has
    // fully loaded the repo, preventing a slow open from expiring itself.
    if (this.db.repoInactivityTimeoutMs > 0) {
      this._idleTimer = new SimpleTimer(
        this.db.repoInactivityTimeoutMs,
        false,
        () => this._onIdleTimeout(),
        'RepoIdle',
      );
    }
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

  /**
   * @internal Called by db.open() after the repo is fully loaded. Arms the idle
   * timer for the first time, so a slow open cannot immediately expire.
   */
  _startIdleTimer(): void {
    this._idleReady = true;
    this._touchIdle();
  }

  /**
   * Resets the idle close timer on activity. The timer only runs while the
   * repo is fully open, idle, and unpinned by leases or listeners.
   */
  _touchIdle(): void {
    if (!this._idleReady || !this._idleTimer) return;
    if (this._closeState !== 'open') {
      this._idleTimer.unschedule();
      return;
    }
    this._idleTimer.unschedule();
    if (
      this._idleLeaseCount === 0 &&
      this.listenerCount('DocumentChanged') === 0
    ) {
      this._idleTimer.schedule();
    }
  }

  /**
   * @internal Acquires an idle lease, pinning the repo open. Paired with
   * releaseIdleLease(); using a Disposable (db.acquireRepo) is preferred.
   */
  acquireIdleLease(): void {
    this._idleLeaseCount++;
    this._idleTimer?.unschedule();
  }

  /** @internal Releases a previously-acquired idle lease and re-arms the timer. */
  releaseIdleLease(): void {
    if (this._idleLeaseCount > 0) this._idleLeaseCount--;
    this._touchIdle();
  }

  /**
   * @internal A repo is idle-eligible when it is open, carries no in-flight
   * item work (leases), and no live DocumentChanged listeners (external users
   * or open queries via their source listener). Derived from the Emitter own
   * registrations so detachAll/missing-detach/dedup are always respected.
   */
  _isIdleEligible(): boolean {
    if (this._closeState !== 'open') return false;
    if (this._idleLeaseCount > 0) return false;
    if (this.listenerCount('DocumentChanged') > 0) return false;
    return true;
  }

  /** @internal Called by the idle timer to request close. */
  _onIdleTimeout(): void {
    if (!this._isIdleEligible()) return;
    // System repos are never auto-closed
    if (this.path.startsWith('/sys/') || this.path === '/sys') return;
    this.db._requestRepoIdleClose(this as any);
  }

  /** @internal Test-only: trigger idle close immediately. */
  async _testTriggerIdleTimeout(): Promise<void> {
    this._idleTimer?.unschedule();
    if (!this._isIdleEligible()) return;
    // System repos are never auto-closed
    if (this.path.startsWith('/sys/') || this.path === '/sys') return;
    await this.db._requestRepoIdleClose(this as any);
  }

  /**
   * Minimal overrides that keep the idle timer in sync with DocumentChanged
   * listeners derived from Emitter registrations (no parallel counter).
   * Other events pass through unchanged.
   */
  // deno-lint-ignore ban-types
  override attach<C extends Function, E extends string>(
    e: E,
    c: C,
  ): () => void {
    const unsub = super.attach(e as any, c as any);
    if (e === 'DocumentChanged') {
      this._idleTimer?.unschedule();
    }
    return unsub;
  }
  // deno-lint-ignore ban-types
  override detach<C extends Function, E extends string>(e: E, c: C): void {
    super.detach(e as any, c as any);
    if (e === 'DocumentChanged') {
      this._touchIdle();
    }
  }

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
    this._touchIdle();
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
      this._authInfoPool[0].itemKey = c.key;
      this._authInfoPool[0].session = session;
      this._authInfoPool[0].op = 'read';
      if (!authorizer(this._authInfoPool[0])) {
        throw serviceUnavailable();
      }
    }
    return c;
  }

  hasCommit(id: string): boolean {
    return this.storage.getCommit(id) !== undefined;
  }

  // SECURITY: Read authorization filter. Gates ALL data access for
  // untrusted sessions. Tests: security-boundaries.test.ts
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
              this._authInfoPool[0].itemKey = this.getCommit(id).key;
              this._authInfoPool[0].session = session;
              this._authInfoPool[0].op = 'read';
              return authorizer(this._authInfoPool[0]);
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
        this._authInfoPool[0].itemKey = c.key;
        this._authInfoPool[0].session = session ||
          this.trustPool.currentSession;
        this._authInfoPool[0].op = 'read';
        if (authorizer(this._authInfoPool[0])) {
          yield c;
        }
      }
    }
  }

  keyExists(key: string): boolean {
    this._touchIdle();
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
   * Returns true if the given commit is a leaf in the commit graph, meaning no
   * other commit references it — either as a direct `parent` or as an explicit
   * `ancestor` — i.e. it has no in-edges of any kind in the adjacency list.
   *
   * Note: `persistVerifiedCommits` registers both `parent` and `ancestor` edges,
   * so a commit that appears only in another commit's `ancestors` array is also
   * not a leaf. This prevents a merge from re-including commits that are already
   * transitively covered by a descendant.
   *
   * @param candidate The commit to inspect.
   * @returns true if the commit is a leaf and can be safely included in a merge
   *          commit, false otherwise.
   */
  commitIsLeaf(candidate: Commit | string): boolean {
    const id = typeof candidate === 'string' ? candidate : candidate.id;
    // Only graph-structural edges ('parent', 'ancestor') determine leaf status.
    // Other logical edge types must not suppress leaf detection.
    return !this._adjList.hasInEdges(id, 'parent') &&
      !this._adjList.hasInEdges(id, 'ancestor');
  }

  leavesForKey(key: string): readonly Commit[] {
    let leaves = this._cachedLeavesForKey.get(key);
    if (!leaves) {
      leaves = [];
      for (const c of this.commitsForKey(key)) {
        if (this.commitIsLeaf(c) && this.hasItemForCommit(c)) {
          leaves.push(c);
        }
      }
      Object.freeze(leaves);
      this._cachedLeavesForKey.set(key, leaves);
    }
    return leaves;
  }

  keys(session?: Session): Iterable<string> {
    this._touchIdle();
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
          this._authInfoPool[0].itemKey = key;
          this._authInfoPool[0].session = session;
          this._authInfoPool[0].op = 'read';
          return authorizer(this._authInfoPool[0]);
        },
      );
    }
    return this.storage.allKeys();
  }

  paths(session?: Session): Iterable<string> {
    this._touchIdle();
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
   * @returns A tuple of 4 values:
   *          1. The commits to include in the merge. Commits with broken
   *             ancestry path or deferred merges are excluded.
   *
   *          2. The base commit (LCA) to use for the merge, or undefined if
   *             one can't be found.
   *
   *          3. The scheme to use for the merge.
   *
   *          4. Whether a root commit was encountered during traversal.
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
      const [newBase, foundRoot, defer] = this._findLCAMergeBase(result, c);
      reachedRoot = reachedRoot || foundRoot;
      if (defer || !newBase) {
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
    return [includedCommits, result, scheme, reachedRoot];
  }

  /**
   * Given two commits, this method finds the base from which to perform a 3 way
   * merge for c1 and c2. This is a simple iterative LCA implementation based on
   * the assumption of a DAG (if it's not, something is terribly broken).
   *
   * The BFS expands through both `commit.parents` and `commit.ancestors`,
   * tracking depth to rank candidates. When the closest LCA candidate exists
   * in the intersection but is missing from the local graph, the method
   * signals defer (third return value) rather than falling back to a farther
   * ancestor that would produce a wider, destructive diff.
   *
   * @param c1 First commit.
   * @param c2 Second commit.
   *
   * @returns A tuple [base, reachedRoot, deferMerge]:
   *          - base: the LCA commit, or undefined if none found
   *          - reachedRoot: true if a root commit was encountered
   *          - deferMerge: true if a closer candidate exists but is missing
   */
  private _findLCAMergeBase(
    c1: Commit,
    c2: Commit,
  ): [Commit | undefined, boolean, boolean] {
    if (!c1.parents.length || !c2.parents.length) {
      return [undefined, true, false];
    }
    if (c1.key !== c2.key) {
      return [undefined, false, false];
    }
    if (c1.parents.includes(c2.id)) {
      return [c2, false, false];
    }
    if (c2.parents.includes(c1.id)) {
      return [c1, false, false];
    }

    const depths1 = new Map<string, number>();
    const depths2 = new Map<string, number>();
    for (const p of c1.parents) depths1.set(p, 1);
    for (const p of c2.parents) depths2.set(p, 1);
    // Ancestors skip intermediate commits, so depth +2 approximates real
    // graph distance (see computeAncestors — 2 hops: grandparents + greats).
    for (const a of c1.ancestors) setMinDepth(depths1, a, 2);
    for (const a of c2.ancestors) setMinDepth(depths2, a, 2);

    let reachedRoot = false;
    while (true) {
      let updated = false;
      let len1 = 0;
      for (const k of depths1.keys()) _scratchKeys1[len1++] = k;
      for (let i = 0; i < len1; i++) {
        const parentId = _scratchKeys1[i];
        if (this.hasCommit(parentId)) {
          const parent = this.getCommit(parentId);
          if (parent.parents.length === 0) {
            reachedRoot = true;
            continue;
          }
          const d = depths1.get(parentId)!;
          for (const p of parent.parents) {
            if (setMinDepth(depths1, p, d + 1)) updated = true;
          }
          for (const a of parent.ancestors) {
            if (setMinDepth(depths1, a, d + 2)) updated = true;
          }
        }
      }
      let len2 = 0;
      for (const k of depths2.keys()) _scratchKeys2[len2++] = k;
      for (let i = 0; i < len2; i++) {
        const parentId = _scratchKeys2[i];
        if (this.hasCommit(parentId)) {
          const parent = this.getCommit(parentId);
          if (parent.parents.length === 0) {
            reachedRoot = true;
            continue;
          }
          const d = depths2.get(parentId)!;
          for (const p of parent.parents) {
            if (setMinDepth(depths2, p, d + 1)) updated = true;
          }
          for (const a of parent.ancestors) {
            if (setMinDepth(depths2, a, d + 2)) updated = true;
          }
        }
      }
      if (!updated) {
        break;
      }
    }
    // Release retained string references from scratch arrays
    _scratchKeys1.length = 0;
    _scratchKeys2.length = 0;

    // Single-pass intersection: find closest available candidate
    let minTotalDepth = Infinity;
    let bestCommit: Commit | undefined;
    let hasCandidate = false;
    for (const [id, d1] of depths1) {
      const d2 = depths2.get(id);
      if (d2 === undefined) continue;
      const total = d1 + d2;
      if (total > minTotalDepth) continue;
      hasCandidate = true;
      if (!this.hasCommit(id) || !this.hasItemForCommit(this.getCommit(id))) {
        if (total < minTotalDepth) {
          // New closer depth but candidate unavailable — reset best
          minTotalDepth = total;
          bestCommit = undefined;
        }
        continue;
      }
      const c = this.getCommit(id);
      if (total < minTotalDepth) {
        minTotalDepth = total;
        bestCommit = c;
      } else if (bestCommit !== undefined) {
        // Same depth — tiebreak: newest timestamp, then highest id
        if (
          c.timestamp > bestCommit.timestamp ||
          (c.timestamp === bestCommit.timestamp &&
            compareStrings(c.id, bestCommit.id) > 0)
        ) {
          bestCommit = c;
        }
      } else {
        bestCommit = c;
      }
    }

    if (!hasCandidate) {
      return [undefined, reachedRoot, false];
    }
    if (bestCommit !== undefined) {
      return [bestCommit, reachedRoot, false];
    }
    // Closest candidates exist but all are missing — defer merge
    return [undefined, reachedRoot, true];
  }

  hasItemForCommit(c: Commit | string): boolean {
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
      if (c.isDocumentCommit) {
        this._cachedCommitsWithRecord.add(c.id);
        return true;
      }
      // For delta commits, follow the base chain
      const baseId = c.deltaBaseId;
      if (baseId !== undefined) {
        c = baseId;
      } else {
        return false;
      }
    }
    return false;
  }

  commitIsCorrupted(c: Commit): boolean {
    if (c.isDocumentCommit) {
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

  itemForCommit<S extends Schema>(c: Commit | string): Item<S> {
    let result = this._cachedRecordForCommit.get(
      typeof c === 'string' ? c : c.id,
    )?.deref();
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
          const lastGoodCommit = this.findLatestNonCorruptedCommitForKey(
            c.key,
          );
          // No good parents are available. This key is effectively null.
          result = lastGoodCommit
            ? this.itemForCommit(lastGoodCommit)
            : Item.nullItem(this.db.registry);
        }
      }
      result!.lock();
      this._cachedRecordForCommit.set(c.id, new WeakRef(result!));
      this._itemCleanup.register(result!, c.id);
    }
    return result! as unknown as Item<S>;
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
      return head;
    }
    if (!this.hasItemForCommit(head)) {
      return undefined;
    }
    this._cachedHeadsByKey.set(key, {
      commit: head,
      timestamp: 0,
    });
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
    this._touchIdle();
    const cacheEntry = this._cachedHeadsByKey.get(key);
    if (
      cacheEntry &&
      cacheEntry.commit.connectionId === CONNECTION_ID
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
    mergeLeader?: string,
    revert?: string,
    deltaCompress = true,
  ): Promise<Commit | undefined> {
    if (commitsToMerge.length <= 0) {
      return Promise.resolve(undefined);
    }
    const key = commitsToMerge[0].key;
    let result = this._pendingCommitPromises.get(key);
    if (!result) {
      result = this._createMergeCommitImpl(
        commitsToMerge,
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

  // FORMAT INVARIANT: 2 hops (grandparents + great-grandparents).
  // Together with parents stored on the commit itself this gives 3 levels of
  // ancestry -- enough for fast common-ancestor detection without traversing
  // the full graph. The binary format uses a u8 for ancestor count (max 255).
  // Changing the hop depth is a format-level decision that requires a version
  // bump in the binary codec.
  private computeAncestors(commits: Commit[]): string[] {
    // Build a local lookup from the live commit objects so we can resolve
    // parents that haven't been persisted yet (e.g. newly created commits).
    const localMap = new Map<string, Commit>(commits.map((c) => [c.id, c]));
    const getCommit = (id: string): Commit | undefined =>
      localMap.get(id) ?? (this.hasCommit(id) ? this.getCommit(id) : undefined);

    const parentIds = commits.map((c) => c.id);
    const parentSet = new Set(parentIds);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const pid of parentIds) {
      const parent = getCommit(pid);
      if (!parent) continue;
      // Hop 1: grandparents
      for (const gpId of parent.parents) {
        const gp = getCommit(gpId);
        if (!gp || parentSet.has(gpId) || seen.has(gpId)) {
          continue;
        }
        seen.add(gpId);
        result.push(gpId);
        if (result.length >= 255) {
          log({
            severity: 'WARNING',
            error: 'StorageError',
            message:
              `computeAncestors: truncated to 255 (binary format u8 limit); ` +
              `repo=${this.path}`,
          });
          return result;
        }
        // Hop 2: great-grandparents
        for (const ggpId of gp.parents) {
          if (!getCommit(ggpId) || parentSet.has(ggpId) || seen.has(ggpId)) {
            continue;
          }
          seen.add(ggpId);
          result.push(ggpId);
          if (result.length >= 255) {
            log({
              severity: 'WARNING',
              error: 'StorageError',
              message:
                `computeAncestors: truncated to 255 (binary format u8 limit); ` +
                `repo=${this.path}`,
            });
            return result;
          }
        }
      }
    }
    return result;
  }

  private async _createMergeCommitImpl(
    commitsToMerge: Commit[],
    mergeLeader?: string,
    revert?: string,
    deltaCompress = true,
  ): Promise<Commit | undefined> {
    if (commitsToMerge.length <= 0) {
      return undefined;
    }
    const key = commitsToMerge[0].key;
    const session = this.trustPool.currentSession.id;
    const ancestors = this.computeAncestors(commitsToMerge);
    try {
      const [merge, base] = this.createMergeRecord(commitsToMerge);
      if (merge.isNull) {
        return undefined;
      }
      let mergeCommit: Commit = Commit.create({
        session,
        key,
        contents: merge,
        parents: commitsToMerge.map((c) => c.id),
        ancestors,
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
      mergeLeaderSession === sessionId
    ) {
      // Filter out any commits with equal records
      const commitsToMerge = this.commitsWithUniqueItems(leaves).sort(
        coreValueCompare,
      );
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
    this._touchIdle();
    let result = this._cachedValueForKey.get(key);
    if (!this._cachedValueForKey.has(key)) {
      const head = this.headForKey(key);
      if (head) {
        result = [this.itemForCommit(head), head];
      }
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
    this._touchIdle();
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
    const ancestors = this.computeAncestors(
      parentCommit ? [parentCommit] : [],
    );
    let commit: Commit = Commit.create({
      session: session.id,
      key,
      // No clone needed - Commit constructor calls commitContentsClone() internally
      contents: value as unknown as Item,
      parents: parentCommit?.id,
      ancestors,
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
   * Bulk-insert new items into this repository. Items whose keys already exist
   * fall back to the per-item `setValueForKey` path; new keys are batched for
   * significantly lower overhead.
   */
  async insert(entries: { key: string; value: Item }[]): Promise<Commit[]> {
    this._touchIdle();
    const session = this.trustPool.currentSession;
    const newEntries: { key: string; value: Item }[] = [];
    const existingPromises: Promise<Commit | undefined>[] = [];

    for (const entry of entries) {
      if (this.valueForKey(entry.key)) {
        existingPromises.push(
          this.setValueForKey(entry.key, entry.value, undefined),
        );
      } else {
        newEntries.push(entry);
      }
    }

    // Build root commits for new keys — safe to skip ancestor computation
    // and delta compression because these are the first commit per key.
    const commits: Commit[] = [];
    for (const { key, value } of newEntries) {
      commits.push(
        Commit.create({
          session: session.id,
          key,
          contents: value,
          ancestors: [],
          orgId: this.orgId,
        }),
      );
    }

    // Sign sequentially (avoids 100k microtask scheduling from Promise.all)
    if (!this.db.trusted) {
      for (let i = 0; i < commits.length; i++) {
        commits[i] = await signCommit(session, commits[i]);
      }
    }

    // Persist in one batch
    if (commits.length > 0) {
      await this.persistVerifiedCommits(commits);
    }

    // Await fallback for existing keys
    const existingResults = await Promise.all(existingPromises);
    for (const c of existingResults) {
      if (c) commits.push(c);
    }

    return commits;
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
      fullCommit.schemaNamespace === kSchemaSession.ns
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
        scheme: fullCommit.scheme,
      });
      const deltaLength = JSON.stringify(edit.toJS()).length;
      const fullLength = JSON.stringify(
        fullCommit.contents.record.toJS(),
      ).length;
      // Only if our delta format is small enough relative to the full format,
      // then it's worth switching to it
      if (deltaLength <= fullLength * 0.85) {
        deltaCommit = Commit.create({
          id: fullCommit.id,
          session: fullCommit.session,
          key,
          contents: { base: lastRecordCommit.id, edit },
          parents: fullCommit.parents,
          ancestors: fullCommit.ancestors,
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
      if (!c.isDocumentCommit) {
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

  // SECURITY: Authorization gate for untrusted commits. The trusted check
  // below is the ONLY place where write authorization is enforced. Removing
  // it bypasses ALL auth rules. Tests: security-boundaries.test.ts
  async verifyCommits(commits: Iterable<Commit>): Promise<Commit[]> {
    if (this.db.trusted) {
      return Array.from(commits);
    }
    const authorizer = this.authorizer;
    commits = Array.from(commits).sort((c1, c2) => c1.timestamp - c2.timestamp);
    const result: Commit[] = [];
    for (const batch of ArrayUtils.slices(commits, this._concurrency)) {
      const promises: Promise<void>[] = [];
      for (let idx = 0; idx < batch.length; idx++) {
        const c = batch[idx];
        // Safe: ArrayUtils.slices() caps batch to _concurrency === pool length,
        // so idx < pool.length always holds and no two promises share an entry.
        const info = this._authInfoPool[idx % this._authInfoPool.length];
        promises.push(
          (async () => {
            if (await this.trustPool.verify(c)) {
              if (authorizer) {
                const session = this.trustPool.getSession(c.session);
                if (!session) {
                  return;
                }
                info.itemKey = c.key;
                info.session = session;
                info.op = 'write';
                if (
                  session.owner === 'root' ||
                  authorizer(info)
                ) {
                  result.push(c);
                }
              } else {
                result.push(c);
              }
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

  // SECURITY: Resolves the namespace for a commit, following the delta base
  // chain through both batch-local commits and storage. Returns undefined if
  // the chain is unresolvable. Tests: security-boundaries.test.ts
  private resolveCommitNs(
    c: Commit,
    batchIndex: Map<string, Commit>,
  ): string | null | undefined {
    if (c.schemaNamespace !== undefined) return c.schemaNamespace;
    const visited = new Set<string>();
    let cur: Commit | undefined = c;
    while (cur) {
      const baseId: string | undefined = cur.deltaBaseId;
      if (baseId === undefined) break;
      if (visited.has(cur.id)) return undefined;
      visited.add(cur.id);
      cur = batchIndex.get(baseId) ?? this.storage.getCommit(baseId);
    }
    if (cur && cur.isDocumentCommit) {
      const contents = cur.contents;
      if (commitContentsIsDocument(contents)) {
        return contents.record.schema.ns;
      }
    }
    return undefined;
  }

  async persistCommits(commits: Iterable<Commit>): Promise<Commit[]> {
    const batchSize = 50;
    const result: Commit[] = [];
    let batch: Commit[] = [];
    const all = Array.from(commits);
    const batchIndex = new Map<string, Commit>();
    for (const c of all) batchIndex.set(c.id, c);
    let filtered: Commit[];
    if (this.allowedNamespaces !== undefined) {
      filtered = all.filter((c) => {
        if (this.storage.getCommit(c.id) !== undefined) return false;
        const ns = this.resolveCommitNs(c, batchIndex);
        return ns !== null && ns !== undefined &&
          this.allowedNamespaces!.includes(ns);
      });
    } else {
      filtered = all.filter((c) => {
        if (this.storage.getCommit(c.id) !== undefined) return false;
        const ns = this.resolveCommitNs(c, batchIndex);
        return ns !== null && ns !== undefined;
      });
    }
    for (const verifiedCommit of await this.verifyCommits(filtered)) {
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
        const batchStart = result.length;
        for (
          const persisted of await this._persistCommitsBatchToStorage(
            batch,
          )
        ) {
          result.push(persisted);
        }
        for (let i = batchStart; i < result.length; i++) {
          const c = result[i];
          for (const p of c.parents) {
            adjList.addEdge(c.id, p, 'parent');
          }
          for (const a of c.ancestors) {
            adjList.addEdge(c.id, a, 'ancestor');
          }
        }
        batch = [];
      }
    }
    if (batch.length > 0) {
      const batchStart = result.length;
      for (const persisted of await this._persistCommitsBatchToStorage(batch)) {
        result.push(persisted);
      }
      for (let i = batchStart; i < result.length; i++) {
        const c = result[i];
        for (const p of c.parents) {
          adjList.addEdge(c.id, p, 'parent');
        }
        for (const a of c.ancestors) {
          adjList.addEdge(c.id, a, 'ancestor');
        }
      }
    }

    for (const c of result) {
      if (this.commitIsLeaf(c)) {
        await this._runUpdatesOnNewLeafCommit(c);
      }
    }
    // Notify everyone else
    for (const c of result) {
      this.emit('NewCommitSync', c);
    }
    if (this.priorityRepo || this.db.mode === 'server') {
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
    if (commit.schemaNamespace === kSchemaSession.ns) {
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

  private subGraphForCommit(
    id: string,
    visited = new Set<string>(),
  ): CommitGraph {
    visited.add(id);
    const adjList = this._adjList;
    const root = this.getCommit(id);
    const graph: CommitGraph = {
      commit: root,
      children: [],
    };
    for (const { vertex } of adjList.inEdges(root.id, 'parent')) {
      if (!visited.has(vertex)) {
        graph.children.push(this.subGraphForCommit(vertex, visited));
      }
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
          this.setValueForKey(key, this.itemForCommit(parent), undefined);
        }
      }
    }
  }
}

// Scratch arrays for BFS key snapshots — avoids Array.from() allocations.
// Cleared after each call to release references. Safe: _findLCAMergeBase is not reentrant.
const _scratchKeys1: string[] = [];
const _scratchKeys2: string[] = [];

function compareCommitsDesc(c1: Commit, c2: Commit): number {
  if (c2.timestamp > c1.timestamp) {
    return 1;
  }
  if (c2.timestamp < c1.timestamp) {
    return -1;
  }
  return compareStrings(c2.id, c1.id);
}

// Returns true when the map was modified: either first insertion or depth
// decreased. Returning true on depth refinement ensures the BFS re-expands
// children at the corrected (shorter) depth, yielding globally minimal depths.
function setMinDepth(
  map: Map<string, number>,
  id: string,
  depth: number,
): boolean {
  const existing = map.get(id);
  if (existing === undefined || depth < existing) {
    map.set(id, depth);
    return true;
  }
  return false;
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
  readonly ageForKey: Record<string, number>;
  private _age = 0;
  private _cachedKeys?: string[];

  get age(): number {
    return this._age;
  }

  constructor(commits?: Iterable<Commit>) {
    this._commitsByKey = new Map();
    this._commitsById = new Map();
    this.ageForKey = {};
    if (commits) {
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
    return (this._commitsByKey.get(key) ?? []) as Iterable<Commit>;
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
      if (c.age === undefined) {
        c.age = ++this._age;
      } else {
        // assert(this._age < c.age, `Age for ${c.key} is ${c.age} but current age is ${this._age}`);
        this._age = Math.max(this._age, c.age);
      }
      const ageForKey = this.ageForKey[c.key]; // this.ageForKey.get(c.key);
      if (ageForKey === undefined || c.age > ageForKey) {
        // this.ageForKey.set(c.key, c.age);
        this.ageForKey[c.key] = c.age;
      }
      result.push(c);
    }
    return result;
  }

  close(): void {}
}
