import { OrderedMap } from './collections/orderedmap.ts';

/**
 * A Least Recently Used (LRU) cache implementation that automatically evicts
 * the least recently used items when the cache reaches its capacity.
 *
 * Uses OrderedMap internally to maintain access order and provide O(1) operations
 * for lookups, insertions, and deletions.
 *
 * @template K The type of keys in the cache
 * @template V The type of values in the cache
 */
export class LRUCache<K, V> {
  /** Ordered map that tracks both values and access order */
  private _map: OrderedMap<K, V>;
  /** Maximum number of items the cache can hold */
  private _maxSize: number;

  /**
   * Creates a new LRU cache with the specified maximum size.
   *
   * @param maxSize Maximum number of items the cache will hold before evicting
   */
  constructor(maxSize: number) {
    this._map = new OrderedMap();
    this._maxSize = maxSize;
  }

  /**
   * Retrieves a value from the cache by its key and marks it as recently used.
   *
   * @param key The key to look up
   * @returns The value associated with the key, or undefined if not found
   */
  get(key: K): V | undefined {
    this._map.moveToStart(key);
    return this._map.get(key);
  }

  /**
   * Checks if the cache contains a value for the given key.
   *
   * @param key The key to check for
   * @returns true if the key exists in the cache, false otherwise
   */
  has(key: K): boolean {
    if (this._map.has(key)) {
      this._map.moveToStart(key);
      return true;
    }
    return false;
  }

  /**
   * Adds or updates a key-value pair in the cache.
   * If adding the new item exceeds the cache capacity, the least recently used
   * item will be evicted.
   *
   * @param key The key to set
   * @param value The value to associate with the key
   */
  set(key: K, value: V): void {
    this._map.set(key, value);
    if (this._map.size > this._maxSize) {
      this._map.delete(this._map.startKey!);
    }
  }
}
