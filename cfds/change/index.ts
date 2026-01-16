import { assert } from '../../base/error.ts';
import {
  ConstructorDecoderConfig,
  Decoder,
  isDecoderConfig,
} from '../../base/core-types/encoding/index.ts';
import {
  Clonable,
  CoreValue,
  Encodable,
  Encoder,
  Equatable,
  ReadonlyCoreObject,
} from '../../base/core-types/index.ts';
import { CoreValueCloneOpts } from '../../base/core-types/base.ts';

export type ChangeType = 'fd' | 'rt' | 'rt-2';

export interface EncodedChange extends ReadonlyCoreObject {
  readonly changeType: ChangeType;
}

export interface ChangeValueConfig {}

export abstract class Change<EC extends EncodedChange>
  implements Encodable<keyof EC, CoreValue>, Equatable, Clonable
{
  constructor(config?: ChangeValueConfig | ConstructorDecoderConfig<EC>) {
    if (isDecoderConfig(config)) {
      // Safe cast: EC extends EncodedChange which always has changeType
      const decoder = config.decoder as unknown as Decoder<
        keyof EncodedChange & string
      >;
      assert(decoder.get('changeType') === this.getType());
    }
  }

  abstract getType(): ChangeType;

  serialize(encoder: Encoder<keyof EC, CoreValue>, _options?: unknown): void {
    encoder.set('changeType', this.getType());
  }

  abstract isEqual(other: Change<EC>): boolean;

  abstract clone<T extends Change<EC>>(opts?: CoreValueCloneOpts): T;
}
