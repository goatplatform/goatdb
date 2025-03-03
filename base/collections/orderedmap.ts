import type { Dictionary } from './dict.ts';
import { assert } from '../error.ts';

/**
 * Error thrown when an OrderedMap is modified during iteration.
 * This helps prevent potential bugs from concurrent modifications that could
 * lead to undefined behavior or incorrect results.
 */
export class MutationError extends Error {
  constructor() {
    super('OrderedMap mutated during iteration');
  }
}

/**
 * Internal state for OrderedMap that maintains the mapping between keys and links
 * in the doubly linked list, as well as the head and tail sentinel nodes.
 *
 * @template K The type of keys in the map
 * @template V The type of values in the map
 */
class OrderedMapState<K, V> {
  /** Dictionary mapping keys to their corresponding links in the list */
  public _map: Dictionary<K, Link<K, V>>;
  /** Sentinel node at the beginning of the list */
  public _head: Link<K, V>;
  /** Sentinel node at the end of the list */
  public _tail: Link<K, V>;
  /** Counter that tracks the number of mutations to detect concurrent modifications */
  public _mutationsCount: number;

  /**
   * Creates a new OrderedMapState
   *
   * @param dictInst Optional dictionary implementation to use instead of Map
   */
  constructor(dictInst?: Dictionary) {
    this._map = dictInst || new Map();
    this._head = new Link();
    this._tail = new Link();
    this._head.next = this._tail;
    this._tail.prev = this._head;
    this._mutationsCount = 0;
  }
}

/**
 * An ordered map implementation that maintains insertion order of keys.
 * Combines a hash table with a doubly linked list to provide O(1) operations
 * for most methods while preserving key order.
 *
 * Useful for building caches, maintaining ordered collections, and scenarios
 * where both fast lookups and order preservation are required.
 *
 * @template K The type of keys in the map
 * @template V The type of values in the map
 */
export class OrderedMap<K, V> implements Dictionary<K, V> {
  private _state: OrderedMapState<K, V>;

  /**
   * Creates a new OrderedMap
   *
   * @param dictInst Optional dictionary implementation to use for internal
   *                 storage instead of the default Map. If provided, it will
   *                 be cleared.
   */
  constructor(dictInst?: Dictionary) {
    if (dictInst !== undefined) {
      dictInst.clear();
    }
    this._state = new OrderedMapState(dictInst);
  }

  /**
   * Returns the number of key-value pairs in the map.
   *
   * @returns The number of key-value pairs in the map
   */
  get size(): number {
    return this._state._map.size;
  }

  /**
   * Returns the key of the first element in the map, or undefined if the map is
   * empty. This is the oldest inserted key that hasn't been (re)moved.
   *
   * @returns The key of the first element or undefined if empty
   */
  get startKey(): K | undefined {
    return this._state._head.next?.key;
  }

  get endKey(): K | undefined {
    return this._state._tail.prev?.key;
  }

  /**
   * Add a key with no value (undefined value), if the key doesn't already
   * exist. If it does exist, this method does nothing. New keys are added
   * at the end.
   */
  add(key: K): void {
    this._addImpl(key);
  }

  /**
   * Set the value for a given key, adding it if needed.
   * New keys are added at the end.
   */
  set(key: K, value: V): void {
    this._addImpl(key).value = value;
  }

  /**
   * Internal implementation for adding a key to the map.
   * If the key already exists, returns the existing link.
   * If the key is new, creates a new link, adds it to the end of the list,
   * and returns it.
   *
   * @param key The key to add to the map
   * @returns The link associated with the key (either existing or newly created)
   * @private
   */
  private _addImpl(key: K): Link<K, V> {
    let link = this._state._map.get(key);
    if (link !== undefined) {
      return link;
    }
    link = new Link();
    link.key = key;
    this._state._tail.insertBefore(link);
    this._state._map.set(key, link);
    ++this._state._mutationsCount;
    assert(this._state._head.length === this._state._map.size + 2);
    return link;
  }

  /**
   * Move a key to the end of the list. Does nothing if the key doesn't exist.
   */
  moveToEnd(key: K): void {
    const link = this._state._map.get(key);
    if (!link) {
      return;
    }
    this._state._tail.insertBefore(link);
    ++this._state._mutationsCount;
    assert(this._state._head.length === this._state._map.size + 2);
  }

