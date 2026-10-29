import { getTypeOperations } from '../cfds/base/types/index.ts';
import { assertNoLegacyRefs } from '../cfds/richtext/legacy-ref.ts';
import { kTypeOps } from '../base/core-types/type-ops.ts';
import { CoreType } from '../base/core-types/base.ts';
import { assertExists } from './asserts.ts';
import { HashMap } from '../base/collections/hash-map.ts';
import type {
  CoreObject,
  CoreValue,
  Encodable,
  Encoder,
} from '../base/core-types/base.ts';
import { coreValueClone } from '../base/core-types/clone.ts';
import { getCoreType } from '../base/core-types/index.ts';
import {
  MD5Checksum,
  Murmur3Checksum,
} from '../base/core-types/encoding/checksum.ts';
import { coreValueEquals } from '../base/core-types/equals.ts';
import { encodableValueHash } from '../base/core-types/encoding/hash.ts';
import {
  JSONCyclicalDecoder,
  JSONCyclicalEncoder,
  JSONDecoder,
  JSONEncoder,
} from '../base/core-types/encoding/json.ts';
import { serialize } from '../cfds/base/object.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { flattenRichText } from '../cfds/richtext/flat-rep.ts';
import { normalizeRichText } from '../cfds/richtext/normalize/index.ts';
import { StringRep } from '../cfds/richtext/string-rep.ts';
import {
  kCoreValueTreeNodeOpts,
  type RichText,
} from '../cfds/richtext/tree.ts';
import { assertEquals, assertThrows, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';

// Literal goldens captured before the core serializer refactor (issue #58).
// Encodable test double: drives the EncodedEncodable ({__t:'E'}) path.
class Box implements Encodable {
  constructor(readonly v: number) {}
  serialize(encoder: Encoder<string, CoreValue>): void {
    encoder.set('v', this.v);
  }
}

// Minimal Dictionary implementation (HashMap) with string keys.
function mkDict(entries: [string, unknown][]): HashMap<string, CoreValue> {
  const dict = new HashMap<string, CoreValue>(
    (k) => k,
    (a, b) => a === b,
  );
  for (const [k, v] of entries) {
    dict.set(k, v as CoreValue);
  }
  return dict;
}
const kRichTextDoc: RichText = {
  root: {
    children: [
      { tagName: 'p', children: [{ text: 'hi' }] },
      { tagName: 'p', children: [{ text: 'yo' }] },
    ],
  },
};

const kDateSchema: Schema = {
  ns: 'core-value-serialization-date',
  version: 1,
  fields: { when: { type: 'date' } },
};

function assertLegacyIngress(doc: RichText): void {
  const op = getTypeOperations<RichText>('richtext');
  const before = JSON.stringify(doc);
  for (
    const ingress of [
      () => op.patch(doc, []),
      () => op.deserialize(doc as never),
      () => op.normalize(doc),
      () => normalizeRichText(doc),
      () => op.serialize('body', doc, new JSONEncoder()),
      () => op.valueAddedDiff(doc),
      () => op.valueRemovedDiff(doc),
      () => op.valueChangedDiff(doc, kRichTextDoc),
      () => op.valueChangedDiff(kRichTextDoc, doc),
    ]
  ) {
    assertThrows(ingress, 'Legacy rich text ref');
    assertEquals(JSON.stringify(doc), before);
  }
}

export default function setup(): void {
  TEST(
    'CoreValueSerialization',
    'rejects legacy refs in pointers without stripping',
    () => {
      const marker = { ref: 'r1', type: 'link' };
      for (const pointer of [marker, { node: marker }]) {
        for (const pointers of [[pointer], new Set([pointer])]) {
          assertLegacyIngress(
            { ...kRichTextDoc, pointers } as unknown as RichText,
          );
        }
      }
    },
  );
  TEST(
    'CoreValueSerialization',
    'Date checksum and wire literal goldens',
    () => {
      const date = new Date(1700000000000);
      assertEquals(
        new MD5Checksum().checksumForValue(date),
        '24920decf83f6960b80f737a28eeafc1',
      );
      assertEquals(
        new MD5Checksum({ typeSafe: true }).checksumForValue(date),
        '07c0a91883c9558fe3b8789a16e8dbed',
      );
      assertEquals(new Murmur3Checksum().checksumForValue(date), '1670916500');
      assertEquals(
        new Murmur3Checksum({ typeSafe: true }).checksumForValue(date),
        '3491704779',
      );
      const checksum = new Murmur3Checksum();
      serialize(checksum, kDateSchema, { when: date } as never);
      assertEquals(checksum.getOutput(), '416277608');
      const encoder = new JSONEncoder();
      serialize(encoder, kDateSchema, { when: date } as never);
      assertEquals(JSON.stringify(encoder.getOutput()), '{"when":1700000000}');
    },
  );
  TEST('CoreValueSerialization', 'clone passes primitives through', () => {
    assertEquals(coreValueClone('s'), 's');
    assertEquals(coreValueClone(7), 7);
    assertEquals(coreValueClone(true), true);
    assertEquals(coreValueClone(null), null);
    assertEquals(coreValueClone(undefined), undefined);
  });

  TEST('CoreValueSerialization', 'clone deep-copies Date instances', () => {
    const d = new Date(1700000000000);
    const cloned = coreValueClone(d);
    // WHY: Dates are mutable, so a clone must be a new instance with the same
    // epoch value.
    assertTrue(cloned !== d);
    assertEquals(cloned.getTime(), d.getTime());
  });

  TEST('CoreValueSerialization', 'clone deep-copies nested arrays', () => {
    const src = [1, { a: 2 }, [3]];
    const cloned = coreValueClone(src as CoreValue) as unknown as typeof src;
    assertEquals(cloned, src);
    assertTrue(cloned !== (src as unknown as CoreValue));
    assertTrue(cloned[1] !== src[1]);
  });

  TEST(
    'CoreValueSerialization',
    'clone preserves aliases across object fields',
    () => {
      const inner = { a: 1 };
      const cloned = coreValueClone({ x: inner, y: inner }) as {
        x: unknown;
        y: unknown;
      };
      // WHY: the per-call objectsCache makes a repeated input object clone once,
      // keeping alias identity across fields.
      assertTrue(cloned.x === cloned.y);
      assertTrue(cloned.x !== inner);
    },
  );

  TEST(
    'CoreValueSerialization',
    'clone deep-copies Set elements and collapses duplicates',
    () => {
      const inner = { a: 1 };
      const cloned = coreValueClone(
        new Set([inner, inner]) as CoreValue,
      ) as Set<
        CoreValue
      >;
      assertEquals(cloned.size, 1);
      assertEquals([...cloned], [{ a: 1 }]);
    },
  );

  TEST(
    'CoreValueSerialization',
    'clone throws for non-clonable class objects',
    () => {
      class NotClonable {
        x = 1;
      }
      assertThrows(() =>
        coreValueClone(new NotClonable() as unknown as CoreValue)
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'clone honors iterableFilter and objectFilterFields',
    () => {
      const even = coreValueClone([1, 2, 3, 4] as CoreValue, {
        iterableFilter: (v) => (v as number) % 2 === 0,
      });
      assertEquals(even, [2, 4]);
      const kept = coreValueClone({ a: 1, b: 2 }, {
        objectFilterFields: (k) => k !== 'b',
      });
      assertEquals(kept, { a: 1 });
    },
  );

  TEST(
    'CoreValueSerialization',
    'equals compares primitives including NaN and Infinity',
    () => {
      assertEquals(coreValueEquals(undefined, undefined), true);
      assertEquals(coreValueEquals(null, null), true);
      assertEquals(coreValueEquals('a', 'a'), true);
      assertEquals(coreValueEquals(true, true), true);
      assertEquals(coreValueEquals(true, false), false);
      assertEquals(coreValueEquals(1, 1), true);
      assertEquals(coreValueEquals(1, 2), false);
      // WHY: numbersEqual treats NaN as never equal but signed infinities as equal.
      assertEquals(coreValueEquals(NaN, NaN), false);
      assertEquals(coreValueEquals(Infinity, Infinity), true);
      assertEquals(coreValueEquals(-Infinity, -Infinity), true);
    },
  );

  TEST('CoreValueSerialization', 'equals compares Date by epoch time', () => {
    assertEquals(coreValueEquals(new Date(1000), new Date(1000)), true);
    assertEquals(coreValueEquals(new Date(1000), new Date(2000)), false);
    // WHY: Invalid Date holds NaN epoch, and NaN never equals itself.
    assertEquals(
      coreValueEquals(new Date('invalid'), new Date('invalid')),
      false,
    );
  });

  TEST(
    'CoreValueSerialization',
    'equals treats binary by reference only',
    () => {
      const u = new Uint8Array([1, 2]);
      // WHY: Uint8Array is a ClassObject without isEqual/compare, so equality
      // falls back to reference identity even for identical bytes.
      assertEquals(coreValueEquals(u, u), true);
      assertEquals(coreValueEquals(u, new Uint8Array([1, 2])), false);
    },
  );

  TEST('CoreValueSerialization', 'equals compares arrays structurally', () => {
    assertEquals(coreValueEquals([1, [2]], [1, [2]]), true);
    assertEquals(coreValueEquals([1], [1, 2]), false);
    assertEquals(coreValueEquals([1, 2], [2, 1]), false);
  });

  TEST('CoreValueSerialization', 'equals compares objects by own keys', () => {
    assertEquals(coreValueEquals({ a: 1 }, { a: 1 }), true);
    assertEquals(coreValueEquals({ a: 1 }, { a: 1, b: 2 }), false);
    assertEquals(coreValueEquals({ a: 1 }, { a: 2 }), false);
  });

  TEST(
    'CoreValueSerialization',
    'equals compares iterables with a filter',
    () => {
      // WHY: iterableFilter removes elements but does not reorder; equality
      // requires the remaining elements to appear in the same sequence.
      assertEquals(
        coreValueEquals([1, 2, 3], [1, 2, 3], {
          iterableFilter: (v) => (v as number) > 1,
        }),
        true,
      );
      assertEquals(
        coreValueEquals([1, 2, 3], [3, 2, 1], {
          iterableFilter: (v) => (v as number) > 1,
        }),
        false,
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'equals compares Sets order-independently',
    () => {
      assertEquals(coreValueEquals(new Set([1, 2]), new Set([2, 1])), true);
      assertEquals(coreValueEquals(new Set([1, 2]), new Set([1, 3])), false);
      assertEquals(coreValueEquals(new Set([1]), new Set([1, 2])), false);
    },
  );

  TEST('CoreValueSerialization', 'equals compares Dictionaries', () => {
    assertEquals(
      coreValueEquals(mkDict([['a', 1]]), mkDict([['a', 1]])),
      true,
    );
    assertEquals(
      coreValueEquals(mkDict([['a', 1]]), mkDict([['a', 2]])),
      false,
    );
  });

  TEST(
    'CoreValueSerialization',
    'equals rejects cross-type and honors encoded shapes',
    () => {
      assertEquals(coreValueEquals(1, '1'), false);
      assertEquals(coreValueEquals(null, undefined), false);
      // Encoded values compare as plain objects with their __t/__v shape.
      assertEquals(
        coreValueEquals(
          { __t: 'D', __v: 1700000000 },
          { __t: 'D', __v: 1700000000 },
        ),
        true,
      );
      assertEquals(
        coreValueEquals(
          { __t: 'S', __v: [1, 2] },
          { __t: 'S', __v: [1, 2] },
        ),
        true,
      );
      assertEquals(
        coreValueEquals({ __t: 'D', __v: 1 }, { __t: 'D', __v: 2 }),
        false,
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder encodes each primitive exactly',
    () => {
      assertEquals(JSONEncoder.toJS('x'), 'x');
      assertEquals(JSONEncoder.toJS(42), 42);
      assertEquals(JSONEncoder.toJS(true), true);
      assertEquals(JSONEncoder.toJS(null), null);
      assertEquals(JSONEncoder.toJS(undefined), undefined);
      assertEquals(JSONEncoder.toJS({ a: 1, b: 'x', c: true, d: null }), {
        a: 1,
        b: 'x',
        c: true,
        d: null,
      });
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder encodes Date as EncodedDate seconds',
    () => {
      // WHY: serializeDate stores epoch milliseconds / 1000, so the wire tag is
      // seconds, not milliseconds.
      assertEquals(JSONEncoder.toJS(new Date(1700000000000)), {
        __t: 'D',
        __v: 1700000000,
      });
      assertEquals(JSONEncoder.toJS({ when: new Date(1000) }), {
        when: { __t: 'D', __v: 1 },
      });
      const invalid = JSONEncoder.toJS(new Date('invalid')) as { __v: number };
      assertTrue(Number.isNaN(invalid.__v));
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder encodes pre-1970 Date as negative seconds',
    () => {
      // WHY: serializeDate divides epoch milliseconds by 1000, so a day
      // before the epoch lands on a negative wire value, not zero.
      assertEquals(JSONEncoder.toJS(new Date(-86400000)), {
        __t: 'D',
        __v: -86400,
      });
      const decoded = new JSONDecoder({
        when: { __t: 'D', __v: -86400 },
      }).get('when') as Date;
      assertTrue(decoded instanceof Date);
      assertEquals(decoded.getTime(), -86400000);
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder encodes Set as EncodedSet',
    () => {
      assertEquals(JSONEncoder.toJS(new Set([1, 2])), {
        __t: 'S',
        __v: [1, 2],
      });
      assertEquals(JSONEncoder.toJS(new Set()), { __t: 'S', __v: [] });
      assertEquals(JSONEncoder.toJS(new Set(['a', 1, { b: 2 }])), {
        __t: 'S',
        __v: ['a', 1, { b: 2 }],
      });
      assertEquals(JSONEncoder.toJS({ s: new Set([1]) }), {
        s: { __t: 'S', __v: [1] },
      });
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder encodes Array with nested Date',
    () => {
      assertEquals(JSONEncoder.toJS([1, 'a', new Date(1000)]), [
        1,
        'a',
        { __t: 'D', __v: 1 },
      ]);
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder encodes Dictionary as plain object',
    () => {
      assertEquals(
        JSONEncoder.toJS(mkDict([['a', 1], ['b', 2]])),
        { a: 1, b: 2 },
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder encodes Generator as array',
    () => {
      function* gen() {
        yield 1;
        yield 2;
      }
      assertEquals(JSONEncoder.toJS(gen()), [1, 2]);
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder encodes Encodable as EncodedEncodable',
    () => {
      assertEquals(
        JSONEncoder.toJS(new Box(3) as unknown as CoreValue),
        { __t: 'E', __v: { v: 3 } },
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder set skips undefined values',
    () => {
      const enc = new JSONEncoder();
      enc.set('a', undefined);
      enc.set('b', 1);
      assertEquals(enc.getOutput(), { b: 1 });
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder passes unsupported class values through',
    () => {
      class NotEncodable {
        x = 1;
      }
      const value = new NotEncodable();
      // WHY: JSONBaseEncoder.isNativeValue falls through to true for
      // ClassObjects that are not Encodable, so the "must implement
      // Encodable" throw in BaseEncoder.convertValue is unreachable through
      // the public toJS/set paths. The instance is emitted unchanged instead
      // of throwing.
      assertTrue(
        (JSONEncoder.toJS(value as unknown as CoreValue) as unknown) === value,
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSONEncoder throws on cyclic plain objects',
    () => {
      const cyc: Record<string, unknown> = {};
      cyc.self = cyc;
      assertThrows(() => JSONEncoder.toJS(cyc as unknown as CoreValue));
    },
  );

  TEST(
    'CoreValueSerialization',
    'cyclical encoder leaves unique objects unwrapped',
    () => {
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { a: { v: 1 } });
      // WHY: the __r/__d wrapper appears only when an object is referenced more
      // than once.
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"a":{"v":1}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'cyclical encoder wraps shared references with __r and __d',
    () => {
      const shared = { id: 'a', name: 'shared' };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { first: shared, second: shared });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"__r":[{"id":"a","name":"shared"}],"__d":{"first":{"__rId":0},"second":{"__rId":0}}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'cyclical encoder assigns ref ids in first-seen order',
    () => {
      const n1 = { id: 'n1' };
      const n2 = { id: 'n2' };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { a: n1, b: n2, c: n1, d: n2 });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"__r":[{"id":"n1"},{"id":"n2"}],"__d":{"a":{"__rId":0},"b":{"__rId":1},"c":{"__rId":0},"d":{"__rId":1}}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'cyclical decode restores shared reference identity and __d',
    () => {
      const shared = { id: 'a', name: 'shared' };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { first: shared, second: shared });
      const decoder = JSONCyclicalDecoder.get(
        enc.getOutput() as Record<string, never>,
      );
      const decoded = decoder.get('root') as {
        first: unknown;
        second: unknown;
      };
      // WHY: __d points back into __r via __rId, so decode must re-alias the
      // referenced values instead of deep-copying them.
      assertTrue(decoded.first === decoded.second);
      assertEquals(decoded.first, { id: 'a', name: 'shared' });
      decoder.finalize();
    },
  );

  TEST(
    'CoreValueSerialization',
    'cyclical encoder wraps shared Set and Date holders with __r and __d',
    () => {
      const shared = { s: new Set([1, 2]), d: new Date(1000) };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { first: shared, second: shared });
      // WHY: Date is a leaf (never a ref candidate) but the shared holder
      // is, so the __r entry carries the Set/Date wire forms inline.
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"__r":[{"s":{"__t":"S","__v":[1,2]},"d":{"__t":"D","__v":1}}],"__d":{"first":{"__rId":0},"second":{"__rId":0}}}}',
      );
      const decoder = JSONCyclicalDecoder.get(
        enc.getOutput() as Record<string, never>,
      );
      const decoded = decoder.get('root') as {
        first: unknown;
        second: unknown;
      };
      assertTrue(decoded.first === decoded.second);
      decoder.finalize();
    },
  );

  TEST(
    'CoreValueSerialization',
    'cyclical decoder decodes nested EncodedSet and EncodedDate',
    () => {
      const decoder = JSONCyclicalDecoder.get({
        s: { __t: 'S', __v: [1, 2] },
        d: { __t: 'D', __v: 5 },
      } as unknown as Record<string, never>);
      const set = decoder.get('s') as Set<unknown>;
      assertEquals(set instanceof Set, true);
      assertEquals([...set], [1, 2]);
      assertEquals((decoder.get('d') as Date).getTime(), 5000);
      decoder.finalize();
    },
  );

  TEST(
    'CoreValueSerialization',
    'cyclical encoder ignores top-level arrays when collecting refs',
    () => {
      const shared = { v: 9 };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', [shared, shared]);
      // WHY: BaseCyclicalEncoder only scans plain objects for refs (isObject),
      // so a top-level array is never __r-wrapped.
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":[{"v":9},{"v":9}]}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'cyclical encoder skips already encoded ref objects',
    () => {
      const refShaped = { __rId: 5, other: 1 };
      const enc = new JSONCyclicalEncoder();
      enc.set('a', refShaped);
      enc.set('b', refShaped);
      // WHY: fillRefs excludes objects matching isEncodedRef from both
      // collection and recursion, so the shared value stays unwrapped.
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"a":{"__rId":5,"other":1},"b":{"__rId":5,"other":1}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'cyclical encoder throws on self-referential objects',
    () => {
      const cyc: Record<string, unknown> = { name: 'root' };
      cyc.self = cyc;
      assertThrows(() => {
        const enc = new JSONCyclicalEncoder();
        enc.set('root', cyc as unknown as CoreValue);
      });
    },
  );

  // ---------------- Phase 3C: fillRefs byte-identity matrix ----------------
  // These goldens pin the exact `__r`/`__d` bytes produced by ref collection
  // (`BaseCyclicalEncoder.fillRefs`) combined with the final JSON encode.
  // They were captured from the pre-table implementation and must survive the
  // `kTypeOps[type].childrenOf` refactor unchanged.

  TEST(
    'CoreValueSerialization',
    'refs matrix: nested shared object',
    () => {
      const shared = { id: 's' };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { wrap: { first: shared, second: shared } });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"__r":[{"id":"s"}],"__d":{"wrap":{"first":{"__rId":0},"second":{"__rId":0}}}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'refs matrix: array iterableFilter is not applied during ref collection',
    () => {
      const shared = { id: 's' };
      const enc = new JSONCyclicalEncoder();
      // The filter drops objects. Ref collection still visits the array field
      // (the Object branch drops `options`, so the filter never runs there):
      // `shared` is collected twice, producing the `__r`/`__d` wrapper. The
      // final JSON encode then re-applies the filter, so the emitted `__r`
      // list and `__d.arr` both lose the object entries.
      enc.set('root', { arr: [1, shared, 2, shared] }, {
        iterableFilter: (v) => typeof v !== 'object',
      });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"__r":[],"__d":{"arr":[1,2]}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'refs matrix: set iterableFilter is not applied during ref collection',
    () => {
      const shared = { id: 's' };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { set: new Set([1, shared, 2, shared]) }, {
        iterableFilter: (v) => typeof v !== 'object',
      });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"set":{"__t":"S","__v":[1,2]}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'refs matrix: dictionary drops recursion options',
    () => {
      const shared = { id: 's' };
      const dict = new Map<string, unknown>([
        ['arr', [1, shared, 2, shared]],
        ['direct', shared],
      ]);
      const enc = new JSONCyclicalEncoder();
      // The Dictionary branch recurses without options, so the nested array's
      // filter does not run during collection; `shared` is still multi-ref.
      enc.set('root', { dict } as unknown as CoreValue, {
        iterableFilter: (v) => typeof v !== 'object',
      });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"__r":[],"__d":{"dict":{"arr":[1,2],"direct":{"__rId":0}}}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'refs matrix: object field array drops recursion options',
    () => {
      const shared = { id: 's' };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { inner: { arr: [1, shared, 2, shared] } }, {
        iterableFilter: (v) => typeof v !== 'object',
      });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"__r":[],"__d":{"inner":{"arr":[1,2]}}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'refs matrix: isEncodedRef-shaped object is neither collected nor entered',
    () => {
      const refShaped = { __rId: 5, other: 1 };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { a: refShaped, b: refShaped });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"a":{"__rId":5,"other":1},"b":{"__rId":5,"other":1}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'refs matrix: set member shared with an object field',
    () => {
      const a = { id: 'a' };
      const b = { id: 'b' };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { s: new Set([a, b]), o: a });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"__r":[{"id":"a"}],"__d":{"s":{"__t":"S","__v":[{"__rId":0},{"id":"b"}]},"o":{"__rId":0}}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'refs matrix: date and primitive leaves',
    () => {
      const enc = new JSONCyclicalEncoder();
      enc.set('root', {
        d: new Date(5),
        n: 1,
        s: 'x',
        nested: { d2: new Date(7), nil: null, u: undefined },
      });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"d":{"__t":"D","__v":0.005},"n":1,"s":"x","nested":{"d2":{"__t":"D","__v":0.007},"nil":null}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'refs matrix: objectFilterFields does not apply during ref collection',
    () => {
      const shared = { id: 's' };
      const enc = new JSONCyclicalEncoder();
      // Both `keep` and `drop` are traversed during ref collection, so `shared`
      // is multi-ref and gets wrapped. The field filter only trims `drop`
      // during the final encode.
      enc.set('root', { keep: shared, drop: shared }, {
        objectFilterFields: (k) => k !== 'drop',
      });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"root":{"__r":[{"id":"s"}],"__d":{"keep":{"__rId":0}}}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'refs matrix round-trips nested shared object through the decoder',
    () => {
      const shared = { id: 's' };
      const enc = new JSONCyclicalEncoder();
      enc.set('root', { wrap: { first: shared, second: shared } });
      const decoder = JSONCyclicalDecoder.get(
        enc.getOutput() as Record<string, never>,
      );
      const decoded = decoder.get('root') as {
        wrap: { first: unknown; second: unknown };
      };
      assertTrue(decoded.wrap.first === decoded.wrap.second);
      assertEquals(decoded.wrap.first, { id: 's' });
      decoder.finalize();
    },
  );

  TEST(
    'CoreValueSerialization',
    'encodableValueHash returns stable goldens',
    () => {
      // Treat any change here as a reviewed diff.
      assertEquals(encodableValueHash('hello'), '2995614608');
      assertEquals(encodableValueHash({ a: 1, b: 'x' }), '2300529200');
      assertEquals(encodableValueHash([1, 2, 3]), '774368284');
      assertEquals(encodableValueHash(42), '1797032297');
      assertEquals(encodableValueHash(null), '2733564389');
      assertEquals(encodableValueHash(undefined), '2376305704');
      assertEquals(encodableValueHash(true), '2165269852');
      // Plain Date hash before the unified Date contract.
      assertEquals(encodableValueHash(new Date(1700000000000)), '1670916500');
      assertEquals(encodableValueHash(new Set([3, 1, 2])), '2802134913');
    },
  );

  TEST(
    'CoreValueSerialization',
    'encodableValueHash uses identity for unknown values',
    () => {
      // WHY: functions have no CoreType, so they hit the gUnknownValuesHashes
      // branch which keys off object identity, not content.
      const fn1 = () => 1;
      const fn2 = () => 1;
      const h1 = encodableValueHash(fn1 as unknown as object);
      assertTrue(/^\d+$/.test(h1));
      assertEquals(encodableValueHash(fn1 as unknown as object), h1);
      assertTrue(encodableValueHash(fn2 as unknown as object) !== h1);
      // Content values stay deterministic across distinct instances.
      assertEquals(encodableValueHash({ a: 1 }), encodableValueHash({ a: 1 }));
    },
  );

  TEST('CoreValueSerialization', 'MD5Checksum returns stable goldens', () => {
    assertEquals(
      new MD5Checksum().checksumForValue('hello'),
      '5d41402abc4b2a76b9719d911017c592',
    );
    assertEquals(
      new MD5Checksum({ typeSafe: true }).checksumForValue('hello'),
      '227da538ae11e17b6075fe59b2025f7e',
    );
    assertEquals(
      new MD5Checksum().checksumForValue({ a: 1 }),
      'd7ec69302574b46eec3aad211384264b',
    );
    assertEquals(
      new MD5Checksum({ typeSafe: true }).checksumForValue({ a: 1 }),
      'cc706d473c3f02a13718b2f98fe29544',
    );
    assertEquals(
      new MD5Checksum({ typeSafe: true }).checksumForValue([1, 2]),
      '200b45bf6499df3a2b8787957fddf9a0',
    );
    assertEquals(
      new MD5Checksum().checksumForValue(new Set([2, 1])),
      'efd4f115d46b3e79ee1392c343b3b433',
    );
    assertEquals(
      new MD5Checksum().checksumForValue(null),
      '37a6259cc0c1dae299a7866489dff0bd',
    );
  });

  TEST(
    'CoreValueSerialization',
    'Murmur3Checksum returns stable goldens',
    () => {
      assertEquals(
        new Murmur3Checksum().checksumForValue('hello'),
        '2995614608',
      );
      assertEquals(
        new Murmur3Checksum({ typeSafe: true }).checksumForValue('hello'),
        '2693211597',
      );
      assertEquals(
        new Murmur3Checksum({ typeSafe: true }).checksumForValue({
          a: 1,
          b: 'x',
        }),
        '306975380',
      );
      assertEquals(
        new Murmur3Checksum({ typeSafe: true }).checksumForValue(
          new Date(1700000000000),
        ),
        '3491704779',
      );
      assertEquals(
        new Murmur3Checksum({ typeSafe: true }).checksumForValue(
          new Set([3, 1, 2]),
        ),
        '3211716888',
      );
      assertEquals(
        new Murmur3Checksum({ typeSafe: true }).checksumForValue({
          b: 2,
          a: 1,
        }),
        '4113695140',
      );
      // A custom seed changes the output but stays deterministic.
      assertEquals(
        new Murmur3Checksum({ seed: 1 }).checksumForValue('hello'),
        '3142237357',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'getCoreType throws on symbol, bigint and function',
    () => {
      // WHY: none of these have a CoreType, so getCoreType reaches
      // notReached('Unsupported value type') and throws.
      assertThrows(() => getCoreType(Symbol('s') as unknown as CoreValue));
      assertThrows(() => getCoreType(10n as unknown as CoreValue));
      assertThrows(() => getCoreType((() => 1) as unknown as CoreValue));
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder passes unknown __t objects through untouched',
    () => {
      const decoder = new JSONDecoder({ x: { __t: 'Z', __v: 1 } });
      // WHY: only __t 'S'/'D'/'E' have decoders; any other __t object is
      // decoded as a plain object and returned as-is (no throw, no rewrite).
      assertEquals(decoder.get('x'), { __t: 'Z', __v: 1 });
    },
  );

  TEST(
    'CoreValueSerialization',
    'JSON encode preserves unicode text and insertion key order',
    () => {
      // ASCII-only source: the unicode payload lives in escapes so the source
      // file stays byte-clean, while the assertion still pins real characters.
      const raw = '\u05e9\u05dc\u05d5\u05dd \ud83c\udf0d';
      const enc = new JSONEncoder();
      enc.set('z', raw);
      enc.set('a', 1);
      enc.set('m', { '\u03b2': 2, '\u03b1': 1 });
      assertEquals(
        JSON.stringify(enc.getOutput()),
        '{"z":"' + raw + '","a":1,"m":{"\u03b2":2,"\u03b1":1}}',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'nested non-ref inline-task moves to sibling below',
    () => {
      // WHY: setup.ts registers the inline-task rule under the node key
      // `t_inline-task`, which getKeysForNode already emits for any element with
      // that tagName. Dropping the isRefMarker matcher only removes the legacy
      // ref registration path; plain inline-task nodes matched before and after.
      const doc = {
        root: {
          children: [
            {
              tagName: 'p',
              children: [
                { text: 'a' },
                { tagName: 'inline-task', children: [{ text: 'task' }] },
                { text: 'b' },
              ],
            },
          ],
        },
      } as unknown as RichText;
      const out = normalizeRichText(doc);
      const kids = out.root.children as { tagName?: string }[];
      assertEquals(kids.length, 3);
      assertEquals(kids[0].tagName, 'p');
      assertEquals(kids[1].tagName, 'inline-task');
      assertEquals(kids[2].tagName, 'p');
    },
  );

  TEST(
    'CoreValueSerialization',
    'flatRep produces a stable atom stream',
    () => {
      const flat = Array.from(flattenRichText(kRichTextDoc, true, true));
      assertEquals(
        JSON.stringify(flat),
        '[{"__elementSpacer":true},{"tagName":"p","children":[{"text":"hi"}]},{"depthMarker":1},{"text":"h"},{"text":"i"},{"text":""},{"depthMarker":0},{"__elementSpacer":true},{"tagName":"p","children":[{"text":"yo"}]},{"depthMarker":1},{"text":"y"},{"text":"o"},{"text":""},{"depthMarker":0}]',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'StringRep encode is byte-identical and decodes',
    () => {
      const flat = Array.from(flattenRichText(kRichTextDoc, true, true));
      const rep = new StringRep(kCoreValueTreeNodeOpts);
      const encoded = rep.encode(flat);
      // WHY: code points are assigned in first-seen order; element nodes ignore
      // their children (treeAtomKeyFilterIgnoreText), so both paragraphs share
      // code 1 while text nodes stay distinct.
      assertEquals(
        encoded,
        '\n\u0001\u0002\u0003\u0004\u0005\u0006\n\u0001\u0002\u0007\b\u0005\u0006',
      );
      assertEquals(
        [...encoded].map((c) => c.codePointAt(0)),
        [10, 1, 2, 3, 4, 5, 6, 10, 1, 2, 7, 8, 5, 6],
      );
      assertEquals(Array.from(rep.decode(encoded)).length, flat.length);
    },
  );

  TEST('CoreValueSerialization', 'clone deep-copies HashMap', () => {
    const dict = mkDict([['a', 1], ['b', 'x']]);
    const cloned = coreValueClone(dict) as unknown as Map<string, CoreValue>;
    // WHY: the Dictionary entry builds a fresh Map, so the clone is
    // independent of the source HashMap.
    assertTrue(cloned !== (dict as unknown));
    assertEquals(cloned.get('a'), 1);
    assertEquals(cloned.get('b'), 'x');
    dict.set('a', 999 as CoreValue);
    assertEquals(cloned.get('a'), 1);
  });

  TEST(
    'CoreValueSerialization',
    'clone throws for Encodable without Clonable',
    () => {
      // WHY: Box implements Encodable but not Clonable, so the ClassObject
      // clone entry throws. Class instances are never structurally cloned.
      assertThrows(() => coreValueClone(new Box(42) as unknown as CoreValue));
    },
  );

  TEST(
    'CoreValueSerialization',
    'clone aliases sibling array elements',
    () => {
      const inner = { a: 1 };
      const cloned = coreValueClone([inner, inner] as CoreValue) as unknown[];
      // WHY: one shared cache per top-level clone keeps alias identity across
      // array siblings and object fields alike. New behavior, declared in
      // CHANGELOG (pre-table code only preserved aliases within one object
      // subtree).
      assertTrue(cloned[0] === cloned[1]);
    },
  );

  TEST(
    'CoreValueSerialization',
    'equals with objectFilterFields is symmetric',
    () => {
      // WHY: the second loop must pass the second object (b) to the filter,
      // not the first (a), otherwise equals(a, b) !== equals(b, a) for
      // asymmetric inputs.
      const filter = (k: string, o: CoreValue) =>
        Object.hasOwn(o as CoreObject, k);
      assertEquals(
        coreValueEquals({ a: 1 }, { a: 1, b: 2 }, {
          objectFilterFields: filter,
        }),
        false,
      );
      assertEquals(
        coreValueEquals({ a: 1, b: 2 }, { a: 1 }, {
          objectFilterFields: filter,
        }),
        false,
      );
      assertEquals(
        coreValueEquals({ a: 1 }, { a: 1 }, { objectFilterFields: filter }),
        true,
      );
    },
  );

  TEST('CoreValueSerialization', 'kTypeOps is frozen and exhaustive', () => {
    // WHY: kTypeOps is the base-level dispatch table
    // (clone/equals/encode/childrenOf). Freezing plus per-CoreType coverage
    // turns a missed type into a loud failure instead of silent mishandling.
    assertTrue(Object.isFrozen(kTypeOps));
    for (const type of Object.values(CoreType)) {
      if (typeof type !== 'number') continue;
      const ops = kTypeOps[type as CoreType];
      assertExists(ops, `kTypeOps missing entry for CoreType ${type}`);
      assertExists(ops.clone);
      assertExists(ops.equals);
      assertExists(ops.encode);
      assertExists(ops.childrenOf);
    }
  });

  // ---------------- legacy richtext ref rejection ----------------

  // Legacy RefMarker: a leaf carrying ref/type.
  const kLegacyRefMarkerDoc = {
    root: {
      children: [
        { tagName: 'p', children: [{ ref: 'r1', type: 'link' }] },
      ],
    },
  } as unknown as RichText;

  // Legacy RefNode: an element with tagName 'ref' wrapping its target.
  const kLegacyRefNodeDoc = {
    root: {
      children: [
        {
          tagName: 'p',
          children: [
            {
              tagName: 'ref',
              ref: 'r1',
              type: 'link',
              children: [{ text: 'x' }],
            },
          ],
        },
      ],
    },
  } as unknown as RichText;

  TEST(
    'CoreValueSerialization',
    'rejects a legacy RefMarker leaf at every richtext ingress',
    () => {
      assertLegacyIngress(kLegacyRefMarkerDoc);
    },
  );

  TEST(
    'CoreValueSerialization',
    'rejects a legacy RefNode element at every richtext ingress',
    () => {
      assertLegacyIngress(kLegacyRefNodeDoc);
    },
  );

  TEST(
    'CoreValueSerialization',
    'rejects a root-level legacy ref node',
    () => {
      // WHY: dfs yields only descendants, so a legacy ref placed at `root`
      // itself needs the explicit check added to assertNoLegacyRefs.
      const legacyRoot = {
        root: { tagName: 'ref', ref: 'r1', type: 'link', children: [] },
      } as unknown as RichText;
      assertThrows(
        () => assertNoLegacyRefs(legacyRoot),
        'Legacy rich text ref',
      );
    },
  );

  TEST(
    'CoreValueSerialization',
    'legacy inline-task ref throws instead of moving to sibling below',
    () => {
      // WHY: assertNoLegacyRefs runs first in normalizeRichText, so an
      // inline-task carrying legacy ref/type strings fails loudly instead
      // of being relocated by the widened {tag:'inline-task'} rule.
      const doc = {
        root: {
          children: [
            {
              tagName: 'p',
              children: [
                {
                  tagName: 'inline-task',
                  ref: 'r1',
                  type: 'link',
                  children: [{ text: 'task' }],
                },
              ],
            },
          ],
        },
      } as unknown as RichText;
      assertThrows(() => normalizeRichText(doc));
    },
  );

  TEST(
    'CoreValueSerialization',
    'valid nodes carrying only ref or only type pass the legacy guard',
    () => {
      // WHY: the detector requires both string fields (or tagName 'ref'),
      // so a TextNode with a lone `ref` and an element with a lone `type`
      // are ordinary content and must not trip assertNoLegacyRefs.
      const doc = {
        root: {
          children: [
            {
              tagName: 'p',
              type: 'link',
              children: [{ text: 'x', ref: 'r1' }],
            },
          ],
        },
      } as unknown as RichText;
      assertNoLegacyRefs(doc);
    },
  );
}
