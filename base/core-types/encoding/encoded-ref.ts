import type {
  JSONObject,
  ReadonlyJSONObject,
  ReadonlyJSONValue,
} from '../../interfaces.ts';
import { CoreType, type CoreValue } from '../base.ts';
import { getCoreType } from '../utils.ts';

/**
 * Encoded-ref shapes and their guards. This is a dependency-free leaf: it
 * imports only `base.ts`, `utils.ts` and `interfaces.ts`, never `type-ops.ts`.
 * WHY: `type-ops.ts` needs `isEncodedRef`, so hosting it here keeps the
 * dependency one-way and breaks the former runtime cycle
 * `type-ops.ts <-> encoding/cyclical.ts`. `cyclical.ts` re-exports these for
 * backward compatibility of its public surface.
 */

export interface EncodedRef extends ReadonlyJSONObject {
  readonly __rId: number;
}

export function isEncodedRef(v: CoreValue): v is EncodedRef {
  if (getCoreType(v) === CoreType.Object) {
    const obj = v as ReadonlyJSONObject;
    if (typeof obj.__rId === 'number') {
      return true;
    }
  }
  return false;
}

export interface EncodedRefObject extends ReadonlyJSONObject {
  readonly __r: JSONObject[];
  readonly __d: JSONObject;
}

export function isEncodedRefObject(
  v: ReadonlyJSONValue,
): v is EncodedRefObject {
  if (getCoreType(v) === CoreType.Object) {
    const obj = v as ReadonlyJSONObject;
    if (
      getCoreType(obj.__r) === CoreType.Array &&
      getCoreType(obj.__d) === CoreType.Object
    ) {
      return true;
    }
  }
  return false;
}
