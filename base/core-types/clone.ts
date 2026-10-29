import type { CoreValue, CoreValueCloneOpts } from './base.ts';
import { getCoreType } from './utils.ts';
import { kTypeOps } from './type-ops.ts';

export function coreValueClone<T extends CoreValue>(
  e: T,
  opts?: CoreValueCloneOpts,
): T {
  // One shared context per top-level clone; the Object entry allocates
  // `objectsCache` into it so shared refs stay aliased (see type-ops.ts).
  return kTypeOps[getCoreType(e)].clone(e, {}, opts) as T;
}

export function coreObjectClone<T extends Object>(
  obj: T,
  opts?: CoreValueCloneOpts,
) {
  return kTypeOps[getCoreType(obj as unknown as CoreValue)].clone(
    obj,
    {},
    opts,
  ) as T;
}
