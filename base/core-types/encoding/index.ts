export type {
  ConstructorDecoderConfig,
  Decodable,
  DecodableKey,
  DecodedValue,
  Decoder,
  ReadonlyDecodedArray,
  ReadonlyDecodedObject,
} from './types.ts';

export { isDecoderConfig } from './utils.ts';

// WHY no encoder re-exports: every consumer imports the concrete module.
// Re-exporting here would widen the module graph for no caller.
export { encodableValueHash } from './hash.ts';
