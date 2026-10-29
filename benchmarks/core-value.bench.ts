/**
 * Core-value hot-path microbenchmarks (issue #58).
 *
 * Measures clone, equals, cyclical encode, and the legacy-ref ingress guard.
 * These run in memory and are registered once for every runtime. Performance
 * comparisons require a separately measured baseline.
 */
import { BENCHMARK } from './mod.ts';
import { assert } from '../base/error.ts';
import type { CoreValue, Encodable, Encoder } from '../base/core-types/base.ts';
import { coreValueClone } from '../base/core-types/clone.ts';
import { coreValueEquals } from '../base/core-types/equals.ts';
import { JSONCyclicalEncoder } from '../base/core-types/encoding/json.ts';
import { assertNoLegacyRefs } from '../cfds/richtext/legacy-ref.ts';
import type { ElementNode, RichText } from '../cfds/richtext/tree.ts';

const kSuite = 'CoreValue';

/** Iterations per timed sample, so sub-microsecond ops stay measurable. */
const kBatch = 1000;

/**
 * Nested object/array value: exercises the recursive clone/equals paths the
 * refactor moved into type-ops.
 */
function nestedValue(): CoreValue {
  const items: CoreValue[] = [];
  for (let i = 0; i < 32; i++) {
    items.push({ n: i, s: `item-${i}`, b: i % 2 === 0 });
  }
  return {
    name: 'root',
    tags: ['a', 'b', 'c'],
    items,
    nested: { deep: { value: 42 } },
  };
}

/** Encodable wrapper so `JSONCyclicalEncoder.serialize` drives the real entry. */
class SerializableValue implements Encodable {
  constructor(readonly value: CoreValue) {}
  serialize(encoder: Encoder<string, CoreValue>): void {
    encoder.set('v', this.value);
  }
}

/** A value where one object is referenced from three places (multi-ref). */
function sharedRefValue(): CoreValue {
  const shared = { id: 'shared', payload: [1, 2, 3, 4] };
  return { first: shared, second: shared, nested: { third: shared } };
}

/** Medium RichText: 16 paragraphs, each with text + an inline emphasis node. */
function mediumRichText(): RichText {
  const children: ElementNode[] = [];
  for (let i = 0; i < 16; i++) {
    children.push({
      tagName: 'p',
      children: [
        { text: `Paragraph ${i}: ` },
        { tagName: 'b', children: [{ text: `bold ${i}` }] },
      ],
    });
  }
  return { root: { children } };
}

export default function setup(): void {
  const equalA = nestedValue();
  const equalB = nestedValue();
  const unequal = nestedValue();
  (unequal as { nested: { deep: { value: number } } }).nested.deep.value = 43;
  const shared = sharedRefValue();
  const doc = mediumRichText();

  BENCHMARK(kSuite, 'coreValueClone (nested value, x1000)', (ctx) => {
    ctx.start();
    for (let i = 0; i < kBatch; i++) coreValueClone(equalA);
    ctx.end();
    assert(coreValueEquals(equalA, equalB), 'clone input should stay equal');
  });

  BENCHMARK(kSuite, 'coreValueEquals (equal nested values, x1000)', (ctx) => {
    assert(
      coreValueEquals(equalA, equalB),
      'precondition: values must be equal',
    );
    ctx.start();
    for (let i = 0; i < kBatch; i++) coreValueEquals(equalA, equalB);
    ctx.end();
  });

  BENCHMARK(kSuite, 'coreValueEquals (unequal nested values, x1000)', (ctx) => {
    assert(
      !coreValueEquals(equalA, unequal),
      'precondition: values must differ',
    );
    ctx.start();
    for (let i = 0; i < kBatch; i++) coreValueEquals(equalA, unequal);
    ctx.end();
  });

  BENCHMARK(
    kSuite,
    'JSONCyclicalEncoder.serialize (shared refs, x1000)',
    (ctx) => {
      const encodable = new SerializableValue(shared);
      ctx.start();
      for (let i = 0; i < kBatch; i++) {
        JSONCyclicalEncoder.serialize(encodable);
      }
      ctx.end();
    },
  );

  BENCHMARK(kSuite, 'assertNoLegacyRefs (medium RichText, x1000)', (ctx) => {
    ctx.start();
    for (let i = 0; i < kBatch; i++) assertNoLegacyRefs(doc);
    ctx.end();
  });
}
