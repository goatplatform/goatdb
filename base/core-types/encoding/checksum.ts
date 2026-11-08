import { uniqueId } from '../../common.ts';
import { MurmurHash3 } from '../../hash.ts';
import { serializeDate } from '../../date.ts';
import { BaseEncoder } from './base-encoder.ts';
import type {
  CoreDictionary,
  CoreOptions,
  CoreValue,
  Encodable,
  ReadonlyCoreArray,
  ReadonlyCoreObject,
} from '../base.ts';
import { getCoreTypeOrUndef } from '../utils.ts';
import * as StreamMD5 from '../../../external/md5.ts';

export interface ChecksumEncoderOpts extends CoreOptions {
  // Require `typeSafe: true` where checksums must distinguish value types.
  typeSafe?: boolean;
  flatRep?: boolean;
  local?: boolean;
}

const gUnknownValuesHashes = new WeakMap<object, string>();

/** Merge instance defaults with per-call overrides. Both sides are the concrete
 * encoder's own opts type, so the result stays inside `OT` without a cast. */
function mergeOpts<OT extends ChecksumEncoderOpts>(
  defaults: OT | undefined,
  overrides: OT | undefined,
): OT | undefined {
  if (defaults === undefined) return overrides;
  if (overrides === undefined) return defaults;
  return { ...defaults, ...overrides };
}

export abstract class ChecksumEncoder<
  ST,
  OT extends ChecksumEncoderOpts = ChecksumEncoderOpts,
> extends BaseEncoder<string, string, OT> {
  private _data: { [key: string]: string };
  private _defaultOpts: OT | undefined;
  readonly typeSafe: boolean;

  constructor(opts?: OT) {
    super(opts);
    this._data = {};
    this.typeSafe = opts?.typeSafe === true;
    this._defaultOpts = opts;
  }

  /** Each concrete encoder names its own class. WHY not `this.constructor`:
   * it is typed `Function`, and a cast cannot prove that a subclass keeps the
   * same constructor arity (TypeScript has no `abstract static`). The abstract
   * method forces every subclass to state its own class explicitly. */
  abstract override newEncoder(opts?: OT): ChecksumEncoder<ST, OT>;

  getOutput(): string {
    const data = this._data;
    const keys = Object.keys(data).sort();
    const typeSafe = this.typeSafe;
    let state = this.newState();
    for (const k of keys) {
      state = this.appendValue(state, typeSafe ? 'k' + k : k);
      state = this.appendValue(state, data[k]);
    }
    return this.finalizeState(state);
  }

  protected getDefaultOpts(): OT | undefined {
    return this._defaultOpts;
  }

  protected setPrimitive(key: string, value: string, _options?: OT): void {
    this._data[key] = value;
  }

  protected isNativeValue(value: CoreValue, options?: OT): value is string {
    const typeSafe = typeof options?.typeSafe === 'boolean'
      ? options.typeSafe
      : this.typeSafe;
    return typeSafe ? false : typeof value === 'string';
  }

  checksumForValue(value: CoreValue | object, options?: OT): string {
    return this.checksumForString(this.convertValue(value, options));
  }

  override convertValue(value: CoreValue | object, options?: OT): string {
    const type = getCoreTypeOrUndef(value);
    if (type === undefined) {
      let v = gUnknownValuesHashes.get(value as object);
      if (!v) {
        v = uniqueId();
        gUnknownValuesHashes.set(value as object, v);
      }
      return v;
    }
    const converted = super.convertValue(value as CoreValue, options);
    const typeSafe = typeof options?.typeSafe === 'boolean'
      ? options.typeSafe
      : this.typeSafe;
    return typeSafe ? String(type) + converted : converted;
  }

  convertEncodable(
    value: Encodable<string, CoreValue>,
    options?: OT,
  ): string {
    // No opts: nested encoders restart from the default Murmur3 seed. A
    // forwarded custom seed would change checksums and break the goldens.
    const encoder = this.newEncoder();
    value.serialize(encoder, options);
    return encoder.getOutput();
  }

  convertSet(set: Set<CoreValue>, options?: OT): string {
    const checksums: string[] = [];

    const iterableFilter = options?.iterableFilter || this.iterableFilter;
    for (const v of set) {
      if (iterableFilter === undefined || iterableFilter(v)) {
        checksums.push(this.checksumForValue(v, options));
      }
    }
    checksums.sort();
    return this.convertArray(checksums);
  }

  convertArray(arr: ReadonlyCoreArray, options?: OT): string {
    const state = this.newState();
    const iterableFilter = options?.iterableFilter || this.iterableFilter;

    for (const v of arr) {
      if (iterableFilter === undefined || iterableFilter(v)) {
        this.appendValue(state, this.convertValue(v, options));
      }
    }
    return this.finalizeState(state);
  }

  convertGenerator(g: Generator<CoreValue>, options?: OT): string {
    const state = this.newState();
    const iterableFilter = options?.iterableFilter || this.iterableFilter;
    for (const v of g) {
      if (iterableFilter === undefined || iterableFilter(v)) {
        this.appendValue(state, this.convertValue(v, options));
      }
    }
    return this.finalizeState(state);
  }

  convertObject(obj: ReadonlyCoreObject, options?: OT): string {
    const encoder = this.newEncoder(
      mergeOpts(this.getDefaultOpts(), options),
    );
    // We use an inner encoder which sorts the keys and generates a consistent
    // value.
    const keyFilter = options?.objectFilterFields || this.objectFilterFields;
    for (const k in obj) {
      if (keyFilter(k, obj)) {
        encoder.set(k, obj[k]);
      }
    }
    return encoder.getOutput();
  }

  convertNumber(n: number, _options?: OT): string {
    return String(n);
  }

  convertBoolean(b: boolean, _options?: OT): string {
    return b ? 'true' : 'false';
  }

  convertString(str: string, _options?: OT): string {
    return str;
  }

  convertNull(_options?: OT): string {
    return 'null';
  }

  convertUndefined(_options?: OT): string {
    return 'undefined';
  }

  convertDate(date: Date, _options?: OT): string {
    return String(serializeDate(date));
  }

  convertDictionary(value: CoreDictionary, _options?: OT) {
    const encoder = this.newEncoder();
    for (const [k, v] of value) {
      encoder.set(k, v);
    }
    return encoder.getOutput();
  }

  protected checksumForString(value: string, options?: OT): string {
    return this.finalizeState(
      this.appendValue(this.newState(options), value, options),
      options,
    );
  }

  protected abstract newState(options?: OT): ST;
  protected abstract appendValue(state: ST, value: string, options?: OT): ST;
  protected abstract finalizeState(state: ST, options?: OT): string;
}

