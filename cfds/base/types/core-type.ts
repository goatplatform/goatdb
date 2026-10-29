import type { IValueTypeOperations, ValueTypeOptions } from './index.ts';
import { kValueTypeCoreTypes, type ValueType } from './value-type.ts';
import type { DecodedValue } from '../../../base/core-types/encoding/index.ts';
import type { Change, EncodedChange } from '../../change/index.ts';
import { FieldChange } from '../../change/field-change.ts';
import {
  type ConcreteCoreValue,
  type CoreType,
  coreValueClone,
  coreValueEquals,
  type Encoder,
  getCoreTypeOrUndef,
} from '../../../base/core-types/index.ts';

export abstract class CoreTypeOperations<
  TValue extends ConcreteCoreValue = ConcreteCoreValue,
> implements IValueTypeOperations<TValue> {
  private _coreType: CoreType;
  private _valueType: ValueType;

  constructor(valueType: ValueType) {
    this._coreType = kValueTypeCoreTypes[valueType];
    this._valueType = valueType;
  }

  get valueType() {
    return this._valueType;
  }

  normalize(value: TValue): TValue {
    return value;
  }

  validate(value: unknown): boolean {
    return getCoreTypeOrUndef(value) === this._coreType;
  }

  equals(val1: TValue, val2: TValue, _options?: ValueTypeOptions): boolean {
    return coreValueEquals(val1, val2);
  }

  clone(value: TValue) {
    return coreValueClone(value);
  }

  serialize(
    key: string,
    value: TValue,
    encoder: Encoder,
    _options?: ValueTypeOptions,
  ): void {
    encoder.set(key, value);
  }

  deserialize(value: DecodedValue, _options?: ValueTypeOptions) {
    return value as TValue;
  }

  valueAddedDiff(
    value2: TValue,
    _options?: ValueTypeOptions,
  ): undefined | Change<EncodedChange> | Change<EncodedChange>[] {
    return FieldChange.insert(value2, this._valueType);
  }

  valueRemovedDiff(
    value1: TValue,
    _options?: ValueTypeOptions,
  ): undefined | Change<EncodedChange> | Change<EncodedChange>[] {
    return FieldChange.delete(value1, this._valueType);
  }

  abstract valueChangedDiff(
    value1: TValue,
    value2: TValue,
    options?: ValueTypeOptions,
  ): Change<EncodedChange> | Change<EncodedChange>[] | undefined;

  abstract patch(
    curValue: TValue | undefined,
    changes: Change<EncodedChange>[],
    options?: ValueTypeOptions,
  ): TValue | undefined;

  abstract isEmpty(value: TValue): boolean;
}
