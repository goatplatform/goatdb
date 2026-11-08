import { isGenerator, isObject } from '../../comparisons.ts';
import type {
  JSONArray,
  JSONObject,
  JSONValue,
  ReadonlyJSONArray,
  ReadonlyJSONObject,
  ReadonlyJSONValue,
} from '../../interfaces.ts';
import { serializeDate } from '../../date.ts';
import {
  type Dictionary,
  dictToPrimitive,
  isDictionary,
} from '../../collections/dict.ts';
import {
  type CoreKey,
  type CoreOptions,
  CoreType,
  type CoreValue,
  type Encodable,
  type Encoder,
  type IterableFilterFunc,
  type ObjFieldsFilterFunc,
  type ReadonlyCoreArray,
  type ReadonlyCoreObject,
} from '../base.ts';
import { getCoreType, isEncodable } from '../utils.ts';
import { kTypeOps } from '../type-ops.ts';

export abstract class BaseEncoder<
  PT extends CoreValue,
  T extends PT,
  OT extends CoreOptions,
> implements Encoder<string, CoreValue, T, OT> {
  readonly objectFilterFields: ObjFieldsFilterFunc;
  readonly iterableFilter?: IterableFilterFunc;

  constructor(opts?: OT) {
    this.objectFilterFields = opts?.objectFilterFields || (() => true);
    this.iterableFilter = opts?.iterableFilter;
  }

  abstract getOutput(): T;
  abstract newEncoder(): BaseEncoder<PT, T, OT>;

  protected abstract setPrimitive(key: string, value: PT, options?: OT): void;

  set(key: CoreKey, value: CoreValue, options?: OT): void {
    if (value === undefined) {
      return;
    }

    this.setPrimitive(
      this.convertKey(key),
      this.convertValue(value, options),
      options,
    );
  }

  protected abstract isNativeValue(value: CoreValue, options?: OT): value is PT;

  protected convertKey(key: CoreKey): string {
    return typeof key === 'string' ? key : String(key);
  }

  convertValue(value: CoreValue, options?: OT): PT {
    if (this.isNativeValue(value, options)) {
      return value as PT;
    }

    return kTypeOps[getCoreType(value)].encode(this, value, options) as PT;
  }

  // Public: the dispatch table (type-ops.ts) is a caller. Subclasses still
  // override these to define encoding behavior.
  abstract convertString(str: string, options?: OT): PT;
  abstract convertNumber(n: number, options?: OT): PT;
  abstract convertBoolean(b: boolean, options?: OT): PT;
  abstract convertNull(options?: OT): PT;
  abstract convertUndefined(options?: OT): PT;
  abstract convertDate(date: Date, options?: OT): PT;
  abstract convertArray(arr: ReadonlyCoreArray, options?: OT): PT;
  abstract convertSet(set: Set<CoreValue>, options?: OT): PT;
  abstract convertObject(obj: ReadonlyCoreObject, options?: OT): PT;
  abstract convertEncodable(
    value: Encodable<string, CoreValue>,
    options?: OT,
  ): PT;
  abstract convertDictionary(
    value: Dictionary<CoreKey, CoreValue>,
    options?: OT,
  ): PT;

  abstract convertGenerator(g: Generator<CoreValue>, options?: OT): PT;
}

export interface EncodedSet extends ReadonlyJSONObject {
  readonly __t: 'S';
  readonly __v: ReadonlyJSONArray;
}

export interface EncodedDate extends ReadonlyJSONObject {
  readonly __t: 'D';
  readonly __v: number;
}

export interface EncodedEncodable extends ReadonlyJSONObject {
  readonly __t: 'E';
  readonly __v: ReadonlyJSONValue;
}

export type EncodedJSONValue = EncodedSet | EncodedDate | EncodedEncodable;

function isEncodedTag(
  v: ReadonlyJSONValue,
  tag: 'S' | 'D' | 'E',
  check: (v: ReadonlyJSONValue) => boolean,
): boolean {
  if (getCoreType(v) !== CoreType.Object) return false;
  const obj = v as ReadonlyJSONObject;
  return obj.__t === tag && check(obj.__v);
}

export const isEncodedSet = (v: ReadonlyJSONValue): v is EncodedSet =>
  isEncodedTag(v, 'S', (x) => x instanceof Array);
export const isEncodedDate = (v: ReadonlyJSONValue): v is EncodedDate =>
  isEncodedTag(v, 'D', (x) => typeof x === 'number');
export const isEncodedEncodable = (
  v: ReadonlyJSONValue,
): v is EncodedEncodable =>
  isEncodedTag(v, 'E', (x) => getCoreType(x) === CoreType.Object);

export abstract class JSONBaseEncoder<
  T extends ReadonlyJSONValue,
  OT extends CoreOptions = CoreOptions,
