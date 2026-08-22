import { coreValueCompare } from '../base/core-types/comparable.ts';
import { coreValueEquals } from '../base/core-types/equals.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';

export default function setup(): void {
  TEST('CoreValueCompare', 'orders Date values consistently', () => {
    const earlier = new Date('2024-01-01T00:00:00.000Z');
    const later = new Date('2024-01-02T00:00:00.000Z');
    const sameInstant = new Date(earlier.getTime());

    // WHY: Date compare must be by getTime value, earlier < later, same getTime == 0.
    assertEquals(coreValueCompare(earlier, sameInstant), 0);
    assertTrue(coreValueCompare(earlier, later) < 0);
    assertTrue(coreValueCompare(later, earlier) > 0);
    assertEquals(coreValueCompare(sameInstant, earlier), 0);
  });

  TEST('CoreValueCompare', 'orders Invalid Date consistently', () => {
    const earlier = new Date('2024-01-01T00:00:00.000Z');
    const invalid1 = new Date('invalid');
    const invalid2 = new Date('invalid');

    // WHY: Invalid Date has NaN getTime; compare treats NaN==NaN as 0 and orders Invalid < valid.
    assertEquals(coreValueCompare(invalid1, invalid2), 0);
    assertEquals(coreValueCompare(invalid2, invalid1), 0);
    assertTrue(coreValueCompare(invalid1, earlier) < 0);
    assertTrue(coreValueCompare(earlier, invalid1) > 0);
  });

  TEST(
    'CoreValueCompare',
    'distinguishes Invalid Date equality vs ordering',
    () => {
      const invalid1 = new Date('invalid');
      const invalid2 = new Date('invalid');

      // WHY: equals uses numbersEqual(NaN,NaN)=false so Invalid != Invalid, while compare says Invalid==Invalid.
      assertEquals(coreValueEquals(invalid1, invalid2), false);

      // WHY: timezone-equivalent instants must be equal by value (same getTime) for both compare and equals.
      const utc = new Date('2024-01-01T00:00:00.000Z');
      const plusOne = new Date('2024-01-01T01:00:00+01:00');
      assertEquals(utc.getTime(), plusOne.getTime());
      assertEquals(coreValueCompare(utc, plusOne), 0);
      assertEquals(coreValueCompare(plusOne, utc), 0);
      assertEquals(coreValueEquals(utc, plusOne), true);
    },
  );

  TEST('CoreValueCompare', 'orders Number values numerically', () => {
    // WHY: numbers must compare numerically (2 < 10), not via string representation.
    assertEquals(coreValueCompare(2, 10), -1);
    assertEquals(coreValueCompare(10, 2), 1);
    assertEquals(coreValueCompare(2, 2), 0);
    assertTrue(coreValueCompare(-1, 0) < 0);
    assertTrue(coreValueCompare(0, -1) > 0);
    assertTrue(coreValueCompare(1.5, 1) > 0);
    // Large numbers compare correctly regardless of magnitude
    assertEquals(
      coreValueCompare(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1),
      1,
    );
    assertEquals(
      coreValueCompare(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER),
      -1,
    );
    assertEquals(coreValueCompare(2 ** 52, 2 ** 52 - 1), 1);
    // Antisymmetry: sign flips on reversed operands
    assertEquals(coreValueCompare(10, 2) * coreValueCompare(2, 10), -1);
  });

  TEST('CoreValueCompare', 'orders NaN and infinities', () => {
    // WHY: NaN sorts below all valid numbers, NaN==NaN for ordering
    assertEquals(coreValueCompare(NaN, NaN), 0);
    assertTrue(coreValueCompare(NaN, 0) < 0);
    assertTrue(coreValueCompare(0, NaN) > 0);
    assertTrue(coreValueCompare(NaN, -Infinity) < 0);
    assertTrue(coreValueCompare(NaN, Infinity) < 0);
    // Infinities at the extremes of the valid-number range
    assertTrue(coreValueCompare(-Infinity, 0) < 0);
    assertTrue(coreValueCompare(0, Infinity) < 0);
    assertEquals(coreValueCompare(-Infinity, -Infinity), 0);
    assertEquals(coreValueCompare(Infinity, Infinity), 0);
    // Compare says NaN==NaN, but equals says NaN != NaN (numbersEqual uses epsilon)
    assertEquals(coreValueEquals(NaN, NaN), false);
    assertEquals(coreValueEquals(NaN, 0), false);
  });

  TEST('CoreValueCompare', 'orders Boolean values consistently', () => {
    // WHY: false < true in numeric coercion (0 < 1)
    assertEquals(coreValueCompare(false, false), 0);
    assertEquals(coreValueCompare(true, true), 0);
    assertTrue(coreValueCompare(false, true) < 0);
    assertTrue(coreValueCompare(true, false) > 0);
  });

  TEST('CoreValueCompare', 'Date transitivity holds', () => {
    // WHY: total-order comparator must satisfy a<=b, b<=c => a<=c.
    const a = new Date('2024-01-01T00:00:00.000Z');
    const b = new Date('2024-01-02T00:00:00.000Z');
    const c = new Date('2024-01-03T00:00:00.000Z');
    assertTrue(coreValueCompare(a, b) <= 0);
    assertTrue(coreValueCompare(b, c) <= 0);
    assertTrue(coreValueCompare(a, c) <= 0);
    // Invalid Date included in chain: Invalid < a < b
    const invalid = new Date('invalid');
    assertTrue(coreValueCompare(invalid, a) <= 0);
    assertTrue(coreValueCompare(a, b) <= 0);
    assertTrue(coreValueCompare(invalid, b) <= 0);
  });

  TEST('CoreValueCompare', 'Number transitivity holds', () => {
    // WHY: total-order comparator must satisfy a<=b, b<=c => a<=c.
    // Chain: NaN < -Infinity < 0 < Infinity
    assertTrue(coreValueCompare(NaN, -Infinity) <= 0);
    assertTrue(coreValueCompare(-Infinity, 0) <= 0);
    assertTrue(coreValueCompare(NaN, 0) <= 0);
    // Chain: -1 < 0 < 1
    assertTrue(coreValueCompare(-1, 0) <= 0);
    assertTrue(coreValueCompare(0, 1) <= 0);
    assertTrue(coreValueCompare(-1, 1) <= 0);
    // Chain: NaN < 0 < Infinity (NaN sorts below all)
    assertTrue(coreValueCompare(NaN, 0) <= 0);
    assertTrue(coreValueCompare(0, Infinity) <= 0);
    assertTrue(coreValueCompare(NaN, Infinity) <= 0);
  });
}
