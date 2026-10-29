import type { CoreOptions, CoreValue } from './base.ts';
import { getCoreTypeOrUndef } from './utils.ts';
import { kTypeOps } from './type-ops.ts';

export interface EqualOptions extends CoreOptions {}

export function coreValueEquals(
  e1: CoreValue | object,
  e2: CoreValue | object,
  options?: EqualOptions,
): boolean {
  if (e1 === e2) {
    return true;
  }

  const t1 = getCoreTypeOrUndef(e1 as CoreValue);
  const t2 = getCoreTypeOrUndef(e2 as CoreValue);

  // WHY before dispatch: getCoreTypeOrUndef returns undefined for
  // symbol/bigint/function, which the CoreType table cannot classify. Those
  // fall back to reference equality here.
  if (t1 === undefined || t2 === undefined) {
    return e1 === e2;
  }

  if (t1 !== t2) {
    return false;
  }

  return kTypeOps[t1].equals(e1, e2, options);
}