  /**
   * Move a key to the start of the list. Does nothing if the key doesn't exist.
   */
  moveToStart(key: K): void {
    const link = this._state._map.get(key);
    if (!link) {
      return;
    }
    this._state._head.insertAfter(link);
    ++this._state._mutationsCount;
    assert(this._state._head.length === this._state._map.size + 2);
  }

  /**
   * Returns the key that follows the given key in the ordered map.
   * If the key doesn't exist or is the last key in the map, returns undefined.
   *
   * @param key The key to find the next key for
   * @returns The next key in the ordered sequence, or undefined if there is no
   *          next key
   */
  next(key: K): K | undefined {
    const link = this._state._map.get(key);
    if (link === undefined) {
      return undefined;
    }
    if (link.next !== this._state._tail) {
      return link.next!.key;
    }
    return undefined;
  }

  /**
   * Returns the key that precedes the given key in the ordered map.
   * If the key doesn't exist or is the first key in the map, returns undefined.
   *
   * @param key The key to find the previous key for
   * @returns The previous key in the ordered sequence, or undefined if there is
   *          no previous key
   */
  prev(key: K): K | undefined {
    const link = this._state._map.get(key);
    if (link === undefined) {
      return undefined;
    }
    if (link.prev !== this._state._head) {
      return link.prev!.key;
    }
    return undefined;
  }

  /**
   * Returns whether the given key exists in the collection. Note that a key
   * may exist with an undefined value. Use this method rather than get() to
   * distinguish the two cases.
   *
   * @param key The key to check for existence
   * @returns True if the key exists in the map, false otherwise
   */
  has(key: K): boolean {
    return this._state._map.has(key);
  }

  /**
   * Removes the given key and its associated value from the collection.
   * Does nothing if the key doesn't exist.
   *
   * @param key The key to remove from the map
   * @returns True if the key was found and removed, false otherwise
   */
  delete(key: K): boolean {
    const link = this._state._map.get(key);
    if (!link) {
      return false;
    }
    link.detach();
    this._state._map.delete(key);
    ++this._state._mutationsCount;
    assert(this._state._head.length === this._state._map.size + 2);
    return true;
  }

  /**
   * Returns the value for the given key or undefined if the key doesn't exist.
   *
   * @param key The key to get the value for
   * @returns The value associated with the key, or undefined if the key doesn't exist
   */
  get(key: K): V | undefined {
    const link = this._state._map.get(key);
    return link?.value;
  }

  /**
   * Removes all key-value pairs from the map.
   */
  clear(): void {
    this._state._map.clear();
    this._state._head.next = this._state._tail;
    this._state._tail.prev = this._state._head;
  }

  /**
   * Returns an iterator over the keys in the collection.
   * Keys are returned by their internal order.
   *
   * @returns An iterator over the keys in the collection
   */
  keys(): Iterable<K> {
    return new OrderedMapIter<K, V>(this._state, true, false) as Iterable<K>;
  }

  /**
   * Returns an iterator over the values in the collection.
   * Values are returned by their internal order.
   * Any attempt to mutate the collection during iteration will cause the
   * iterator to throw a MutationError.
   *
   * @returns An iterator over the values in the collection
   */
  values(): Iterable<V> {
    return new OrderedMapIter<K, V>(this._state, false, true) as Iterable<V>;
  }

  /**
   * Returns an iterator over the keys and values in the collection.
   * Entries are returned by their internal order.
   * Any attempt to mutate the collection during iteration will cause the
   * iterator to throw a MutationError.
   */
  entries(): Iterable<[K, V]> {
    return new OrderedMapIter(this._state, true, true) as Iterable<[K, V]>;
  }

  /**
   * Implements the iterable protocol, allowing the OrderedMap to be used
   * in for...of loops and with the spread operator.
   * Returns an iterator over [key, value] pairs in insertion order.
   * Any attempt to mutate the collection during iteration will cause the
   * iterator to throw a MutationError.
   *
   * @returns An iterator over [key, value] pairs in the map
   */
  [Symbol.iterator](): Iterator<[K, V]> {
    return new OrderedMapIter(this._state, true, true) as Iterator<[K, V]>;
  }
}

/**
 * A node in a doubly linked list that stores a key-value pair.
 * Used internally by OrderedMap to maintain the order of elements.
 *
 * @template K The type of keys stored in the link
 * @template V The type of values stored in the link
 */
