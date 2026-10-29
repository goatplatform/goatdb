import type { SerializeValueTypeOptions, ValueTypeOptions } from './index.ts';
import type { Change, EncodedChange } from '../../change/index.ts';
import type { RichTextChange } from '../../change/richtext-change.ts';
import {
  type CoreOptions,
  CoreType,
  type CoreValue,
  coreValueClone,
  coreValueEquals,
  type Encoder,
} from '../../../base/core-types/index.ts';
import type { DecodedValue } from '../../../base/core-types/encoding/index.ts';
import { diff, patch } from '../../richtext/diff-patch.ts';
import { flattenRichText } from '../../richtext/flat-rep.ts';
import { normalizeRichText } from '../../richtext/normalize/index.ts';
import {
  initRichText,
  isRichText,
  onlyNoneLocal,
  type RichText,
  treeAtomKeyFilterIgnoreText,
} from '../../richtext/tree.ts';
import { assertNoLegacyRefs } from '../../richtext/legacy-ref.ts';
import { CoreTypeOperations } from './core-type.ts';

const kCoreValueOpts: CoreOptions = {
  objectFilterFields: treeAtomKeyFilterIgnoreText,
};

/**
 * Richtext-layer serialization options. `local`/`byCharacter` are inherited
 * from the single source of truth in `ValueTypeOptions`; only checksum-specific
 * `flatRep` is added here.
 */
export interface RichTextSerializeOptions extends SerializeValueTypeOptions {
  flatRep?: boolean;
}

export class RichText3TypeOperations extends CoreTypeOperations<RichText> {
  constructor() {
    super(CoreType.Object, 'richtext');
  }
  patch(
    curValue: RichText | undefined,
    changes: Change<EncodedChange>[],
    _options?: ValueTypeOptions,
  ) {
    if (curValue === undefined) {
      curValue = initRichText();
    }
    assertNoLegacyRefs(curValue);

    const newValue = patch(curValue, changes as RichTextChange[], true);
    assertNoLegacyRefs(newValue);

    return newValue;
  }

  override normalize(val: RichText) {
    return normalizeRichText(val);
  }

  override validate(value: CoreValue): boolean {
    return isRichText(value);
  }

  override serialize(
    key: string,
    value: RichText,
    encoder: Encoder,
    options?: RichTextSerializeOptions,
  ): void {
    assertNoLegacyRefs(value);
    const local = options?.local === true; //default false

    if (options?.flatRep === true) {
      // For checksum purposes we need to use the flat rep or we won't account
      // for depth changes. Computing the checksum on a DFS run of the tree
      // completely strips out the depth info.

      //const flat = Array.from(flattenRichText(value, local));
      const flat = flattenRichText(value, local, false);

      encoder.set(key, flat, kCoreValueOpts);
    } else {
      const func = local ? undefined : onlyNoneLocal;
      encoder.set(key, value, {
        iterableFilter: func,
      });
    }
  }

  override deserialize(value: DecodedValue, options?: ValueTypeOptions) {
    const decoded = value as RichText;
    assertNoLegacyRefs(decoded);
    return decoded;
  }

  override valueAddedDiff(value2: RichText, options?: ValueTypeOptions) {
    assertNoLegacyRefs(value2);
    const local = options?.local === true; //Default is false

    const empty = initRichText();

    return diff(empty, value2, local);
  }

  override valueRemovedDiff(
    value1: RichText,
    options?: ValueTypeOptions,
  ): Change<EncodedChange> | Change<EncodedChange>[] | undefined {
    assertNoLegacyRefs(value1);
    const local = options?.local === true; //Default is false

    const empty = initRichText();

    return diff(value1, empty, local);
  }

  valueChangedDiff(
    value1: RichText,
    value2: RichText,
    options?: ValueTypeOptions,
  ) {
    assertNoLegacyRefs(value1);
    assertNoLegacyRefs(value2);
    return diff(
      value1,
      value2,
      options?.local === true, // Default: false
      options?.byCharacter !== false, // Default: true
    );
  }

  isEmpty(_value: RichText): boolean {
    return false;
  }

  override equals(
    val1: RichText,
    val2: RichText,
    options?: ValueTypeOptions,
  ): boolean {
    const local = options?.local === true; //Default is false

    const func = local ? undefined : onlyNoneLocal;
    return coreValueEquals(val1, val2, {
      iterableFilter: func,
    });
  }

  override clone(value: RichText) {
    return coreValueClone(value);
  }
}
