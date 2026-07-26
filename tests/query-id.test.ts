/**
 * Unit tests for `generateQueryId` — the deterministic cache-key function
 * that powers query deduplication and persistence.
 *
 * These are pure-function tests (no DB, no I/O) so they run in <1ms.
 */
import { assertEquals, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import { generateQueryId } from '../repo/query.ts';

// Stable inputs used as baseline for all tests.
const kSource = '/data/items';
const kPredicate = undefined;
const kSortBy = undefined;
const kCtx = undefined;
const kNs = 'test-ns';

export default function setup(): void {
  // --- Determinism ----------------------------------------------------------
  TEST(
    'QueryId',
    'same inputs produce same output',
    () => {
      const a = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        false,
        10,
        true,
      );
      const b = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        false,
        10,
        true,
      );
      assertEquals(a, b);
    },
  );

  // --- sortDescending independence ------------------------------------------
  TEST(
    'QueryId',
    'sortDescending:false and sortDescending:true produce different IDs',
    () => {
      const a = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        false,
        10,
        true,
      );
      const b = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        true,
        10,
        true,
      );
      assertTrue(a !== b, `IDs should differ: ${a}`);
    },
  );

  TEST(
    'QueryId',
    'sortDescending:undefined produces a distinct ID from false and true',
    () => {
      const undef = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        undefined,
        10,
        true,
      );
      const falsy = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        false,
        10,
        true,
      );
      const truthy = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        true,
        10,
        true,
      );
      assertTrue(undef !== falsy, 'undefined vs false');
      assertTrue(undef !== truthy, 'undefined vs true');
      assertTrue(falsy !== truthy, 'false vs true');
    },
  );

  // --- limit independence ---------------------------------------------------
  TEST(
    'QueryId',
    'different limit values produce different IDs',
    () => {
      const ids = [undefined, 0, 1, 10, 100].map((limit) =>
        generateQueryId(
          kSource,
          kPredicate,
          kSortBy,
          kCtx,
          kNs,
          false,
          limit,
          true,
        )
      );
      // All 5 must be unique
      const unique = new Set(ids);
      assertEquals(unique.size, ids.length, `collision among limits: ${ids}`);
    },
  );

  // --- liveUpdates independence ---------------------------------------------
  TEST(
    'QueryId',
    'liveUpdates:false and liveUpdates:true produce different IDs',
    () => {
      const a = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        false,
        10,
        true,
      );
      const b = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        false,
        10,
        false,
      );
      assertTrue(a !== b, `IDs should differ: ${a}`);
    },
  );

  TEST(
    'QueryId',
    'liveUpdates:undefined produces a distinct ID from false and true',
    () => {
      const undef = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        false,
        10,
        undefined,
      );
      const falsy = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        false,
        10,
        false,
      );
      const truthy = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        false,
        10,
        true,
      );
      assertTrue(undef !== falsy, 'undefined vs false');
      assertTrue(undef !== truthy, 'undefined vs true');
      assertTrue(falsy !== truthy, 'false vs true');
    },
  );

  // --- Regression: issue #46 ------------------------------------------------
  TEST(
    'QueryId',
    'configs differing only in sortDescending/limit/liveUpdates produce distinct IDs (#46)',
    () => {
      const base = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
      );
      const withSortDesc = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        true,
      );
      const withLimit = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        undefined,
        50,
      );
      const withLive = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        undefined,
        undefined,
        false,
      );
      const allThree = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
        true,
        50,
        false,
      );

      const ids = [base, withSortDesc, withLimit, withLive, allThree];
      const unique = new Set(ids);
      assertEquals(
        unique.size,
        ids.length,
        `collision among config variants: ${ids}`,
      );
    },
  );

  // --- Source type variants -------------------------------------------------
  TEST(
    'QueryId',
    'different source strings produce different IDs',
    () => {
      const a = generateQueryId(
        '/data/items',
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
      );
      const b = generateQueryId(
        '/data/other',
        kPredicate,
        kSortBy,
        kCtx,
        kNs,
      );
      assertTrue(a !== b, `IDs should differ: ${a}`);
    },
  );

  // --- Predicate / sortBy independence (pre-existing, lock down) ------------
  TEST(
    'QueryId',
    'different predicates produce different IDs',
    () => {
      // deno-lint-ignore no-explicit-any
      const predA: any = ({ item }: { item: { get: (k: string) => number } }) =>
        item.get('value') > 5;
      // deno-lint-ignore no-explicit-any
      const predB: any = ({ item }: { item: { get: (k: string) => number } }) =>
        item.get('value') > 10;

      const a = generateQueryId(
        kSource,
        predA,
        kSortBy,
        kCtx,
        kNs,
      );
      const b = generateQueryId(
        kSource,
        predB,
        kSortBy,
        kCtx,
        kNs,
      );
      assertTrue(a !== b, `IDs should differ: ${a}`);
    },
  );

  TEST(
    'QueryId',
    'different ctx values produce different IDs',
    () => {
      const a = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        { min: 5 },
        kNs,
      );
      const b = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        { min: 10 },
        kNs,
      );
      assertTrue(a !== b, `IDs should differ: ${a}`);
    },
  );
}