class Link<K, V> {
  /** Reference to the next link in the list */
  public next: Link<K, V> | undefined;
  /** Reference to the previous link in the list */
  public prev: Link<K, V> | undefined;
  /** The key associated with this link */
  public key: K | undefined;
  /** The value associated with this link */
  public value: V | undefined;

  /**
   * Removes this link from the list by updating the next/prev pointers
   * of adjacent links and clearing its own references.
   */
  detach() {
    this._validateLinks();
    if (this.next) {
      this.next.prev = this.prev;
    }
    if (this.prev) {
      this.prev.next = this.next;
    }
    this.next = undefined;
    this.prev = undefined;
  }

  /**
   * Validates that this link's next/prev pointers are consistent with
   * the links they point to. Used for debugging and ensuring list integrity.
   */
  _validateLinks() {
    if (this.next) {
      assert(this.next.prev === this);
    }
    if (this.prev) {
      assert(this.prev.next === this);
    }
  }

  /**
   * Inserts the given link after this link in the list.
   *
   * @param next The link to insert after this one
   */
  insertAfter(next: Link<K, V>): void {
    assert(next !== this);
    next.detach();
    next.prev = this;
    next.next = this.next;
    if (this.next !== undefined) {
      this.next.prev = next;
    }
    this.next = next;
    this._validateLinks();
    next._validateLinks();
    next.prev._validateLinks();
  }

  /**
   * Inserts the given link before this link in the list.
   *
   * @param prev The link to insert before this one
   */
  insertBefore(prev: Link<K, V>): void {
    assert(prev !== this);
    prev.detach();
    prev.next = this;
    prev.prev = this.prev;
    if (this.prev !== undefined) {
      this.prev.next = prev;
    }
    this.prev = prev;
    this._validateLinks();
    prev._validateLinks();
    prev.next._validateLinks();
  }

  /**
   * Calculates the length of the list starting from this link.
   * Used primarily for validation and debugging.
   *
   * @returns The number of links in the list including this one
   */
  get length() {
    let count = 1;
    // deno-lint-ignore no-this-alias
    for (let node: Link<K, V> = this; node.next; node = node.next) {
      ++count;
    }
    return count;
  }
}

/**
 * Iterator class for OrderedMap that implements the Iterator protocol.
 * Allows iteration over keys, values, or entries in the map in their insertion order.
 *
 * @template K The type of keys in the map
 * @template V The type of values in the map
 */
class OrderedMapIter<K, V> {
  /** Reference to the OrderedMapState being iterated */
  private readonly _state: OrderedMapState<K, V>;
  /** Snapshot of mutation count at iterator creation to detect concurrent modifications */
  private readonly _mutationsCount: number;
  /** Whether to include keys in the iteration results */
  private readonly _includeKeys: boolean;
  /** Whether to include values in the iteration results */
  private readonly _includeValues: boolean;
  /** The current link in the iteration sequence */
  private _nextLink: Link<K, V>;

  /**
   * Creates a new OrderedMapIter
   *
   * @param state The OrderedMapState to iterate over
   * @param includeKeys Whether to include keys in the iteration results
   * @param includeValues Whether to include values in the iteration results
   */
  constructor(
    state: OrderedMapState<K, V>,
    includeKeys: boolean,
    includeValues: boolean,
  ) {
    this._state = state;
    this._mutationsCount = state._mutationsCount;
    this._nextLink = state._head;
    this._includeKeys = includeKeys;
    this._includeValues = includeValues;
  }

  /**
   * Returns the next item in the iteration sequence
   *
   * @throws {MutationError} If the map was modified during iteration
   * @returns An object with done and value properties according to the Iterator protocol
   */
  next(): {
    done: boolean;
    value?: K | V | [K | undefined, V | undefined] | undefined;
  } {
    if (this._state._mutationsCount !== this._mutationsCount) {
      throw new MutationError();
    }
    const probablyLink = this._nextLink.next;
    assert(probablyLink !== undefined);
    const link = probablyLink!;
    this._nextLink = link;
    if (link === this._state._tail) {
      return { done: true };
    }
    let v: K | V | [K | undefined, V | undefined] | undefined;
    const linkValue = this._state._map.get(link.key!)?.value;
    if (this._includeKeys) {
      v = this._includeValues ? [link.key!, linkValue] : link.key!;
    } else {
      v = linkValue;
    }
    return {
      done: false,
      value: v,
    };
  }

  /**
   * Makes this class iterable by returning itself
   *
   * @returns This iterator instance
   */
  [Symbol.iterator]() {
    return this;
  }
}
