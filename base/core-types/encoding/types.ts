import type { ReadonlyJSONValue } from '../../interfaces.ts';

export type ReadonlyDecodedObject = {
  readonly [key: string]: DecodedValue;
};

export type DecodableKey = string;

export type ReadonlyDecodedArray = readonly DecodedValue[];

export type DecodedValue =
  | ReadonlyJSONValue
  | Date
  | Set<DecodedValue>
  | ReadonlyDecodedObject
  | ReadonlyDecodedArray
  | OwnedDecoder<DecodableKey, DecodedValue>;

// A decoder whose lifetime the caller owns: `Decoder & Disposable`. Declared
// as an interface (not a type alias) so the DecodedValue union can reference it
// recursively. Every decoder factory returns one, so `using` deterministically
// disposes it (pooling recycled instances and balancing the L4 count). See
// encoding/json.ts.
export interface OwnedDecoder<
  K extends DecodableKey = DecodableKey,
  V extends DecodedValue = DecodedValue,
> extends Decoder<K, V>, Disposable {}

export interface Decoder<
  K extends DecodableKey = DecodableKey,
  V extends DecodedValue = DecodedValue,
> {
  get<T extends V>(key: K, defaultValue?: T): T | typeof defaultValue;
  has(key: K): boolean;
  getDecoder(key: K, offset?: number): OwnedDecoder<K, V>;
  finalize?(): void;
}

export function isDecoder<
  K extends DecodableKey = DecodableKey,
  V extends DecodedValue = DecodedValue,
>(v: DecodedValue): v is OwnedDecoder<K, V> {
  return typeof (v as Decoder<K, V>).getDecoder === 'function';
}

export interface Decodable<
  K extends DecodableKey = DecodableKey,
  V extends DecodedValue = DecodedValue,
  OT = unknown,
> {
  deserialize(decoder: Decoder<K, V>, options?: OT): void;
}

export interface ConstructorDecoderConfig<T = object> {
  readonly decoder: Decoder<keyof T & string>;
}
