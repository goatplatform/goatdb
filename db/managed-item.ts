import type { Schema, SchemaDataType } from '../cfds/base/schema.ts';
import type { Commit } from '../repo/commit.ts';
import type { Repository } from '../repo/repo.ts';
import { itemPathGetPart, itemPathGetRepoId, itemPathIsValid } from './path.ts';
import { Item } from '../cfds/base/item.ts';
import { Emitter } from '../base/emitter.ts';
import { type MutationPack, mutationPackAppend } from './mutations.ts';
import { SimpleTimer, type Timer } from '../base/timer.ts';
import type { GoatDB } from './db.ts';
import { assert } from '../base/error.ts';

/**
 * A high-level interface for reading, writing, and synchronizing a single item
 * in GoatDB. Manages the item's state, schema validation, and version history.
 *
 * @template S The schema type for this item
 * @template US User schema type for the database
 */
export class ManagedItem<S extends Schema = Schema, US extends Schema = Schema>
  extends Emitter<'change' | 'LoadingFinished'> {
  private readonly _commitDelayTimer: Timer;
  private _head?: Commit;
  private _item!: Item<S>;
  private _commitPromise?: Promise<void>;
  private _detachHandler?: () => void;
  private _age: number = 0;
  private _commitInProgress: boolean = false;
  private _ready: boolean = false;
  private _readyPromiseResolve?: () => void;
  private _readyPromise?: Promise<void>;

  constructor(readonly db: GoatDB<US>, readonly path: string) {
    super();
    assert(itemPathIsValid(path), `Invalid item path: ${path}`);
    this.path = path;
    this._commitDelayTimer = new SimpleTimer(300, false, () => {
      this.commit();
    });
    this._readyPromise = new Promise<void>((resolve) => {
      this._readyPromiseResolve = resolve;
    });
    const repo = db.repository(itemPathGetRepoId(path));
    this._item = Item.nullItem(db.registry);
    if (!repo) {
      this.loadRepoAndDoc();
    } else {
      this.loadInitialDoc(repo);
    }
  }

  /**
   * Returns the key of this item within its repository.
   */
  get key(): string {
    return itemPathGetPart(this.path, 'item')!;
  }

  /**
   * Returns whether this managed item is ready to use.
   * An item is ready when its initial loading from the repository is complete.
   */
  get ready(): boolean {
    return this._ready;
  }

  /**
   * Returns a promise that resolves when this managed item is ready to use.
   * If the item is already ready, the promise resolves immediately.
   */
  readyPromise(): Promise<void> {
    return this._readyPromise!;
  }

  /**
   * Returns the repository that manages this item.
   */
  get repository(): Repository | undefined {
    return this.db.repository(itemPathGetRepoId(this.path));
  }

  /**
   * Returns the current schema of this item.
   */
  get schema(): S {
    return this._item.schema;
  }

  /**
   * Updates the schema for this item. Changing an item's schema is allowed
   * under the following limitations:
   *
   * - A null item can have its schema changed to any other schema.
   *
   * - An item with a non-null schema, may only have its schema upgraded, that
   *   is the provided schema must have the same namespace and its version must
   *   be greater than the current schema's version.
   *
   * Explicitly setting the schema is usually done only when creating a new
   * item.
   */
  set schema(s: S) {
    if (this._item.isLocked) {
      this._item = this._item.clone();
    }
    if (this._item.upgradeSchema(s)) {
      this.onChange(['__schema', true, null]);
      this._commitDelayTimer.schedule();
    }
  }

  /**
   * Returns whether this item exists in the repository.
   * An item exists if it has a non-null schema namespace.
   * Items with a null schema cannot be persisted and act as temporary
   * in-memory representations before being properly created with a schema.
   */
  get exists(): boolean {
    return this.schema.ns !== null;
  }

  /**
   * Returns whether this item has been deleted and is waiting to be garbage
   * collected at a later time.
   */
  get isDeleted(): boolean {
    return this._item.isDeleted;
  }

  /**
   * Sets this item's delete marker. Used to delete/un-delete an item.
   */
  set isDeleted(flag: boolean) {
    const oldValue = this.isDeleted;
    if (oldValue !== flag) {
      this._item.isDeleted = flag;
      this.onChange(['isDeleted', true, oldValue]);
    }
  }

  /**
   * Returns the age of this item, which is a monotonically increasing number
   * that reflects the order in which commits were received locally. Age numbers
   * are local to each peer and are never synchronized across the network.
   *
   * @returns The local age number of this item
   */
  get age(): number {
    return this._age;
  }

  /**
   * Checks if this item has a value for the given key.
   *
   * @param key The key to check for
   * @returns True if the item has a value for the key, false otherwise
   */
  has<T extends keyof SchemaDataType<S>>(key: string & T): boolean {
    return this._item.has(key);
  }

  /**
   * Gets the value for the given key from this item.
   *
   * @param key The key to get the value for
   * @returns The value associated with the key
   */
  get<K extends keyof SchemaDataType<S>>(
    key: K & string,
  ): SchemaDataType<S>[K] {
    return this._item.get(key);
  }

  /**
   * Sets the value for the given key in this item.
   *
   * @param key The key to set the value for
   * @param value The value to associate with the key
   */
  set<T extends keyof SchemaDataType<S>>(
    key: string & T,
    value: SchemaDataType<S>[T],
  ): void {
    const oldValue = this.has(key) ? this.get(key) : undefined;
    this._item.set(key, value);
    this.onChange([key, true, oldValue]);
  }

  /**
   * A convenience method for setting several fields and values at once.
   * @param data The values to set.
   */
  setMulti(data: Partial<SchemaDataType<S>>): void {
    for (const [key, value] of Object.entries(data)) {
      this.set(key, value!);
    }
  }

  /**
   * Deletes a key-value pair from this item. If the field has a default value
   * defined in the schema, the field will be set to that default value instead
   * of being deleted.
   *
   * @param key The key to delete
   * @returns True if the key was deleted or reset to its default value, false
   * if it didn't exist
   */
  delete<T extends keyof SchemaDataType<S>>(key: string & T): boolean {
    const oldValue = this.has(key) ? this.get(key) : undefined;
    if (this._item.delete(key)) {
      this.onChange([key, true, oldValue]);
      return true;
    }
    return false;
  }

  /**
   * Commits the current state of this item to the database.
   *
   * This method:
   * 1. Normalizes and validates the item
   * 2. In debug mode, asserts that the item is valid
   * 3. In non-debug mode, silently returns if the item is invalid
   * 4. Cancels any pending delayed commits
   * 5. If a commit is already in progress, waits for it to complete before retrying
   * 6. Executes the commit
   *
   * @returns A promise that resolves when the commit is complete
   */
  commit(): Promise<void> {
    this._item.normalize();
    const [valid, error] = this._item.validate();
    if (this.db.debug) {
      assert(
        valid,
        `Attempting to commit an invalid item at ${this.path}: ${error}`,
      );
    } else {
      if (!valid) {
        return Promise.resolve();
      }
    }
    // Always flush any scheduled commit and run now
    this._commitDelayTimer.unschedule();
    if (this._commitPromise) {
      // Wait for the existing commit to finish, then try again if needed
      return this._commitPromise.then(() => this.commit());
    }
    const p = this._commitImpl().finally(() => {
      if (this._commitPromise === p) {
        this._commitPromise = undefined;
      }
    });
    this._commitPromise = p;
    return p;
  }

  /**
   * Synchronizes the local item state with the latest version from the
   * repository.
   *
   * Similar to git rebase, this merges any remote changes into the local
   * in-memory state.
   */
  rebase(): void {
    const repo = this.repository;
    if (!repo) {
      return;
    }
    const [doc, head] = repo.rebase(
      itemPathGetPart(this.path, 'item')!,
      this._item,
      this._head,
    );
    const changedFields = this._item.diffKeys(doc, true);
    if (changedFields.length > 0) {
      let mutations: MutationPack;
      for (const f of changedFields) {
        mutations = mutationPackAppend(mutations, [
          f,
          false,
          this._item.get(f),
        ]);
      }
      this._item = doc;
      if (head) {
        this._head = repo.getCommit(head);
      }
      this.onChange(mutations);
    }
  }

  /**
   * Downloads a debug graph visualization of the item's network state.
   * The downloaded file is in a format compatible with Cytoscape, a network
   * visualization and analysis tool.
   */
  downloadDebugGraph(): void {
    const key = itemPathGetPart(this.path, 'item')!;
    this.repository?.downloadDebugNetworkForKey(key);
  }

  /**
   * @internal
   * Activates the managed item by attaching a document change listener to the
   * repository. When the document changes, it will trigger a rebase of the item
   * to sync with the latest version. This method is idempotent - calling it
   * multiple times will only attach one listener.
   *
   * Note: This is an internal method used by GoatDB and should not be called
   * directly by users.
   */
  activate(): void {
    const repo = this.repository;
    if (!this._detachHandler && repo) {
      this._detachHandler = repo.attach('DocumentChanged', (key: string) => {
        if (itemPathGetPart(this.path, 'item') === key) {
          this.rebase();
        }
      });
    }
  }

  /**
   * @internal
   * Deactivates the managed item by removing the document change listener and
   * canceling any pending commits. This method is idempotent - calling it
   * multiple times has no additional effect.
   *
   * Note: This is an internal method used by GoatDB and should not be called
   * directly by users.
   */
  deactivate(): void {
    if (this._detachHandler) {
      this._detachHandler();
      this._detachHandler = undefined;
    }
    this._commitDelayTimer.unschedule();
  }

  /**
   * Handles changes to the managed item by incrementing its age, emitting a
   * change event, and scheduling a commit.
   *
   * @param mutations The mutations that triggered this change
   */
  private onChange(
    mutations: MutationPack<keyof SchemaDataType<S> & string>,
  ): void {
    ++this._age;
    this.emit('change', mutations);
    this._commitDelayTimer.schedule();
  }

  private async _commitImpl(): Promise<void> {
    assert(!this._commitInProgress);
    this._commitInProgress = true;
    this._commitDelayTimer.unschedule();
    const currentDoc = this._item.clone();
    const key = itemPathGetPart(this.path, 'item')!;
    const repo = await this.db.open(itemPathGetRepoId(this.path));
    const newHead = await repo.setValueForKey(key, currentDoc, this._head);
    if (newHead) {
      this._head = newHead;
      this.rebase();
    }
    this._commitInProgress = false;
  }

  /**
   * Loads the repository and initializes the document by opening the repository
   * and passing it to loadInitialDoc.
   *
   * This is an internal method that handles the initial loading of the managed
   * item from the repository.
   */
  private async loadRepoAndDoc(): Promise<void> {
    this.loadInitialDoc(await this.db.open(itemPathGetRepoId(this.path)));
  }

  /**
   * Loads the initial item and schema from the repository. On creation, it also
   * kickstarts the initial commit process. This method must be called after
   * the repository had been fully loaded.
   *
   * @param repo The repository to load from.
   */
  private loadInitialDoc(repo: Repository): void {
    const entry = repo.valueForKey<S>(itemPathGetPart(this.path, 'item')!);

    if (this.schema.ns === null) {
      if (entry) {
        // If our contents are still null, replace them with the item and schema
        // from the repo.
        this._item = entry[0].clone();
        this._head = entry[1];
        // Auto upgrade the schema so the app is guaranteed to see the latest
        // version
        if (this._item.upgradeSchema()) {
          // Commit after schema upgrade
          this._commitDelayTimer.schedule();
        }
        // Generate mutations for all initial values
        let pack: MutationPack;
        for (const f of this._item.keys) {
          pack = mutationPackAppend(pack, [f as string, false, undefined]);
        }
        this.emit('change', pack);
      }
    } else {
      // Our schema is no longer null which means a creation event had
      // happened. Rebase it over the latest item from the repo, which also
      // schedules a commit.
      this.rebase();
    }

    // Mark as ready and notify waiters
    this._ready = true;
    this._readyPromiseResolve?.();
    this.emit('LoadingFinished');
  }
}
