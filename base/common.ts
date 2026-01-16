import { notReached } from './error.ts';
import type { ReadonlyJSONObject, ReadonlyJSONValue } from './interfaces.ts';

/**
 * Generates a random ID string.
 *
 * The generated ID is URL-safe, using only lowercase letters and numbers.
 * The default length of 24 characters provides a large enough space to
 * ensure a very low probability of collisions for most applications.
 *
 * Note: This function uses Math.random() which is not cryptographically secure.
 * Do not use for security-sensitive purposes.
 *
 * With 36 possible characters (a-z, 0-9) and a length of 24, there are
 * 36^24 (approximately 2.24 * 10^37) possible unique IDs, making
 * collisions extremely unlikely for most use cases.
 *
 * @param length - The length of the ID to generate (default: 24)
 * @returns A random string of the specified length
 */
export function uniqueId(length = 24): string {
  // Alphanumeric characters
  // const chars =
  //   'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  // We're using lowercase characters only to be URL friendly. At the time of
  // this writing (15/11/23), Deno converts the entire URL to lowercase.
  // To compensate for the reduced space, we've increased the default length
  // from 20 to 24.
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let autoId = '';
  for (let i = 0; i < length; i++) {
    autoId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return autoId;
}

/**
 * Converts a JSON value to a pretty-printed string.
 *
 * If the input object has a toJSON method, it will be called first to get
 * the serializable representation of the object.
 *
 * @param o - The JSON value to pretty print
 * @returns A formatted string representation of the input
 *
 * @example
 * const obj = { foo: 'bar', baz: 42 };
 * console.log(prettyJSON(obj));
 * // Output:
 * // {
 * //   "foo": "bar",
 * //   "baz": 42
 * // }
 */
export function prettyJSON(o: ReadonlyJSONValue): string {
  // deno-lint-ignore no-explicit-any
  if ((o as any).toJSON instanceof Function) {
    // deno-lint-ignore no-explicit-any
    o = ((o as any).toJSON as () => ReadonlyJSONObject)();
  }
  return JSON.stringify(o, null, 2);
}

/**
 * Yields all own enumerable property keys of an object.
 *
 * This generator function iterates through all enumerable properties of the
 * given object and yields only those that are directly owned by the object
 * (not inherited from its prototype).
 *
 * @template T The type of the object
 * @param obj The object to get keys from
 * @yields {string} Each own enumerable property key of the object
 *
 * @example
 * const obj = { a: 1, b: 2 };
 * for (const key of keysOf(obj)) {
 *   console.log(key); // 'a', 'b'
 * }
 */
export function* keysOf<T extends Record<string, unknown>>(
  obj: T,
): Generator<string> {
  for (const k in obj) {
    // deno-lint-ignore no-prototype-builtins
    if (obj.hasOwnProperty(k)) {
      yield k;
    }
  }
}

/**
 * Returns an array of all keys from an object.
 *
 * @template T The type of the object
 * @param obj The object to get keys from
 * @returns An array of all keys in the object
 *
 * @example
 * const obj = { a: 1, b: 2 };
 * const keys = allKeysOf(obj); // ['a', 'b']
 */
export function allKeysOf<T extends Record<never, never>>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[];
}

/**
 * Combines multiple iterables into a single iterable that yields all values
 * from each input iterable in sequence.
 *
 * @template T The type of elements in the iterables
 * @param {...Iterable<T>[]} args The iterables to combine
 * @returns {Iterable<T>} A new iterable that yields all values from the input
 *                        iterables
 *
 * @example
 * const a = [1, 2, 3];
 * const b = [4, 5, 6];
 * const combined = unionIter(a, b);
 * // Yields: 1, 2, 3, 4, 5, 6
 */
export function* unionIter<T>(...args: Iterable<T>[]): Iterable<T> {
  for (const iter of args) {
    for (const v of iter) {
      yield v;
    }
  }
}

