/**
 * Unit tests for deterministic query identifiers that power query
 * deduplication and persistence.
 *
 * These are pure-function tests (no DB, no I/O) so they run in <1ms.
 */
import { assertEquals, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import {
  generatedQueryIdsSize,
  generateQueryId,
  resetGeneratedQueryIds,
  resolveQueryId,
} from '../repo/query.ts';

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
    'sortDescending:undefined resolves to the default false ID',
    () => {
      const undef = resolveQueryId({ source: kSource });
      const falsy = resolveQueryId({
        source: kSource,
        sortDescending: false,
      });
      const truthy = resolveQueryId({
        source: kSource,
        sortDescending: true,
      });
      assertEquals(undef, falsy);
      assertTrue(undef !== truthy, 'false vs true');
    },
  );

  // --- limit independence ---------------------------------------------------
  TEST(
    'QueryId',
    'limit:undefined resolves to the default zero ID',
    () => {
      const defaults = [undefined, 0].map((limit) =>
        resolveQueryId({ source: kSource, limit })
      );
      const nonDefaults = [1, 10, 100].map((limit) =>
        resolveQueryId({ source: kSource, limit })
      );
      assertEquals(defaults[0], defaults[1]);
      assertEquals(
        new Set([...defaults, ...nonDefaults]).size,
        nonDefaults.length + 1,
      );
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
    'liveUpdates:undefined resolves to the default true ID',
    () => {
      const undef = resolveQueryId({ source: kSource });
      const falsy = resolveQueryId({
        source: kSource,
        liveUpdates: false,
      });
      const truthy = resolveQueryId({
        source: kSource,
        liveUpdates: true,
      });
      assertEquals(undef, truthy);
      assertTrue(undef !== falsy, 'true vs false');
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

  // --- Generated-ID cache --------------------------------------------------
  TEST(
    'QueryId',
    'generated-ID cache keeps at most 10,000 entries',
    () => {
      resetGeneratedQueryIds();
      try {
        for (let i = 0; i <= 10_000; i++) {
          generateQueryId(
            `/data/query-id-${i}`,
            kPredicate,
            kSortBy,
            kCtx,
            kNs,
          );
        }
        assertEquals(generatedQueryIdsSize(), 10_000);
      } finally {
        resetGeneratedQueryIds();
      }
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

  TEST(
    'QueryId',
    'equivalent repository and item paths produce the same ID',
    () => {
      const sources = [
        '/data/items',
        'data/items/',
        '/data/items/item',
        '/data/items/item/embed',
      ];
      const generatedIds = sources.map((source) =>
        generateQueryId(source, kPredicate, kSortBy, kCtx, kNs)
      );
      const resolvedIds = sources.map((source) => resolveQueryId({ source }));
      assertEquals(new Set(generatedIds).size, 1);
      assertEquals(new Set(resolvedIds).size, 1);
    },
  );

  // --- Sentinel serialization ----------------------------------------------
  TEST(
    'QueryId',
    'undefined, null, and string sentinels produce distinct IDs',
    () => {
      const sort = () => 0;
      const ids = [
        generateQueryId(kSource, kPredicate, kSortBy, kCtx, undefined),
        generateQueryId(kSource, kPredicate, kSortBy, kCtx, null),
        generateQueryId(kSource, kPredicate, kSortBy, kCtx, 'undefined'),
        generateQueryId(kSource, kPredicate, kSortBy, kCtx, 'null'),
        generateQueryId(kSource, kPredicate, kSortBy, kCtx, ''),
        generateQueryId(kSource, kPredicate, undefined, kCtx, kNs),
        generateQueryId(kSource, kPredicate, 'undefined', kCtx, kNs),
        generateQueryId(kSource, kPredicate, 'null', kCtx, kNs),
        generateQueryId(kSource, kPredicate, '', kCtx, kNs),
        generateQueryId(kSource, kPredicate, sort, kCtx, kNs),
      ];
      assertEquals(new Set(ids).size, ids.length);
    },
  );

  // --- ns independence ------------------------------------------------------
  TEST(
    'QueryId',
    'different ns values produce different IDs',
    () => {
      const a = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        'ns-a',
      );
      const b = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        'ns-b',
      );
      const c = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        undefined,
      );
      const d = generateQueryId(
        kSource,
        kPredicate,
        kSortBy,
        kCtx,
        null,
      );
      assertTrue(a !== b, 'ns-a vs ns-b');
      assertTrue(a !== c, 'ns-a vs undefined');
      assertTrue(a !== d, 'ns-a vs null');
      assertTrue(c !== d, 'undefined vs null');
    },
  );

  // --- sortBy independence --------------------------------------------------
  TEST(
    'QueryId',
    'different sortBy values produce different IDs',
    () => {
      const a = generateQueryId(
        kSource,
        kPredicate,
        'name' as string,
        kCtx,
        kNs,
      );
      const b = generateQueryId(
        kSource,
        kPredicate,
        'date' as string,
        kCtx,
        kNs,
      );
      const c = generateQueryId(
        kSource,
        kPredicate,
        undefined,
        kCtx,
        kNs,
      );
      assertTrue(a !== b, 'name vs date');
      assertTrue(a !== c, 'name vs undefined');
      assertTrue(b !== c, 'date vs undefined');
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
