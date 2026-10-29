import type {
  JSONObject,
  JSONValue,
  ReadonlyJSONObject,
  ReadonlyJSONValue,
} from '../../interfaces.ts';
import {
  type CoreOptions,
  CoreType,
  type CoreValue,
  type Encoder,
} from '../base.ts';
import { getCoreType } from '../utils.ts';
import {
  isEncodedDate,
  isEncodedEncodable,
  isEncodedSet,
  JSONBaseEncoder,
} from './base-encoder.ts';
import {
  BaseCyclicalEncoder,
  type EncodedRef,
  isEncodedRef,
  isEncodedRefObject,
} from './cyclical.ts';
import type { DecodedValue, Decoder, OwnedDecoder } from './types.ts';
import { deserializeDate } from '../../date.ts';
import { assert } from '../../error.ts';
import type { Encodable } from '../index.ts';

// L4 accounting: number of decoders currently acquired but not yet disposed.
// Balanced by `_acquire()` on every acquire and `[Symbol.dispose]` on first
// release. The accessor below is for tests only; it is deliberately not
// re-exported from mod.ts.
let gOutstandingDecoders = 0;

/** @internal Test-visible L4 outstanding-decoder count. */
export function decoderOutstandingCount(): number {
  return gOutstandingDecoders;
}

export class JSONEncoder extends JSONBaseEncoder<ReadonlyJSONValue> {
  private _encodedObj: JSONObject;

  constructor() {
    super();
    this._encodedObj = {};
  }

  getOutput(): ReadonlyJSONObject {
    return this._encodedObj;
  }

  newEncoder() {
    return new JSONEncoder();
  }

  static toJS(value: CoreValue): ReadonlyJSONValue {
    const encoder = new this();
    return encoder.convertValue(value);
  }

  protected setPrimitive(
    key: string,
    value: ReadonlyJSONValue,
    _options?: unknown,
  ): void {
    this._encodedObj[key] = value;
  }
}

export class JSONCyclicalEncoder extends BaseCyclicalEncoder<
  number,
  ReadonlyJSONValue
> {
  private _encoder: JSONEncoder;

  constructor() {
    super();
    this._encoder = new JSONEncoder();
  }

  get encoder(): Encoder<string, CoreValue, ReadonlyJSONValue, CoreOptions> {
    return this._encoder;
  }
  get initRefId(): number {
    return 0;
  }
  nextRefId(prev: number): number {
    return prev + 1;
  }
  convertRef(refId: number, _options?: CoreOptions): ReadonlyJSONValue {
    const ref: EncodedRef = {
      __rId: refId,
    };
    return ref;
  }

  convertRefsMap(
    map: Map<CoreValue, number>,
    options?: CoreOptions,
  ): CoreValue {
    const refs = Array.from(map.entries())
      .sort((a, b) => a[1] - b[1])
      .map((e) => this._encoder.convertValue(e[0], options));

    return refs;
  }

  newEncoder(): Encoder<string, CoreValue, ReadonlyJSONValue, CoreOptions> {
    return new JSONCyclicalEncoder();
  }

  static serialize<T = unknown>(obj: Encodable, opts?: T): ReadonlyJSONObject {
    const encoder = new JSONCyclicalEncoder();
    obj.serialize(encoder, opts);
    return encoder.getOutput() as ReadonlyJSONObject;
  }
}

export class JSONDecoder implements Decoder {
  protected _data: ReadonlyJSONObject;
  // L3: set on dispose, cleared on re-acquire. Guards reads and re-pooling.
  protected _finalized = false;
  // L4: true while this instance is counted in gOutstandingDecoders.
  private _tracked = false;
  // Acquire generation. Bumped on every `_acquire`; a parent records a child's
  // generation and only cascades to it while that generation is still current.
  // WHY: a consumer can dispose a pooled child and another decode re-acquires
  // it; the parent must not then dispose the new owner's decoder.
  private _generation = 0;
  // L4: children created via decodeValue/getDecoder, each paired with the
  // generation seen when it was added. Disposed with the parent when still
  // current. Lazily allocated to avoid overhead for leaf decoders.
  protected _children:
    | { decoder: OwnedDecoder; generation: number }[]
    | undefined;

