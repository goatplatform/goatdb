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

export class ManagedItem<S extends Schema = Schema, US extends Schema = Schema>
  extends Emitter<'change'> {
  private readonly _commitDelayTimer: Timer;
  private _head?: Commit;
  private _item!: Item<S>;
  private _commitPromise?: Promise<void>;
  private _detachHandler?: () => void;
  private _age: number = 0;
  private _commitInProgress: boolean = false;

  constructor(readonly db: GoatDB<US>, readonly path: string) {
    super();
    assert(itemPathIsValid(path), `Invalid item path: ${path}`);
    this.path = path;
    this._commitDelayTimer = new SimpleTimer(300, false, () => {
      this.commit();
    });
    const repo = db.repository(itemPathGetRepoId(path));
    this._item = Item.nullItem(db.schemaManager);
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

  get age(): number {
    return this._age;
  }

  has<T extends keyof SchemaDataType<S>>(key: string & T): boolean {
    return this._item.has(key);
  }

  get<K extends keyof SchemaDataType<S>>(
    key: K & string,
  ): SchemaDataType<S>[K] {
    return this._item.get(key);
  }

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

  delete<T extends keyof SchemaDataType<S>>(key: string & T): boolean {
    const oldValue = this.has(key) ? this.get(key) : undefined;
    if (this._item.delete(key)) {
      this.onChange([key, true, oldValue]);
      return true;
    }
    return false;
  }

  commit(): Promise<void> {
    this._item.normalize();
    if (!this._item.isValid) {
      return Promise.resolve();
    }
    if (!this._commitPromise) {
      const p = this._commitImpl().finally(() => {
        if (this._commitPromise === p) {
          this._commitPromise = undefined;
        }
      });
      this._commitPromise = p;
    }
    return this._commitPromise;
  }

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

  downloadDebugGraph(): void {
    const key = itemPathGetPart(this.path, 'item')!;
    this.repository?.downloadDebugNetworkForKey(key);
  }

  reset(): void {}

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

  deactivate(): void {
    if (this._detachHandler) {
      this._detachHandler();
      this._detachHandler = undefined;
    }
    this._commitDelayTimer.unschedule();
  }

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
  }
}
