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
import { CoreType } from '../base.ts';
import { getCoreTypeOrUndef } from '../utils.ts';
import * as StreamMD5 from '../../../external/md5.ts';

export interface ChecksumEncoderOpts extends CoreOptions {
  // Require `typeSafe: true` for untrusted input. A plain string such as
  // "41700000000" collides with Date (tag "4" + epoch seconds). Type-safe
  // checksums prefix each type, which separates the colliding string.
  typeSafe?: boolean;
  flatRep?: boolean;
  local?: boolean;
}

const gUnknownValuesHashes = new WeakMap<object, string>();

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

  newEncoder() {
    return this.newEncoderInstance();
  }

  /** Same concrete class, no ctor args (Murmur3 seed MUST reset). WHY: the
   * pre-table `newInstance(this)` also passed no args, so nested encoders
   * always restart from the default seed. Preserving a custom seed here
   * would change checksums and break goldens. `convertObject` is the only
   * path that forwards opts (via `newEncoderWithOpts`). */
  private newEncoderInstance(): ChecksumEncoder<ST, OT> {
    return new (this.constructor as new () => ChecksumEncoder<ST, OT>)();
  }

  /** Same concrete class with a single opts arg. */
  private newEncoderWithOpts(
    opts: ChecksumEncoderOpts,
  ): ChecksumEncoder<ST, OT> {
    return new (this.constructor as new (
      opts: ChecksumEncoderOpts,
    ) => ChecksumEncoder<ST, OT>)(opts);
  }

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
    // A Date tags as Date in every checksum position (issue #58 §5). Nested
    // Dates tag only when typeSafe is true, yet the typed-field path drops
    // typeSafe before BaseEncoder.set, so an untagged top-level Date collides
    // with a Number. Unconditional Date tagging removes that Date-vs-Number
    // asymmetry. Limit: non-typeSafe strings stay untagged, so a string such
    // as "41700000000" can still collide with a tagged Date. Use typeSafe
    // checksums where untrusted input matters; no other gate changes.
    if (type === CoreType.Date) {
      return String(type) + converted;
    }
    const typeSafe = typeof options?.typeSafe === 'boolean'
      ? options.typeSafe
      : this.typeSafe;
    return typeSafe ? String(type) + converted : converted;
  }

  convertEncodable(
    value: Encodable<string, CoreValue>,
    options?: OT,
  ): string {
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
    const encoder = this.newEncoderWithOpts({
      ...this.getDefaultOpts(),
      ...options,
    });
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
