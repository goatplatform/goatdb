/**
 * Single frozen dispatch table for per-CoreType operations (issue #58 §1).
 *
 * Before this file, CoreType knowledge was duplicated across three switches in
 * clone.ts, equals.ts and base-encoder.ts. Adding a CoreType meant editing all
 * three; a missed switch silently mis-handled the new type. Here the knowledge
 * lives once and `satisfies Record<CoreType, CoreTypeOps>` makes a missing (or
 * extra) entry a compile error.
 *
 * Clone aliasing (declared behavior change, see CHANGELOG): one
 * `CoreCloneContext` is shared across the whole top-level clone, so a value
 * referenced from multiple places (object fields, array/set siblings) is
 * cloned once and stays aliased in the output. The pre-table code only
 * preserved aliases within a single object subtree.
 *
 * WHY this file owns the clone/equals bodies: keeping them here lets the table
 * entries recurse through `kTypeOps` without importing the public wrappers,
 * which would create an avoidable runtime cycle with clone.ts.
 *
 * `isEncodedRef` lives in `encoding/encoded-ref.ts`, a dependency-free leaf, so
 * that import is one-way (type-ops.ts -> encoded-ref.ts). `equals.ts` and
 * `base/set.ts` are different: both import `coreValueEquals` from here, so
 * type-ops.ts <-> equals.ts <-> base/set.ts is mutually recursive by design.
 * Every cross-module call sits inside a function body, so the cycle resolves
 * without a TDZ error.
 *
 * `encode` delegates to the encoder's `convert*` methods. Those stay the
 * polymorphic extension point (subclasses override them); they are simply no
 * longer re-dispatched from a switch. The table is NOT part of the public
 * `mod.ts` API.
 */

import { numbersEqual } from '../comparisons.ts';
import { dictEquals, type Dictionary } from '../collections/dict.ts';
import * as SetUtils from '../set.ts';
import {
  type CoreKey,
  type CoreObject,
  type CoreOptions,
  CoreType,
  type CoreValue,
  type CoreValueCloneOpts,
  type Encodable,
  type IterableFilterFunc,
  type ReadonlyCoreArray,
  type ReadonlyCoreObject,
} from './base.ts';
import { coreValueEquals } from './equals.ts';
import { isEncodedRef } from './encoding/encoded-ref.ts';
import {
  getCoreType,
  isClonable,
  isComparable,
  isEncodable,
  isEquatable,
} from './utils.ts';
import type { BaseEncoder } from './encoding/base-encoder.ts';

/**
 * Per-operation clone state. The wrapper creates exactly one per top-level
 * clone call; `objectsCache` is allocated lazily by the Object entry (never
 * hoisted), and every Object entry writes the cache back into the context, so
 * shared values alias across the whole clone output - object fields and
 * array/set siblings alike.
 */
export interface CoreCloneContext {
  objectsCache?: Map<CoreObject, CoreObject>;
}

/**
 * Result of enumerating a value's ref-collection children. Faithful to
 * `fillRefs`: `recurseOptions` is the exact options object forwarded to each
 * child, or `undefined` when this boundary drops options (Dictionary/Object).
 * `ref` marks a ref candidate (non-encoded-ref Object seen at enumeration
 * time). The cyclical layer encodes it as `__r`/`__d` only on second sight
 * (see RefSet in encoding/cyclical.ts); single-sight objects stay inline.
 */
export interface CoreChildren {
  readonly children: Iterable<CoreValue>;
  readonly recurseOptions?: CoreOptions;
  readonly ref?: boolean;
}

