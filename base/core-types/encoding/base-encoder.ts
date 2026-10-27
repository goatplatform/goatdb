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
import { type Dictionary, isDictionary } from '../../collections/dict.ts';
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

export function isEncodedSet(v: ReadonlyJSONValue): v is EncodedSet {
  if (getCoreType(v) === CoreType.Object) {
    const obj = v as ReadonlyJSONObject;
    if (obj.__t === 'S' && obj.__v instanceof Array) {
      return true;
    }
  }
  return false;
}

export function isEncodedDate(v: ReadonlyJSONValue): v is EncodedDate {
  if (getCoreType(v) === CoreType.Object) {
    const obj = v as ReadonlyJSONObject;
    if (obj.__t === 'D' && typeof obj.__v === 'number') {
      return true;
    }
  }
  return false;
}

export function isEncodedEncodable(
  v: ReadonlyJSONValue,
): v is EncodedEncodable {
  if (getCoreType(v) === CoreType.Object) {
    const obj = v as ReadonlyJSONObject;
    if (obj.__t === 'E' && getCoreType(obj.__v) === CoreType.Object) {
      return true;
    }
  }
  return false;
}

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
    if (value === undefined || value === null) {
      return true;
    }

    const iterableFilter = options?.iterableFilter || this.iterableFilter;
    if (isEncodable<Encodable<string, CoreValue>>(value)) {
      // Encodable
      return false;
    } else if (value instanceof Array) {
      // Array
      for (const v of value) {
        if (iterableFilter) {
          if (!iterableFilter(v)) return false;
        }
        if (!this.isNativeValue(v, options)) {
          return false;
        }
      }
    } else if (value instanceof Set) {
      // Set
      return false;
    } else if (value instanceof Date) {
      // Date
      return false;
    } else if (isDictionary(value)) {
      return false;
    } else if (isObject(value)) {
      // Object
      const obj: ReadonlyCoreObject = value as ReadonlyCoreObject;

      const keyFilter = options?.objectFilterFields || this.objectFilterFields;
      for (const k in obj) {
        if (Object.hasOwn(obj, k)) {
          if (keyFilter && !keyFilter(k, obj)) {
            return false;
          }
          if (!this.isNativeValue(obj[k], options)) {
            return false;
          }
        }
      }
    } else if (isGenerator(value)) {
      return false;
    }
    // Everything else
    return true;
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
    options?: OT,
  ): JSONObject {
    // WHY: every dictionary value must pass through the shared value encoder.
    // Copying raw values (dictToPrimitive) skipped Date/Set/Encodable tagging,
    // so a Date in a map field landed as an ISO string while its checksum
    // tagged it as a Date, marking the commit corrupted on reload.
    const result: JSONObject = {};
    for (const [k, v] of value) {
      result[this.convertKey(k)] = this.convertValue(v, options);
    }
    return result;
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