  constructor(encodedValue: ReadonlyJSONObject | undefined) {
    this._data = encodedValue || {};
  }

  /** Acquiring factory for roots (e.g. settings). Tracks L4 like children. */
  static get(encodedValue: ReadonlyJSONObject | undefined): JSONDecoder {
    const decoder = new JSONDecoder(encodedValue);
    decoder._acquire();
    return decoder;
  }

  /** L4 acquire accounting. Re-acquiring clears the disposed state (L3). */
  protected _acquire(): void {
    this._finalized = false;
    this._tracked = true;
    this._generation++;
    gOutstandingDecoders++;
  }

  /** L3/L4 release. Idempotent: a second call is a no-op and never re-pools. */
  [Symbol.dispose](): void {
    if (this._finalized) return;
    this._finalized = true;
    // Release tracked children first so their L4 count drops before ours. Skip
    // any child re-acquired since it was added (generation changed): it belongs
    // to a newer owner now and must stay alive.
    if (this._children) {
      for (const { decoder, generation } of this._children) {
        if ((decoder as JSONDecoder)._generation === generation) {
          decoder[Symbol.dispose]();
        }
      }
      this._children = undefined;
    }
    if (this._tracked) {
      this._tracked = false;
      gOutstandingDecoders--;
    }
  }

  protected _assertAlive(): void {
    assert(!this._finalized, 'JSON decoder used after dispose');
  }

  protected _addChild(child: OwnedDecoder): void {
    if (!this._children) this._children = [];
    this._children.push({
      decoder: child,
      generation: (child as JSONDecoder)._generation,
    });
  }

  get<T extends DecodedValue>(key: string, defaultValue?: T): T | undefined {
    this._assertAlive();
    if (!this.has(key)) {
      return defaultValue;
    }
    const val = this._data[key];
    // Primitives are returned as-is; every non-null object needs decoding.
    if (val === null || typeof val !== 'object') {
      return val as T;
    }
    return this.decodeValue(val) as T;
  }

  has(key: string): boolean {
    this._assertAlive();
    return Object.hasOwn(this._data, key);
  }

  getDecoder(
    key: string,
    offset?: number,
  ): OwnedDecoder<string, ReadonlyJSONValue> {
    this._assertAlive();
    let value = this._data[key];
    if (offset !== undefined && value instanceof Array) {
      value = value[offset];
    }
    if (value instanceof JSONDecoder) {
      return value;
    }
    // decodeValue handles {__t:'E'} by returning an already-acquired decoder
    // (tracked via _addChild inside decodeValue) — no extra acquire or tracking.
    const decoded = this.decodeValue(value);
    if (decoded instanceof JSONDecoder) {
      return decoded;
    }
    // Non-Encodable: wrap the raw value so the child decodes lazily.
    const child = new JSONDecoder(value as ReadonlyJSONObject | undefined);
    child._acquire();
    this._addChild(child);
    return child;
  }

  decodeValue(value: ReadonlyJSONValue): DecodedValue {
    this._assertAlive();
    if (value instanceof Array) {
      const res: DecodedValue[] = [];
      for (const v of value) {
        if (typeof v === 'object') {
          res.push(this.decodeValue(v));
        } else {
          res.push(v);
        }
      }
      return res;
    }
    if (isEncodedSet(value)) {
      const set = new Set<DecodedValue>();
      for (const v of value.__v) {
        set.add(this.decodeValue(v));
      }
      return set;
    }
    if (isEncodedDate(value)) {
      return deserializeDate(value.__v);
    }
    if (isEncodedEncodable(value)) {
      // Nested Encodable: acquire so the L4 total balances on dispose. The
      // child is tracked on _children so the parent's dispose releases it even
      // when the consumer never disposes the child directly (e.g. when it is
      // reached inside a decoded array via get()).
      const nested = new JSONDecoder(value.__v as ReadonlyJSONObject);
      nested._acquire();
      this._addChild(nested);
      return nested;
    }
    if (getCoreType(value) === CoreType.Object) {
      return this.decodeObject(value as ReadonlyJSONObject);
    }
    return value;
  }

