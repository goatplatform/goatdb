export type {
  ConstructorDecoderConfig,
  Decodable,
  DecodableKey,
  DecodedValue,
  Decoder,
  OwnedDecoder,
  ReadonlyDecodedArray,
  ReadonlyDecodedObject,
} from './types.ts';

export { isDecoderConfig } from './utils.ts';

// Single barrel for the encoding surface (json/checksum/cyclical/hash).
export {
  JSONCyclicalDecoder,
  JSONCyclicalEncoder,
  JSONDecoder,
  JSONEncoder,
} from './json.ts';

export {
  ChecksumEncoder,
  type ChecksumEncoderOpts,
  MD5Checksum,
  Murmur3Checksum,
  type Murmur3Opts,
} from './checksum.ts';

export {
  BaseCyclicalEncoder,
  type EncodedRef,
  type EncodedRefObject,
  isEncodedRef,
  isEncodedRefObject,
} from './cyclical.ts';

export { encodableValueHash } from './hash.ts';
