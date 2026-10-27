import { PrimitiveTypeOperations } from './primitive-type.ts';
import type { DecodedValue } from '../../../base/core-types/encoding/index.ts';
import { assert } from '../../../base/error.ts';

/**
 * `date` intentionally inherits the generic serialize path (issue #58 §5):
 * `BaseEncoder.set` routes a `Date` through `convertDate`, yielding the single
 * wire form `{__t:'D', __v}` in typed fields and nested positions alike. The old
 * typed-field override that wrote a bare number is gone; the number/wrapper
 * duality no longer exists.
 */
export class DateTypeOperations extends PrimitiveTypeOperations<Date> {
  constructor() {
    super('date');
  }

  /**
   * Reject a legacy bare-number date before it lands silently in a `date` field
   * (issue #58 §5). Pre-0.7 stores and peers wrote a bare number, and the
   * decoder cannot tell it from a Number, so mixed-version data must fail loudly
   * instead of corrupting the field type.
   */
  override deserialize(value: DecodedValue): Date {
    assert(
      typeof value !== 'number',
      'Legacy date value (bare number) is not supported. ' +
        'Delete the store and re-sync it.',
    );
    assert(
      value instanceof Date,
      'Date field expected a Date value after decode.',
    );
    return value as Date;
  }
}