// The table is called from the generic wrappers (clone.ts/equals.ts/
// base-encoder.ts). `CoreValue | object` matches the real domain: custom class
// objects are encoded/cloned but are not part of `CoreValue` itself. Concrete
// entries narrow their own params; method-parameter bivariance keeps those
// overrides legal.
export interface CoreTypeOps {
  clone(
    value: CoreValue | object,
    context: CoreCloneContext,
    opts?: CoreValueCloneOpts,
  ): CoreValue;
  equals(
    a: CoreValue | object,
    b: CoreValue | object,
    opts?: CoreOptions,
  ): boolean;
  encode(
    enc: AnyEncoder,
    value: CoreValue | object,
    opts?: CoreOptions,
  ): CoreValue;
  // TODO(#58-followup): iterableFilter is not applied during ref collection.
  // The Object/Dictionary branches drop options when recursing, so the
  // filter never runs there. Pinned intentionally by refs-matrix tests; no
  // behavior change without a reviewed diff.
  childrenOf(value: CoreValue | object, opts?: CoreOptions): CoreChildren;
}

/**
 * The concrete encoder is unknown at the table boundary; `CoreValue` is the
 * widest instantiation the `BaseEncoder`/`ChecksumEncoder` subclasses accept.
 * This keeps the boundary typed without leaking a specific encoder.
 */
type AnyEncoder = BaseEncoder<CoreValue, CoreValue, CoreOptions>;

/** Re-enter the table for a nested value. */
function cloneValue(
  value: CoreValue,
  context: CoreCloneContext,
  opts?: CoreValueCloneOpts,
): CoreValue {
  return kTypeOps[getCoreType(value)].clone(value, context, opts);
}

function equalsIterable(
  i1: Iterable<CoreValue>,
  i2: Iterable<CoreValue>,
  iterableFilter: IterableFilterFunc,
  options?: CoreOptions,
): boolean {
  const iter1 = i1[Symbol.iterator]();
  const iter2 = i2[Symbol.iterator]();

  let val1 = iter1.next();
  let val2 = iter2.next();

  while (true) {
    // Find iter1's next element that passes the filter.
    while (val1.done !== true) {
      if (!iterableFilter(val1.value)) {
        val1 = iter1.next();
      } else {
        break;
      }
    }

    // Find iter2's next element that passes the filter.
    while (val2.done !== true) {
      if (!iterableFilter(val2.value)) {
        val2 = iter2.next();
      } else {
        break;
      }
    }

    if (
      (val1.done === true && val2.done !== true) ||
      (val2.done === true && val1.done !== true)
    ) {
      // One iterator is done and the other is not.
      return false;
    }

    if (val1.done === true && val2.done === true) {
      // Both are done.
      return true;
    }

    if (!coreValueEquals(val1.value, val2.value, options)) {
      return false;
    }
    val1 = iter1.next();
    val2 = iter2.next();
  }
}

function setLongMatch(
  s1: Set<CoreValue>,
  s2: Set<CoreValue>,
  options?: CoreOptions,
): number {
  let matchCount = 0;
  const iterableFilter = options && options.iterableFilter;
  for (const v1 of s1) {
    if (iterableFilter && !iterableFilter(v1)) {
      continue;
    }

    let foundMatch = false;
    for (const v2 of s2) {
      if (coreValueEquals(v1, v2, options)) {
        foundMatch = true;
        break;
      }
    }
    // If v1 is not in s2, the sets differ.
    if (!foundMatch) {
      return -1;
    }
    matchCount++;
  }

  return matchCount;
}

/** Leaf types have no children and are never ref candidates. */
const kNoChildren: CoreChildren = Object.freeze({ children: [] });

/**
 * Array/Set enumeration: `fillRefs` forwards the same options to every child,
 * so an `iterableFilter` applies here and to nested Array/Set. A filtered-out
 * child is dropped and never recursed into.
 */
function iterableChildren(
  value: Iterable<CoreValue>,
  options?: CoreOptions,
): CoreChildren {
  const filter = options?.iterableFilter;
  if (filter === undefined) {
    return { children: value, recurseOptions: options };
  }
  const children: CoreValue[] = [];
  for (const item of value) {
    if (filter(item)) children.push(item);
  }
  return { children, recurseOptions: options };
}

/** Dictionary values recursed without options; dictionaries are not refs. */
function dictionaryChildren(
  value: Dictionary<CoreKey, CoreValue>,
): CoreChildren {
  const children: CoreValue[] = [];
  for (const [, v] of value) children.push(v);
  return { children };
}