export class MD5Checksum<
  OT extends ChecksumEncoderOpts = ChecksumEncoderOpts,
> extends ChecksumEncoder<StreamMD5.MD5State, OT> {
  override newEncoder(opts?: OT) {
    return new MD5Checksum<OT>(opts);
  }

  protected newState() {
    return StreamMD5.init();
  }

  protected appendValue(state: StreamMD5.MD5State, value: string) {
    StreamMD5.update(state, value);
    return state;
  }
  protected finalizeState(state: StreamMD5.MD5State): string {
    return StreamMD5.finalize(state);
  }
}

export interface Murmur3Opts extends ChecksumEncoderOpts {
  seed?: number;
}

export class Murmur3Checksum extends ChecksumEncoder<MurmurHash3, Murmur3Opts> {
  readonly _seed: number;

  constructor(options?: Murmur3Opts) {
    if (options === undefined) {
      options = {};
    }
    if (options.seed === undefined) {
      // By default, start with the same seed for everyone
      options.seed = 3172939476544195;
    }
    super(options);
    this._seed = options.seed;
  }

  override newEncoder(opts?: Murmur3Opts) {
    return new Murmur3Checksum(opts);
  }

  protected newState(options?: Murmur3Opts): MurmurHash3 {
    return new MurmurHash3(options?.seed || this._seed);
  }

  protected appendValue(
    state: MurmurHash3,
    value: string,
    _options?: Murmur3Opts,
  ) {
    state.hash(value);
    return state;
  }
  protected finalizeState(state: MurmurHash3, _options?: Murmur3Opts): string {
    return String(state.result());
  }
}
