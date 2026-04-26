import { assert } from './error.ts';

/**
 * Stack-based object pool for zero-allocation reentrant hot paths.
 * Grows on first encounter of a new depth, keeps the high-water mark.
 *
 * Usage:
 *   const pool = new ScratchPool(() => new Float64Array(1));
 *   const buf = pool.rent();    // O(1), zero alloc after warm-up
 *   // ... use buf ...
 *   pool.release();             // O(1)
 */
export class ScratchPool<T> {
  private _items: T[];
  private _depth = 0;
  private readonly _factory: () => T;

  constructor(factory: () => T, initialCapacity = 1) {
    this._factory = factory;
    this._items = [];
    for (let i = 0; i < initialCapacity; i++) {
      this._items.push(factory());
    }
  }

  rent(): T {
    if (this._depth >= this._items.length) {
      this._items.push(this._factory());
    }
    return this._items[this._depth++];
  }

  release(): void {
    assert(
      this._depth > 0,
      'ScratchPool: release() called more times than rent()',
    );
    --this._depth;
  }
}