/**
 * Object enumeration: an encoded ref is skipped entirely; any other object is
 * a ref candidate and its field values are enumerated without options.
 */
function objectChildren(value: ReadonlyCoreObject): CoreChildren {
  if (isEncodedRef(value as CoreValue)) return kNoChildren;
  const children: CoreValue[] = [];
  for (const [, v] of Object.entries(value)) {
    children.push(v as CoreValue);
  }
  return { children, ref: true };
}

export const kTypeOps: Readonly<Record<CoreType, CoreTypeOps>> = Object.freeze(
  {
    [CoreType.String]: {
      clone: (value: string) => value,
      equals: (a: string, b: string) => a === b,
      encode: (
        enc: AnyEncoder,
        value: string,
        opts?: CoreOptions,
      ) => enc.convertString(value, opts),
      childrenOf: () => kNoChildren,
    } satisfies CoreTypeOps,

    [CoreType.Number]: {
      clone: (value: number) => value,
      equals: (a: number, b: number) => numbersEqual(a, b),
      encode: (
        enc: AnyEncoder,
        value: number,
        opts?: CoreOptions,
      ) => enc.convertNumber(value, opts),
      childrenOf: () => kNoChildren,
    } satisfies CoreTypeOps,

    [CoreType.Boolean]: {
      clone: (value: boolean) => value,
      equals: (a: boolean, b: boolean) => a === b,
      encode: (
        enc: AnyEncoder,
        value: boolean,
        opts?: CoreOptions,
      ) => enc.convertBoolean(value, opts),
      childrenOf: () => kNoChildren,
    } satisfies CoreTypeOps,

    [CoreType.Null]: {
      clone: (value: null) => value,
      equals: (a: null, b: null) => a === b,
      encode: (enc: AnyEncoder, _value: null, opts?: CoreOptions) =>
        enc.convertNull(opts),
      childrenOf: () => kNoChildren,
    } satisfies CoreTypeOps,

    [CoreType.Undefined]: {
      clone: (value: undefined) => value,
      equals: (a: undefined, b: undefined) => a === b,
      encode: (
        enc: AnyEncoder,
        _value: undefined,
        opts?: CoreOptions,
      ) => enc.convertUndefined(opts),
      childrenOf: () => kNoChildren,
    } satisfies CoreTypeOps,

    [CoreType.Date]: {
      clone: (value: Date) => new Date(value.getTime()),
      equals: (a: Date, b: Date) => numbersEqual(a.getTime(), b.getTime()),
      encode: (enc: AnyEncoder, value: Date, opts?: CoreOptions) =>
        enc.convertDate(value, opts),
      childrenOf: () => kNoChildren,
    } satisfies CoreTypeOps,

    [CoreType.Array]: {
      clone: (
        value: ReadonlyCoreArray,
        context: CoreCloneContext,
        opts?: CoreValueCloneOpts,
      ) => {
        let arr = value;
        if (opts !== undefined && opts.iterableFilter !== undefined) {
          arr = arr.filter(opts.iterableFilter);
        }
        return arr.map((v) => cloneValue(v, context, opts));
      },
      equals: (
        a: ReadonlyCoreArray,
        b: ReadonlyCoreArray,
        opts?: CoreOptions,
      ) => {
        const iterableFilter = opts && opts.iterableFilter;
        if (iterableFilter) {
          return equalsIterable(a, b, iterableFilter, opts);
        }

        if (a.length !== b.length) {
          return false;
        }

        for (let i = 0; i < a.length; ++i) {
          if (!coreValueEquals(a[i], b[i], opts)) {
            return false;
          }
        }

        return true;
      },
      encode: (
        enc: AnyEncoder,
        value: ReadonlyCoreArray,
        opts?: CoreOptions,
      ) => enc.convertArray(value, opts),
      childrenOf: (value: ReadonlyCoreArray, opts?: CoreOptions) =>
        iterableChildren(value, opts),
    } satisfies CoreTypeOps,

    [CoreType.Set]: {
      clone: (
        value: Set<CoreValue>,
        context: CoreCloneContext,
        opts?: CoreValueCloneOpts,
      ) => {
        const result = new Set<CoreValue>();
        for (const v of value) {
          if (opts !== undefined && opts.iterableFilter !== undefined) {
            if (!opts.iterableFilter(v)) continue;
          }
          result.add(cloneValue(v, context, opts));
        }
        return result;
      },
      equals: (
        a: Set<CoreValue>,
        b: Set<CoreValue>,
        opts?: CoreOptions,
      ) => {
        const iterableFilter = opts && opts.iterableFilter;
        if (iterableFilter === undefined && a.size !== b.size) {
          return false;
        }

        // Shortcut: linear scan for pointer inequality.
        if (SetUtils.equals(a, b, iterableFilter)) {
          return true;
        }

        // Pointer mismatch. Fall back to N^2 deep equality. We assume distinct
        // values, as per the normal definition of a Set.
        const matchCount = setLongMatch(a, b, opts);
        if (matchCount === -1) {
          return false;
        }

        if (iterableFilter && b.size > matchCount) {
          if (setLongMatch(b, a, opts) === -1) {
            return false;
          }
        }

        return true;
      },
      encode: (
        enc: AnyEncoder,
        value: Set<CoreValue>,
        opts?: CoreOptions,
      ) => enc.convertSet(value, opts),
      childrenOf: (value: Set<CoreValue>, opts?: CoreOptions) =>
        iterableChildren(value, opts),
    } satisfies CoreTypeOps,

    [CoreType.Object]: {
      clone: (
        value: ReadonlyCoreObject,
        context: CoreCloneContext,
        opts?: CoreValueCloneOpts,
      ) => {
        // One cache per top-level clone, written back to `context` so shared
        // refs stay aliased everywhere - including across array/set siblings
        // (new behavior, declared in CHANGELOG).
        let objectsCache = context.objectsCache;
        if (objectsCache === undefined) {
          objectsCache = new Map<CoreObject, CoreObject>();
          context.objectsCache = objectsCache;
        }

        const obj = value as { [key: string]: CoreValue };
        const cached = objectsCache.get(obj);
        if (cached !== undefined) return cached;

        if (opts && opts.objectOverride) {
          const [result, newObj] = opts.objectOverride(obj);
          if (result) {
            objectsCache.set(obj, newObj as CoreObject);
            return newObj;
          }
        }

        const result: { [key: string]: CoreValue } = {};
        for (const k in obj) {
          if (
            Object.hasOwn(obj, k) &&
            (opts === undefined ||
              opts.objectFilterFields === undefined ||
              opts.objectFilterFields(k, obj))
          ) {
            if (opts !== undefined && opts.fieldCloneOverride !== undefined) {
              result[k] = opts.fieldCloneOverride(obj, k, opts);
            } else {
              result[k] = cloneValue(obj[k], context, opts);
            }
          }
        }

        objectsCache.set(obj, result);

        return result;
      },
      equals: (
        a: ReadonlyCoreObject,
        b: ReadonlyCoreObject,
        opts?: CoreOptions,
      ) => {
        for (const k in a) {
          if (
            Object.hasOwn(a, k) &&
            (opts === undefined ||
              opts.objectFilterFields === undefined ||
              opts.objectFilterFields(k, a)) &&
            (!Object.hasOwn(b, k) || !coreValueEquals(a[k], b[k], opts))
          ) {
            return false;
          }
        }
        for (const k in b) {
          if (
            Object.hasOwn(b, k) &&
            (opts === undefined ||
              opts.objectFilterFields === undefined ||
              opts.objectFilterFields(k, b)) &&
            !Object.hasOwn(a, k)
          ) {
            return false;
          }
        }
        return true;
      },
      encode: (
        enc: AnyEncoder,
        value: ReadonlyCoreObject,
        opts?: CoreOptions,
      ) => enc.convertObject(value, opts),
      childrenOf: (value: ReadonlyCoreObject) => objectChildren(value),
    } satisfies CoreTypeOps,

    [CoreType.Dictionary]: {
      clone: (
        value: Dictionary<CoreKey, CoreValue>,
        context: CoreCloneContext,
        opts?: CoreValueCloneOpts,
      ) => {
        const newMap = new Map<CoreKey, CoreValue>();
        for (const [k, v] of value) {
          if (opts !== undefined && opts.fieldCloneOverride !== undefined) {
            newMap.set(
              k,
              opts.fieldCloneOverride(value as Dictionary, k, opts),
            );
          } else {
            newMap.set(k, cloneValue(v, context, opts));
          }
        }
        return newMap as unknown as CoreValue;
      },
      equals: (
        a: Dictionary<CoreKey, CoreValue>,
        b: Dictionary<CoreKey, CoreValue>,
      ) => dictEquals(a, b),
      encode: (
        enc: AnyEncoder,
        value: Dictionary<CoreKey, CoreValue>,
        opts?: CoreOptions,
      ) => enc.convertDictionary(value, opts),
      childrenOf: (value: Dictionary<CoreKey, CoreValue>) =>
        dictionaryChildren(value),
    } satisfies CoreTypeOps,

    [CoreType.Generator]: {
      clone: (
        value: Generator<CoreValue>,
        context: CoreCloneContext,
        opts?: CoreValueCloneOpts,
      ) => {
        const arr: CoreValue[] = [];
        for (const item of value) {
          if (opts !== undefined && opts.iterableFilter !== undefined) {
            if (opts.iterableFilter(item)) {
              arr.push(cloneValue(item, context, opts));
            }
          } else {
            arr.push(cloneValue(item, context, opts));
          }
        }
        return arr;
      },
      equals: (
        a: Generator<CoreValue>,
        b: Generator<CoreValue>,
        opts?: CoreOptions,
      ) => {
        const iterableFilter = opts && opts.iterableFilter;
        if (iterableFilter) {
          return equalsIterable(a, b, iterableFilter, opts);
        }

        while (true) {
          const v1 = a.next();
          const v2 = b.next();
          if (v1.done !== v2.done) {
            return false;
          }
          if (v1.done) {
            return true;
          }
          if (!coreValueEquals(v1.value, v2.value, opts)) {
            return false;
          }
        }
      },
      encode: (
        enc: AnyEncoder,
        value: Generator<CoreValue>,
        opts?: CoreOptions,
      ) => enc.convertGenerator(value, opts),
      childrenOf: () => kNoChildren,
    } satisfies CoreTypeOps,

    [CoreType.ClassObject]: {
      clone: (
        value: object,
        _context: CoreCloneContext,
        opts?: CoreValueCloneOpts,
      ) => {
        if (isClonable(value)) {
          return value.clone(opts) as CoreValue;
        }
        if (opts && opts.notClonableExt) {
          const fRes = opts.notClonableExt(value);
          if (fRes !== undefined) return fRes as CoreValue;
        }
        throw new Error(
          `${
            (value as { constructor: { name: string } })?.constructor
              .name
          } must be Clonable`,
        );
      },
      equals: (a: object, b: object) => {
        if (isEquatable(a) && a.constructor === b?.constructor) {
          return a.isEqual(b);
        }

        if (isComparable(a) && a.constructor === b?.constructor) {
          return a.compare(b) === 0;
        }

        return a === b;
      },
      encode: (
        enc: AnyEncoder,
        value: object,
        opts?: CoreOptions,
      ) => {
        if (isEncodable(value)) {
          return enc.convertEncodable(
            value as Encodable<CoreKey, CoreValue>,
            opts,
          );
        }
        throw new Error(
          `${
            (value as { constructor: { name: string } })?.constructor
              .name
          } must implement Encodable`,
        );
      },
      childrenOf: () => kNoChildren,
    } satisfies CoreTypeOps,
  } satisfies Record<CoreType, CoreTypeOps>,
);
