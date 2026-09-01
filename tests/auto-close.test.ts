/**
 * Tests for the Automatic Closing of Repositories & Queries feature.
 *
 * These tests cover:
 * - Config plumbing (DBInstanceConfig fields, defaults)
 * - Activity touch points (item(), open(), query() record timestamps)
 * - Query auto-close via _testFireInactivityCheck()
 * - Repo auto-close via _testFireInactivityCheck()
 * - Reopen grace: commit() reopens an auto-closed repo
 * - Cleanup: close() stops the checker timer
 *
 * All tests that would otherwise wait on real timers use
 * db._testFireInactivityCheck() to fire the check synchronously,
 * with manually-set past timestamps so the inactivity timeout
 * is immediately exceeded.
 */

import { assertTrue, assertEquals, assertExists } from './asserts.ts';
import { TEST } from './mod.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { isBrowser } from '../base/common.ts';
import { sleep } from '../base/time.ts';

// ── Test Schema ───────────────────────────────────────────────────
const kAutoCloseSchema = {
  ns: 'auto-close-test',
  version: 1,
  fields: {
    value: { type: 'string', default: () => '' },
  },
} as const;

const kRegistry = new DataRegistry();
kRegistry.registerSchema(kAutoCloseSchema);

/** Helper: cast db to any for accessing private test hooks. */
function p(db: unknown): any {
  return db as any;
}