export function newInstance<T = any>(instance: any, ...args: any[]): T {
  return new (instance.constructor as any)(...args) as T;
}

/**
 * Maps values from an iterable to new values using a mapping function.
 *
 * @template IT The type of elements in the input iterable
 * @template OT The type of elements in the output iterable (defaults to IT)
 * @param {Iterable<IT>} input The input iterable to map over
 * @param {(v: IT, idx: number) => OT} mapper A function that transforms each
 *                                            element and its index into a new
 *                                            value
 * @returns {Iterable<OT>} A new iterable containing the mapped values
 *
 * @example
 * const numbers = [1, 2, 3];
 * const doubled = mapIterable(numbers, (n, i) => n * 2);
 * // Yields: 2, 4, 6
 */
export function* mapIterable<IT, OT = IT>(
  input: Iterable<IT>,
  mapper: (v: IT, idx: number) => OT,
): Iterable<OT> {
  let i = 0;
  for (const v of input) {
    yield mapper(v, i);
    ++i;
  }
}

/**
 * Filters an iterable based on a predicate function.
 *
 * @template IT The type of elements in the input iterable
 * @param {Iterable<IT>} input The input iterable to filter
 * @param {(v: IT) => boolean} filter A predicate function that determines which
 *                                    elements to keep
 * @returns {Iterable<IT>} A new iterable containing only the elements that pass
 *                         the filter
 *
 * @example
 * const numbers = [1, 2, 3, 4, 5];
 * const evenNumbers = filterIterable(numbers, n => n % 2 === 0);
 * // Yields: 2, 4
 */
export function* filterIterable<IT>(
  input: Iterable<IT>,
  filter: (v: IT) => boolean,
): Iterable<IT> {
  for (const v of input) {
    if (filter(v)) {
      yield v;
    }
  }
}

/**
 * Attempts to run garbage collection if available in the current environment.
 * This is primarily used for testing and debugging purposes.
 * Note: Garbage collection is not guaranteed to run immediately or at all,
 * as it depends on the JavaScript engine's implementation.
 */
export function runGC(): void {
  // deno-lint-ignore no-explicit-any
  const gc = (self as any).gc;
  if (typeof gc === 'function') {
    gc();
  }
}

let kIsDeno: boolean = false;
try {
  kIsDeno = Deno !== undefined;
} catch (_: unknown) {
  // kIsDeno = false;
}

let kHasSelf: boolean = false;
try {
  kHasSelf = self !== undefined;
} catch (_: unknown) {
  // kHasSelf = false;
}

/**
 * Determines if the code is running in a browser environment.
 *
 * @deprecated Use `getRuntime().id === 'browser'` from `base/runtime/index.ts` instead.
 * This function is kept for backwards compatibility.
 *
 * @returns {boolean} True if running in a browser, false otherwise.
 */
export function isBrowser(): boolean {
  return kHasSelf && !kIsDeno;
}

/**
 * Determines if the code is running in a Deno environment.
 *
 * @deprecated Use `getRuntime().id === 'deno'` from `base/runtime/index.ts` instead.
 * This function is kept for backwards compatibility.
 *
 * @returns {boolean} True if running in Deno, false otherwise.
 */
export function isDeno(): boolean {
  return kIsDeno;
}

/**
 * Determines if the code is running in a Node.js environment.
 *
 * @deprecated Use `getRuntime().id === 'node'` from `base/runtime/index.ts` instead.
 * This function is kept for backwards compatibility.
 *
 * @returns {boolean} True if running in Node.js, false otherwise.
 */
export function isNode(): boolean {
  return !kIsDeno && !kHasSelf;
}

/**
 * Returns the appropriate crypto object for the current environment
 * (browser or Node.js).
 */
export function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto;
  }
  // Node.js environment
  if (
    // deno-lint-ignore no-process-global
    typeof process !== 'undefined' && process.versions && process.versions.node
  ) {
    return require('node:crypto').webcrypto;
  }
  notReached('No Web Crypto API available in this environment.');
}
