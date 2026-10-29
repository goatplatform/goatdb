import type { JSONValue } from '../../interfaces.ts';
import { isObject } from '../../comparisons.ts';
import { kTypeOps } from '../type-ops.ts';
import { coreValueClone } from '../clone.ts';
import type { CoreOptions, CoreValue, Encoder } from '../base.ts';
import { getCoreType } from '../utils.ts';

class RefSet {
  private _firstSet?: Set<CoreValue>;
  private _secondSet?: Set<CoreValue>;

  get refValues(): Iterable<CoreValue> {
    return this._secondSet ? this._secondSet : [];
  }

  get hasMultiRef() {
    return this._secondSet !== undefined && this._secondSet.size > 0;
  }

  set(val: CoreValue) {
    if (this._firstSet === undefined) this._firstSet = new Set<CoreValue>();
    if (!this._firstSet.has(val)) {
      this._firstSet.add(val);
      return;
    }

    if (this._secondSet === undefined) this._secondSet = new Set<CoreValue>();
    this._secondSet.add(val);
  }
}

export abstract class BaseCyclicalEncoder<
  R extends JSONValue,
  T,
  OT extends CoreOptions = CoreOptions,
> implements Encoder<string, CoreValue, T, OT> {
  set(key: string, value: CoreValue, options?: OT): void {
    // TODO(ofri): Properly handle Encodable instances as values
    if (isObject(value)) {
      const refSet = new RefSet();
      this.fillRefs(refSet, value, options);
      if (refSet.hasMultiRef) {
        const refsMap = new Map<CoreValue, R>();

        let refId = this.initRefId;
        for (const ref of refSet.refValues) {
          refsMap.set(ref, refId);
          refId = this.nextRefId(refId);
        }

        const refData = coreValueClone(value, {
          objectOverride: (obj: any) => {
            const refId = refsMap.get(obj as CoreValue);
            if (refId !== undefined) {
              return [true, this.convertRef(refId, options) as any];
            }
            return [false, undefined];
          },
          objectFilterFields: options?.objectFilterFields,
          iterableFilter: options?.iterableFilter,
        });

        value = {
          __r: this.convertRefsMap(refsMap, options),
          __d: refData as CoreValue,
        };
      }
    }

    this.encoder.set(key, value, options);
  }

  private fillRefs(set: RefSet, value: CoreValue, options?: CoreOptions) {
    const { children, recurseOptions, ref } = kTypeOps[
      getCoreType(value)
    ].childrenOf(value, options);
    // Ref marking happens before children are visited, matching the original
    // `fillRefs` Object branch order.
    if (ref) set.set(value);
    for (const child of children) {
      this.fillRefs(set, child, recurseOptions);
    }
  }

  abstract get encoder(): Encoder<string, CoreValue, T, OT>;
  abstract get initRefId(): R;
  abstract nextRefId(prev: R): R;
  abstract convertRef(refId: R, options?: OT): T;
  abstract convertRefsMap(map: Map<CoreValue, R>, options?: OT): CoreValue;

  getOutput(): T {
    return this.encoder.getOutput();
  }
  abstract newEncoder(): Encoder<string, CoreValue, T, OT>;
}

// Re-exported from the dependency-free leaf so this module's public surface is
// unchanged while the runtime cycle with `type-ops.ts` stays broken.
export {
  type EncodedRef,
  type EncodedRefObject,
  isEncodedRef,
  isEncodedRefObject,
} from './encoded-ref.ts';
