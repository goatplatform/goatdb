import type { CoreOptions, CoreValue } from '../base.ts';
import { Murmur3Checksum } from './checksum.ts';
import type { ChecksumEncoderOpts, Murmur3Opts } from './checksum.ts';

const kMurmurEncoder = new Murmur3Checksum({ typeSafe: false });

export function encodableValueHash(
  v: CoreValue | object,
  options?: CoreOptions | ChecksumEncoderOpts,
): string {
  return kMurmurEncoder.checksumForValue(v, options as Murmur3Opts);
}
