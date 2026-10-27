import type { ValueType, ValueTypeOptions } from './index.ts';
import type { Change, EncodedChange } from '../../change/index.ts';
import { CoreTypeOperations } from './core-type.ts';
import { FieldChange, FieldOperation } from '../../change/field-change.ts';
import { type ConcreteCoreValue } from '../../../base/core-types/index.ts';
import * as SetUtils from '../../../base/set.ts';

export class SetTypeOperations extends CoreTypeOperations<
  Set<ConcreteCoreValue>
> {
  constructor(valueType: ValueType) {
    super(valueType);
  }

  patch(
    curValue: Set<ConcreteCoreValue> | undefined,
    changes: Change<EncodedChange>[],
    options?: ValueTypeOptions,
  ) {
    for (const change of changes) {
      if (change instanceof FieldChange) {
        if (change.operation === FieldOperation.Insert) {
          curValue = this.patchInsert(curValue, change);
        } else if (change.operation === FieldOperation.Delete) {
          curValue = this.patchDelete(curValue, change);
        }
      }
    }
    return curValue;
  }

  private patchInsert(
    curValue: Set<ConcreteCoreValue> | undefined,
    change: FieldChange<Set<ConcreteCoreValue>>,
  ) {
    curValue = curValue || new Set<ConcreteCoreValue>();
    return SetUtils.unionByValue(curValue, change.value);
  }

  private patchDelete(
    curValue: Set<ConcreteCoreValue> | undefined,
    change: FieldChange<Set<ConcreteCoreValue>>,
  ) {
    if (curValue === undefined) return curValue;

    const newValue = SetUtils.subtractByValue(curValue, change.value);
    return newValue.size > 0 ? newValue : undefined;
  }

  valueChangedDiff(
    value1: Set<ConcreteCoreValue>,
    value2: Set<ConcreteCoreValue>,
    options?: ValueTypeOptions,
  ) {
    const added = SetUtils.subtractByValue(value2, value1);
    const removed = SetUtils.subtractByValue(value1, value2);

    if (added.size === 0 && removed.size === 0) {
      return;
    }

    const changes: Change<EncodedChange>[] = [];

    if (added.size) {
      changes.push(FieldChange.insert(added, this.valueType));
    }

    if (removed.size) {
      changes.push(FieldChange.delete(removed, this.valueType));
    }

    return changes;
  }

  isEmpty(value: Set<ConcreteCoreValue>) {
    return value.size === 0;
  }
}