export default function setup(): void {
  // ════════════════════════════════════════════════════════════════
  // Part 1: Config Plumbing
  // ════════════════════════════════════════════════════════════════
  TEST('AutoClose', 'config properties exist with correct values', async (ctx) => {
    const db = await ctx.createDB('ac-config', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 5000,
      queryInactivityTimeoutMs: 2000,
      inactivityCheckIntervalMs: 1000,
    });
    try {
      await db.readyPromise();
      assertEquals(p(db).repoInactivityTimeoutMs, 5000);
      assertEquals(p(db).queryInactivityTimeoutMs, 2000);
      assertEquals(p(db).inactivityCheckIntervalMs, 1000);
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'defaults to 0 (disabled) when not configured', async (ctx) => {
    const db = await ctx.createDB('ac-defaults', { registry: kRegistry });
    try {
      await db.readyPromise();
      assertEquals(p(db).repoInactivityTimeoutMs, 0);
      assertEquals(p(db).queryInactivityTimeoutMs, 0);
      assertEquals(p(db)._inactivityTimer, undefined);
    } finally {
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Part 2: Activity Touch Points
  // ════════════════════════════════════════════════════════════════
  TEST('AutoClose', 'item() records repo activity', async (ctx) => {
    const db = await ctx.createDB('ac-touch-item', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 60000,
    });
    try {
      await db.readyPromise();
      const map = p(db)._lastActivityByRepo as Map<string, number>;
      assertEquals(map.has('/data/items'), false);
      db.item('/data/items/any-key');
      assertTrue(map.has('/data/items'), 'item() should touch repo');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'open() records repo activity', async (ctx) => {
    const db = await ctx.createDB('ac-touch-open', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 60000,
    });
    try {
      await db.readyPromise();
      const map = p(db)._lastActivityByRepo as Map<string, number>;
      assertEquals(map.has('/data/items'), false, 'no activity before open');
      await db.open('/data/items');
      assertTrue(map.has('/data/items'), 'open() should touch repo');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'query() records query activity', async (ctx) => {
    const db = await ctx.createDB('ac-touch-query', {
      registry: kRegistry,
      queryInactivityTimeoutMs: 60000,
    });
    try {
      await db.readyPromise();
      const q = p(db).query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q.loadingFinished();
      const queryMap = p(db)._lastActivityByQuery as Map<string, number>;
      assertTrue(queryMap.has(q.id), 'query() should touch query');
      q.close();
    } finally {
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Part 3: Query Auto-Close
  // ════════════════════════════════════════════════════════════════
  TEST('AutoClose', 'query without listeners auto-closes after timeout', async (ctx) => {
    const db = await ctx.createDB('ac-query-close', {
      registry: kRegistry,
      queryInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      const q = p(db).query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q.loadingFinished();
      const qid = q.id;
      assertTrue(p(db)._openQueries.has(qid), 'query open initially');

      // Set query activity to distant past so timeout is exceeded
      p(db)._lastActivityByQuery.set(qid, 0);
      await p(db)._testFireInactivityCheck();

      assertEquals(p(db)._openQueries.has(qid), false, 'query should be closed');
      assertEquals(p(q)._closed, true);
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'query with listener does NOT auto-close', async (ctx) => {
    const db = await ctx.createDB('ac-query-active', {
      registry: kRegistry,
      queryInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      const q = p(db).query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q.loadingFinished();
      const qid = q.id;
      const unsub = q.attach('DocumentChanged', () => {});

      // Stale last-activity time, but listener keeps it alive
      p(db)._lastActivityByQuery.set(qid, 0);
      await p(db)._testFireInactivityCheck();

      assertTrue(p(db)._openQueries.has(qid), 'active query stays open');
      unsub();
      q.close();
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'chained query auto-closes when no listeners', async (ctx) => {
    const db = await ctx.createDB('ac-query-chain', {
      registry: kRegistry,
      queryInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      // Create base query via db.query() so it registers in _openQueries
      const base = p(db).query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await base.loadingFinished();
      // Stale base query activity — verify it gets closed
      p(db)._lastActivityByQuery.set(base.id, 0);
      await p(db)._testFireInactivityCheck();

      assertEquals(p(base)._closed, true, 'base query should close');
    } finally {
      await db.close();
    }
  });

  // Note: Query tests use `db.query()` (the public API) rather than
  // `new Query(...)` because only `db.query()` registers queries in
  // `_openQueries` and calls `_touchQuery()`. Chained queries
  // (using `new Query({ source: baseQuery, ... })`) don't register
  // via `db.query()` and are not tracked for auto-close (they close
  // when the base query closes).

  // ════════════════════════════════════════════════════════════════
  // Part 4: Repo Auto-Close
  // ════════════════════════════════════════════════════════════════
  TEST('AutoClose', 'bare repo auto-closes after timeout', async (ctx) => {
    const db = await ctx.createDB('ac-repo-bare', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      await db.open('/data/items');
      assertTrue(p(db)._repositories.has('/data/items'), 'repo open initially');

      // Set repo activity to distant past so timeout is exceeded
      p(db)._lastActivityByRepo.set('/data/items', 0);
      await p(db)._testFireInactivityCheck();

      assertEquals(p(db)._repositories.has('/data/items'), false, 'bare repo should close');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'repo with active ManagedItem stays open', async (ctx) => {
    const db = await ctx.createDB('ac-repo-item', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      db.create('/data/items/stay', kAutoCloseSchema, { value: 'x' });

      // Set repo activity to distant past — but item should keep it alive
      p(db)._lastActivityByRepo.set('/data/items', 0);
      await p(db)._testFireInactivityCheck();

      assertTrue(p(db)._repositories.has('/data/items'), 'repo with item stays open');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('AutoClose', 'repo with active Query stays open', async (ctx) => {
    const db = await ctx.createDB('ac-repo-query', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      const q = p(db).query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q.loadingFinished();

      // Stale repo activity but query protects it
      p(db)._lastActivityByRepo.set('/data/items', 0);
      await p(db)._testFireInactivityCheck();

      assertTrue(p(db)._repositories.has('/data/items'), 'repo with query stays open');
      q.close();
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'repo closes even with external listener when no items/queries', async (ctx) => {
    // A repo-only event listener does NOT prevent auto-close because
    // GoatDB cannot distinguish internal repo listeners from external
    // ones. Users should open an item or query if they need the repo
    // to stay alive.
    const db = await ctx.createDB('ac-repo-listener', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      const repo = await db.open('/data/items');
      repo.attach('DocumentChanged', () => {});

      // Stale repo activity — will close because no items/queries
      p(db)._lastActivityByRepo.set('/data/items', 0);
      await p(db)._testFireInactivityCheck();

      assertEquals(p(db)._repositories.has('/data/items'), false,
        'repo closes when only listeners are attached (no items/queries)');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'sys repos are never auto-closed', async (ctx) => {
    const db = await ctx.createDB('ac-repo-sys', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      await db.open('/sys/sessions');

      // Stale repo activity — but /sys/ should be immune
      p(db)._lastActivityByRepo.set('/sys/sessions', 0);
      await p(db)._testFireInactivityCheck();

      assertTrue(p(db)._repositories.has('/sys/sessions'), '/sys/sessions should not auto-close');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'repo with chained query stays open', async (ctx) => {
    const db = await ctx.createDB('ac-repo-chain', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      const q1 = p(db).query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q1.loadingFinished();

      // Stale repo activity — but open query protects it
      p(db)._lastActivityByRepo.set('/data/items', 0);
      await p(db)._testFireInactivityCheck();

      assertTrue(p(db)._repositories.has('/data/items'), 'repo with query stays open');
      q1.close();
    } finally {
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Part 5: Reopen Grace
  // ════════════════════════════════════════════════════════════════
  TEST('AutoClose', 'commit() reopens auto-closed repo', async (ctx) => {
    const db = await ctx.createDB('ac-reopen', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const item = db.create('/data/items/reopen', kAutoCloseSchema, { value: 'a' });
      await item.commit();
      await db.flush('/data/items');

      // Close repo manually
      await db.closeRepo('/data/items');
      assertEquals(p(db)._repositories.has('/data/items'), false, 'repo should be closed');

      // Write — should reopen via commit()
      item.set('value', 'b');
      await item.commit();
      assertTrue(p(db)._repositories.has('/data/items'), 'commit() reopened repo');
      assertEquals(item.get('value'), 'b');
      await db.flush('/data/items');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'item.get() works from memory when repo is closed', async (ctx) => {
    const db = await ctx.createDB('ac-get-memory', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const item = db.create('/data/items/mem', kAutoCloseSchema, { value: 'cached' });
      await item.commit();
      await db.flush('/data/items');

      // Close repo
      await db.closeRepo('/data/items');
      assertEquals(p(db)._repositories.has('/data/items'), false);

      // get() reads from in-memory state
      assertEquals(item.get('value'), 'cached');
    } finally {
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Part 6: Cleanup
  // ════════════════════════════════════════════════════════════════
  TEST('AutoClose', 'close() stops the checker timer', async (ctx) => {
    const db = await ctx.createDB('ac-cleanup', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    await db.readyPromise();
    const timer = p(db)._inactivityTimer;
    assertExists(timer, 'timer created');
    await db.close();
    assertEquals(p(timer)._isScheduled, false, 'timer unscheduled after close');
  });

  TEST('AutoClose', 'db remains usable after auto-close cycle', async (ctx) => {
    const db = await ctx.createDB('ac-usable', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
      inactivityCheckIntervalMs: 50,
    });
    try {
      await db.readyPromise();
      db.create('/data/items/phase1', kAutoCloseSchema, { value: 'first' });
      await db.flush('/data/items');

      // Repo shouldn't close because item is still active
      await p(db)._testFireInactivityCheck();
      assertTrue(p(db)._repositories.has('/data/items'), 'repo stays open with item');

      // Now do new work
      const item2 = db.create('/data/items/phase2', kAutoCloseSchema, { value: 'second' });
      await item2.commit();
      await db.flush('/data/items');
      assertEquals(item2.get('value'), 'second');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // E2E: Real Timer Tests (non-browser only, use sleep())
  // ════════════════════════════════════════════════════════════════
  if (!isBrowser()) {
    TEST('AutoClose', 'E2E: real timer auto-closes idle repo', async (ctx) => {
      const db = await ctx.createDB('ac-e2e-real', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 200,
        inactivityCheckIntervalMs: 100,
      });
      try {
        await db.readyPromise();
        // Open bare repo — no items, no queries, no listeners
        await db.open('/data/items');
        assertTrue(p(db)._repositories.has('/data/items'));

        // The timer check runs every 100ms and repo timeout is 200ms.
        // After ~200ms the check should fire and detect inactivity.
        await sleep(600);

        assertEquals(
          p(db)._repositories.has('/data/items'),
          false,
          'repo should be closed by real timer',
        );
      } finally {
        await db.close();
      }
    });

    TEST('AutoClose', 'E2E: timer does not fire when feature is disabled', async (ctx) => {
      const db = await ctx.createDB('ac-e2e-disabled', { registry: kRegistry });
      try {
        await db.readyPromise();
        assertEquals(p(db)._inactivityTimer, undefined, 'no timer created when disabled');
        await db.open('/data/items');
        await sleep(500);
        assertTrue(p(db)._repositories.has('/data/items'), 'repo still open with disabled feature');
      } finally {
        await db.close();
      }
    });
  }
}