  protected decodeObject(jsonObj: ReadonlyJSONObject): {
    [key: string]: DecodedValue;
  } {
    const obj: { [key: string]: DecodedValue } = {};
    for (const k in jsonObj) {
      let v = jsonObj[k];
      if (
        v instanceof Array ||
        isEncodedSet(v) ||
        isEncodedDate(v) ||
        isEncodedEncodable(v) ||
        getCoreType(v) === CoreType.Object
      ) {
        v = this.decodeValue(v as ReadonlyJSONValue) as JSONValue;
      }
      obj[k] = v;
    }
    return obj;
  }
}

// Pool of finalized cyclical decoders, reused LIFO to avoid allocation on the
// .goat/JSON read path. Membership is managed exclusively by
// `JSONCyclicalDecoder.get` (pop) and `[Symbol.dispose]`/`finalize` (push).
// WHY: the pool is bounded so a peak of transient nested decoders cannot pin
// memory on long-lived processes; overflow decoders are dropped for GC and
// counted (test-only) via decoderPoolDroppedCount.
export const kMaxActiveDecoders = 32;
const gActiveDecoders: JSONCyclicalDecoder[] = [];
let gPoolDrops = 0;

/** @internal Test-visible count of pool-overflow drops. */
export function decoderPoolDroppedCount(): number {
  return gPoolDrops;
}

export class JSONCyclicalDecoder extends JSONDecoder {
  private _tempRefs?: ReadonlyJSONObject[][];
  declare protected _data: ReadonlyJSONObject;

  private constructor(encodedValue: ReadonlyJSONObject | undefined) {
    super(encodedValue);
  }

  static override get(
    encodedValue: ReadonlyJSONObject | undefined,
  ): JSONCyclicalDecoder {
    let r = gActiveDecoders.pop();
    if (r) {
      r._tempRefs = undefined;
      r._data = encodedValue || {};
    } else {
      r = new JSONCyclicalDecoder(encodedValue);
    }
    r._acquire();
    return r;
  }

  override [Symbol.dispose](): void {
    if (this._finalized) return;
    super[Symbol.dispose]();
    if (gActiveDecoders.length < kMaxActiveDecoders) {
      gActiveDecoders.push(this);
    } else {
      gPoolDrops++;
    }
  }

  /**
   * Named alias for `[Symbol.dispose]`; kept for callers not using `using`.
   *
   * Dispose at most once per acquire. This instance is pooled and re-acquired
   * by later decodes, so calling dispose again through a stale reference
   * releases the *new* owner's decoder. `using` guarantees single disposal.
   */
  finalize(): void {
    this[Symbol.dispose]();
  }

  override decodeValue(value: ReadonlyJSONValue): DecodedValue {
    this._assertAlive();
    if (isEncodedRefObject(value)) {
      if (!this._tempRefs) this._tempRefs = [];
      this._tempRefs.push(value.__r);
      const obj = this.decodeObject(value.__d);
      this._tempRefs.pop();
      return obj;
    }
    return super.decodeValue(value);
  }

  protected override decodeObject(jsonObj: ReadonlyJSONObject): {
    [key: string]: DecodedValue;
  } {
    if (isEncodedRef(jsonObj)) {
      // WHY: a lone `{__rId}` outside `__r/__d` is corrupt input, never
      // data. Fail loudly like bare-number dates and legacy refs. Wider
      // shapes (e.g. `{__rId:5,other:1}`) are legal user data: fall through
      // as plain objects so the stray assert never fires on them.
      if (Object.keys(jsonObj).length !== 1) return super.decodeObject(jsonObj);
      assert(
        this._tempRefs !== undefined,
        'Stray __rId ref without __r/__d context',
      );
      const refs = this._tempRefs[this._tempRefs.length - 1];
      return refs[jsonObj.__rId as number];
    }
    return super.decodeObject(jsonObj);
  }

  override getDecoder(
    key: string,
    offset?: number,
  ): OwnedDecoder<string, ReadonlyJSONValue> {
    this._assertAlive();
    let value = this._data[key];
    if (isEncodedEncodable(value)) {
      value = value.__v;
    }
    if (offset !== undefined && value instanceof Array) {
      value = value[offset];
    }
    if (isEncodedEncodable(value)) {
      value = value.__v;
    }
    if (value instanceof JSONDecoder) {
      return value;
    }
    const child = JSONCyclicalDecoder.get(value as ReadonlyJSONObject);
    this._addChild(child);
    return child;
  }
}