> extends BaseEncoder<ReadonlyJSONValue, T, OT> {
  abstract override getOutput(): T;
  abstract override newEncoder(): JSONBaseEncoder<T, OT>;

  protected abstract override setPrimitive(
    key: string,
    value: ReadonlyJSONValue,
    options?: OT,
  ): void;

  protected isNativeValue(
    value: CoreValue,
    options?: OT,
  ): value is ReadonlyJSONValue {
    if (value === undefined || value === null) return true;
    if (isEncodable<Encodable<string, CoreValue>>(value)) return false;
    if (value instanceof Array) {
      const iterableFilter = options?.iterableFilter || this.iterableFilter;
      for (const v of value) {
        if (iterableFilter && !iterableFilter(v)) return false;
        if (!this.isNativeValue(v, options)) return false;
      }
      return true;
    }
    if (
      value instanceof Set ||
      value instanceof Date ||
      isDictionary(value)
    ) {
      return false;
    }
    if (isObject(value)) {
      const obj: ReadonlyCoreObject = value as ReadonlyCoreObject;
      const keyFilter = options?.objectFilterFields || this.objectFilterFields;
      for (const k in obj) {
        if (!Object.hasOwn(obj, k)) continue;
        if (keyFilter && !keyFilter(k, obj)) return false;
        if (!this.isNativeValue(obj[k], options)) return false;
      }
      return true;
    }
    // Non-Encodable class instances pass through unchanged. JSON encode paths
    // never reach the ClassObject "must implement Encodable" throw;
    // encodableValueHash/checksum paths still do. Do not delete that throw.
    // See CHANGELOG Known Quirks.
    return !isGenerator(value);
  }

  convertEncodable(
    value: Encodable<string, CoreValue>,
    options?: OT,
  ): EncodedEncodable {
    const encoder = this.newEncoder();
    value.serialize(encoder, options);
    return {
      __t: 'E',
      __v: encoder.getOutput(),
    };
  }

  private convertIterableWithFilter(
    iterable: Iterable<CoreValue>,
    iterableFilter: IterableFilterFunc,
    options?: OT,
  ) {
    const result: JSONValue[] = [];
    for (const item of iterable) {
      if (iterableFilter(item)) {
        result.push(this.convertValue(item, options));
      }
    }
    return result;
  }

  convertArray(
    arr: ReadonlyCoreArray,
    options?: OT,
  ): ReadonlyJSONValue {
    if (arr.length === 0) {
      return [];
    }
    const iterableFilter = options?.iterableFilter || this.iterableFilter;
    if (iterableFilter) {
      return this.convertIterableWithFilter(arr, iterableFilter, options);
    }

    const result = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      result[i] = this.convertValue(arr[i], options);
    }
    return result;
  }

  // Default implementation returns EncodedSet
  convertSet(set: Set<CoreValue>, options?: OT): EncodedSet {
    const iterableFilter = options?.iterableFilter || this.iterableFilter;
    if (iterableFilter) {
      const arr = this.convertIterableWithFilter(set, iterableFilter, options);

      return {
        __t: 'S',
        __v: arr as ReadonlyJSONArray,
      };
    }

    const arr: JSONArray = new Array(set.size);
    let i = 0;

    for (const v of set) {
      arr[i] = this.convertValue(v, options);
      i++;
    }
    return {
      __t: 'S',
      __v: arr as ReadonlyJSONArray,
    };
  }

  convertObject(
    obj: ReadonlyCoreObject,
    options?: OT,
  ): ReadonlyJSONObject {
    const result: JSONObject = {};
    const keyFilter = options?.objectFilterFields || this.objectFilterFields;
    for (const [k, v] of Object.entries(obj)) {
      if (keyFilter(k, obj)) {
        result[k] = this.convertValue(v, options);
      }
    }
    return result;
  }

  convertNumber(n: number, _options?: OT): ReadonlyJSONValue {
    return n;
  }

  convertString(str: string, _options?: OT): ReadonlyJSONValue {
    return str;
  }

  convertBoolean(b: boolean, _options?: OT): ReadonlyJSONValue {
    return b;
  }

  convertNull(_options?: OT): ReadonlyJSONValue {
    return null;
  }

  convertUndefined(_options?: OT): ReadonlyJSONValue {
    return null;
  }

  convertDate(date: Date, _options?: OT): EncodedDate {
    return {
      __t: 'D',
      __v: serializeDate(date),
    };
  }

  convertDictionary(
    value: Dictionary<CoreKey, CoreValue>,
    _options?: OT,
  ) {
    return dictToPrimitive(value);
  }

  convertGenerator(g: Generator<CoreValue>, options?: OT) {
    const iterableFilter = options?.iterableFilter || this.iterableFilter;
    if (iterableFilter) {
      return this.convertIterableWithFilter(g, iterableFilter, options);
    }

    const arr: JSONArray = [];
    for (const v of g) {
      arr.push(this.convertValue(v, options));
    }
    return arr;
  }
}
