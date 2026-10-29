import type { DecodedValue } from '../../../base/core-types/encoding/index.ts';
import type {
  IterableFilterFunc,
  ObjFieldsFilterFunc,
} from '../../../base/core-types/base.ts';
import type { Change, EncodedChange } from '../../change/index.ts';
import { MapTypeOperations } from './map-type.ts';
import { PrimitiveTypeOperations } from './primitive-type.ts';
import { SetTypeOperations } from './set-type.ts';
import { RichText3TypeOperations } from './richtext3-type.ts';
import type { CoreValue, Encoder } from '../../../base/core-types/index.ts';
import { DateTypeOperations } from './date-type.ts';

export { kValueTypeCoreTypes, type ValueType } from './value-type.ts';
import type { ValueType } from './value-type.ts';

/**
 * Options common to value-type operations. `local`/`byCharacter` describe
 * richtext semantics, but the generic entry points (cfds/base/object.ts) pass
 * one opaque options object to every type op, so they must be visible here.
 * This is the single source of truth: `SerializeValueTypeOptions` and
 * `RichTextSerializeOptions` inherit these fields instead of redeclaring them.
 */
export interface ValueTypeOptions {
  local?: boolean;
  byCharacter?: boolean;
}

export interface SerializeValueTypeOptions extends ValueTypeOptions {
  objectFilterFields?: ObjFieldsFilterFunc;
  iterableFilter?: IterableFilterFunc;
}

export interface IValueTypeOperations<T extends CoreValue = CoreValue> {
  get valueType(): ValueType;

  clone(value: T): T;

  equals(val1: T, val2: T, options?: ValueTypeOptions): boolean;

  validate(value: CoreValue): boolean;

  serialize(
    key: string,
    value: T,
    encoder: Encoder,
    options?: SerializeValueTypeOptions,
  ): void;

  deserialize(value: DecodedValue, options?: ValueTypeOptions): T;

  /**
   * value for data1 is undefined, value2 should be added by diff
   * @param value2
   * @param type
   * @param options
   */
  valueAddedDiff(
    value2: T,
    options?: ValueTypeOptions,
  ): undefined | Change<EncodedChange> | Change<EncodedChange>[];

  /**
   * value for data2 is undefined, value1 should be deleted by diff
   * @param value1
   * @param type
   * @param options
   */
  valueRemovedDiff(
    value1: T,
    options?: ValueTypeOptions,
  ): undefined | Change<EncodedChange> | Change<EncodedChange>[];

  valueChangedDiff(
    value1: T,
    value2: T,
    options?: ValueTypeOptions,
  ): undefined | Change<EncodedChange> | Change<EncodedChange>[];

  patch(
    curValue: T | undefined,
    changes: Change<EncodedChange>[],
    options?: ValueTypeOptions,
  ): T | undefined;

  normalize(value: T): T;

  isEmpty(value: T): boolean;
}

/** Every `ValueType` has exactly one op set. `satisfies` + `Object.freeze`
 * make this exhaustive and immutable at compile time. */
const kTypeOperations = Object.freeze({
  string: new PrimitiveTypeOperations('string'),
  number: new PrimitiveTypeOperations('number'),
  boolean: new PrimitiveTypeOperations('boolean'),
  date: new DateTypeOperations(),
  set: new SetTypeOperations('set'),
  map: new MapTypeOperations('map'),
  richtext: new RichText3TypeOperations(),
}) satisfies Record<ValueType, IValueTypeOperations<CoreValue>>;

export function getTypeOperations<T extends CoreValue>(
  type: ValueType,
): IValueTypeOperations<T> {
  // `kTypeOperations` satisfies Record<ValueType, ...>, so the lookup is total.
  // Widen to the erased op type before narrowing to `T` (TS needs the step).
  const op: IValueTypeOperations<CoreValue> = kTypeOperations[type];
  return op as IValueTypeOperations<T>;
}

export function valueTypeEquals<TValue>(
  type: ValueType,
  value1: TValue | undefined,
  value2: TValue | undefined,
  options?: ValueTypeOptions,
) {
  if (value1 === undefined && value2 !== undefined) {
    return false;
  }
  if (value1 !== undefined && value2 === undefined) {
    return false;
  }
  if (value1 === undefined && value2 === undefined) {
    return true;
  }
  const typeOP = getTypeOperations(type);
  return typeOP.equals(value1 as CoreValue, value2 as CoreValue, options);
}
