import { assert } from '../../../base/error.ts';
import { CoreType } from '../../../base/core-types/index.ts';

/**
 * Schema-facing value types. Kept in a dependency-free leaf so the
 * ValueType -> CoreType table can be shared without an import cycle:
 * `index.ts` imports the operation classes, and those classes import the map.
 */
export type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'set'
  | 'map'
  | 'richtext';

/**
 * Single source of truth linking every schema ValueType to its CoreType.
 *
 * WHY: the CFD operation table used to take both values as constructor
 * arguments, so a new ValueType could compile without a CoreType mapping and
 * silently fall back to `CoreValue`. `satisfies Record<ValueType, CoreType>`
 * makes a missing entry a compile error; the operation constructors now take
 * only a ValueType and derive the CoreType here.
 */
export const kValueTypeCoreTypes = Object.freeze({
  string: CoreType.String,
  number: CoreType.Number,
  boolean: CoreType.Boolean,
  date: CoreType.Date,
  set: CoreType.Set,
  map: CoreType.Dictionary,
  richtext: CoreType.Object,
}) satisfies Record<ValueType, CoreType>;

// Guard against two ValueTypes claiming the same CoreType: the reverse lookup
// below would silently keep one of them.
const gSeenCoreTypes = new Map<CoreType, ValueType>();
for (const [valueType, coreType] of Object.entries(kValueTypeCoreTypes)) {
  assert(
    !gSeenCoreTypes.has(coreType),
    `CoreType ${coreType} is mapped from both ` +
      `"${gSeenCoreTypes.get(coreType)}" and "${valueType}"`,
  );
  gSeenCoreTypes.set(coreType, valueType as ValueType);
}
