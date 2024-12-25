import { deserializeDate, serializeDate } from '../../../base/date.ts';
import { ValueTypeOptions } from './index.ts';
import { CoreType } from '../../../base/core-types/index.ts';
import { DecodedValue } from '../../../base/core-types/encoding/index.ts';
import { PrimitiveTypeOperations } from './primitive-type.ts';
import { Encoder } from '../../../base/core-types/base.ts';

export class DateTypeOperations extends PrimitiveTypeOperations<Date> {
  constructor() {
    super(CoreType.Date, 'date');
  }

  deserialize(value: DecodedValue, options?: ValueTypeOptions) {
    const date = super.deserialize(value, options);
    if (typeof date === 'number') {
      return deserializeDate(date);
    }
    return date;
  }

  serialize(
    key: string,
    value: Date,
    encoder: Encoder,
    options?: ValueTypeOptions,
  ): void {
    encoder.set(key, serializeDate(value));
  }
}
