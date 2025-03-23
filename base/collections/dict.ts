import { HashMap } from './hash-map.ts';

/**
 * A read-only version of the Dictionary interface that provides access to
 * key-value pairs without modification capabilities. Useful for scenarios where
 * you want to expose dictionary data while preventing modifications.
 *
 * This interface extends Iterable to allow for iteration over key-value pairs
 * using for..of loops.
 *
 * @template K - The type of keys in the dictionary
 * @template V - The type of values in the dictionary
 */
// deno-lint-ignore no-explicit-any
export interface ReadonlyDict<K = any, V = any> extends Iterable<[K, V]> {
  readonly size: number;
  get(key: K): V | undefined;
  has(key: K): boolean;

  entries(): Iterable<[K, V]>;
  keys(): Iterable<K>;
  values(): Iterable<V>;
}

/**
 * Dictionary is a generic key-value collection abstraction that provides a
 * common interface for different dictionary implementations, such as
 * JavaScript's built-in Map and our custom HashMap.
 *
 * This abstraction allows code to work with different dictionary
 * implementations interchangeably, making it possible to choose the most
 * appropriate implementation for specific performance characteristics or
 * functionality without changing the consuming code.
 *
 * Supported implementations:
 * - JavaScript's built-in Map: General-purpose key-value collection
 * - HashMap: Custom implementation optimized for specific use cases
 *
 * @template K - The type of keys in the dictionary
 * @template V - The type of values in the dictionary
 */
export interface Dictionary<K = any, V = any> extends ReadonlyDict<K, V> {
  set(key: K, value: V): void;
  delete(key: K): boolean;
  clear(): void;
}

/**
 * A simple object type that uses string keys to store values.
 * This represents a plain JavaScript object used as a map/dictionary.
 *
 * @template T - The type of values stored in the primitive map
 */
export interface PrimitiveMap<T = any> {
  [k: string]: T;
}

/**
 * Converts a Dictionary instance to a primitive JavaScript object.
 * All keys are converted to strings using String().
 *
 * @template K - The key type of the source dictionary
 * @template T - The value type of the source dictionary
 * @param map - The Dictionary to convert (can be undefined)
 * @returns A plain JavaScript object containing the same key-value pairs
 */
export function dictToPrimitive<K, T>(
  map: Dictionary<K, T> | undefined,
): PrimitiveMap {
  const result: PrimitiveMap = {};
  if (map === undefined || map.size <= 0) {
    return result;
  }
  for (const k of map.keys()) {
    result[String(k)] = map.get(k);
  }
  return result;
}

/**
 * Creates a Dictionary (Map implementation) from a primitive JavaScript object.
 *
 * @template T - The type of values in the primitive map
 * @param map - A plain JavaScript object to convert
 * @returns A new Dictionary (Map) containing the object's key-value pairs
 */
export function dictFromPrimitive<T>(
  map: PrimitiveMap<T>,
): Dictionary<string, T> {
  return new Map(Object.entries(map));
}

/**
 * Compares two Dictionary instances for equality of their contents.
 *
 * @template K - The key type of the dictionaries
 * @template T - The value type of the dictionaries
 * @param dic1 - First dictionary to compare
 * @param dic2 - Second dictionary to compare
 * @param comparer - Optional custom function to compare values (defaults to strict equality ===)
 * @returns True if both dictionaries contain the same key-value pairs, false otherwise
 */
export function dictEquals<K, T>(
  dic1: Dictionary<K, T>,
  dic2: Dictionary<K, T>,
  comparer: (v1: T, v2: T) => boolean = (v1, v2) => v1 === v2,
) {
  if (dic1.size !== dic2.size) return false;

  for (const [key, value1] of dic1) {
    const value2 = dic2.get(key);
    if (value2 === undefined) {
      return false;
    }

    if (!comparer(value1, value2)) {
      return false;
    }
  }

  return true;
}

/**
 * Type guard that checks if a value is a Dictionary implementation.
 * Currently recognizes JavaScript's built-in Map and our custom HashMap.
 *
 * @template K - The key type to check for
 * @template V - The value type to check for
 * @param val - The value to check
 * @returns True if the value is a Dictionary implementation, false otherwise
 */
export function isDictionary<K, V>(val: any): val is Dictionary<K, V> {
  return val instanceof Map || val instanceof HashMap;
}

/**
 * Converts a Dictionary with string keys and values to a plain JavaScript object.
 * Useful for serialization or passing to APIs that expect plain objects.
 *
 * @param dict - The Dictionary to convert
 * @returns A plain JavaScript object with the same string keys and values
 */
export function convertDictionaryToObject(dict: Dictionary<string, string>): {
  [key: string]: string;
} {
  const obj: { [key: string]: string } = {};

  for (const [key, value] of dict.entries()) {
    obj[key as string] = value;
  }

  return obj;
}
