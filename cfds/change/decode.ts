import { Change, ChangeType, EncodedChange } from './index.ts';
import { Decoder } from '../../base/core-types/encoding/index.ts';
import { FieldChange } from './field-change.ts';
import { RichTextChange } from './richtext-change.ts';
import { notReached } from '../../base/error.ts';

export function decodeChange<EC extends EncodedChange = EncodedChange>(
  decoder: Decoder<keyof EC & string>
): Change<EC> {
  const type = decoder.get('changeType') as ChangeType;
  switch (type) {
    case 'fd':
      return new FieldChange({ decoder }) as Change<EC>;
    case 'rt':
      return new RichTextChange({ decoder }) as Change<EC>;
    default:
      notReached('Unsupported format: ' + type);
  }
}
