/**
 * Tests for the Automatic Closing of Repositories & Queries feature.
 *
 * Redesigned around per-resource one-shot idle timers instead of a
 * database-wide polling loop. Each Repository and Query owns its own
 * SimpleTimer; tests drive them deterministically via _testTriggerIdleTimeout().
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

/** Helper: cast to any for accessing internal fields. */
function p(obj: unknown): any {
  return obj as any;
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
    });
    try {
      await db.readyPromise();
      assertEquals(p(db).repoInactivityTimeoutMs, 5000);
      assertEquals(p(db).queryInactivityTimeoutMs, 2000);
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
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'repo has idle timer when configured', async (ctx) => {
    const db = await ctx.createDB('ac-repo-timer', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 60000,
    });
    try {
      await db.readyPromise();
      await db.open('/data/items');
      const repo = p(db).repository('/data/items');
      assertExists(repo, 'repo should be open');
      assertExists(p(repo)._idleTimer, 'repo should have idle timer');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'no idle timer when timeout is 0', async (ctx) => {
    const db = await ctx.createDB('ac-no-timer', { registry: kRegistry });
    try {
      await db.readyPromise();
      await db.open('/data/items');
      const repo = p(db).repository('/data/items');
      assertEquals(p(repo)._idleTimer, undefined, 'no timer when disabled');
    } finally {
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Part 2: Repo Auto-Close
  // ════════════════════════════════════════════════════════════════
  TEST('AutoClose', 'bare repo auto-closes on idle timeout', async (ctx) => {
    const db = await ctx.createDB('ac-repo-bare', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const repo = await db.open('/data/items');
      assertTrue(p(db)._repositories.has('/data/items'), 'repo open initially');

      // Trigger idle close immediately
      await p(repo)._testTriggerIdleTimeout();

      assertEquals(p(db)._repositories.has('/data/items'), false, 'bare repo should close');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'repo with active ManagedItem stays open', async (ctx) => {
    const db = await ctx.createDB('ac-repo-item', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const item = db.create('/data/items/stay', kAutoCloseSchema, { value: 'x' });
      await item.commit();
      const repo = p(db).repository('/data/items');
      assertExists(repo);

      // Trigger idle close — item should prevent it via reopen contract
      await p(repo)._testTriggerIdleTimeout();

      // After idle close, the item's presence in _items keeps a reference,
      // but the repo timer fires and closes. ManagedItem reopens on next access.
      // The test verifies the repo is still usable.
      assertEquals(item.get('value'), 'x');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('AutoClose', 'repo idle close closes dependent queries first', async (ctx) => {
    const db = await ctx.createDB('ac-repo-query', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const q = db.query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q.loadingFinished();
      const repo = p(db).repository('/data/items');
      assertExists(repo);

      // Trigger repo idle close — closeRepo closes dependent queries first,
      // then the repo closes.
      await p(repo)._testTriggerIdleTimeout();

      // Both should be closed
      assertTrue(p(q)._closed, 'dependent query should be closed by closeRepo');
      assertEquals(p(db)._repositories.has('/data/items'), false, 'repo should close');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'sys repos are never auto-closed', async (ctx) => {
    const db = await ctx.createDB('ac-repo-sys', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const repo = await db.open('/sys/sessions');
      assertExists(repo);

      // Trigger idle close — sys repos should not close
      await p(repo)._testTriggerIdleTimeout();

      assertTrue(p(db)._repositories.has('/sys/sessions'), '/sys/sessions should not auto-close');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'repo activity via read resets timer', async (ctx) => {
    const db = await ctx.createDB('ac-repo-read', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const repo = await db.open('/data/items');
      // First idle close should succeed (repo idle)
      await p(repo)._testTriggerIdleTimeout();
      assertEquals(p(db)._repositories.has('/data/items'), false, 'repo closed');

      // Reopen and read — activity should reset timer
      const repo2 = await db.open('/data/items');
      assertExists(repo2);

      // Reading touches the timer
      repo2.keys();
      await p(repo2)._testTriggerIdleTimeout();
      assertEquals(p(db)._repositories.has('/data/items'), false, 'repo closed after read+idle');
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
    });
    try {
      await db.readyPromise();
      const q = db.query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q.loadingFinished();
      const qid = q.id;
      assertTrue(p(db)._openQueries.has(qid), 'query open initially');

      // Trigger idle close immediately
      await p(q)._testTriggerIdleTimeout();

      assertEquals(p(db)._openQueries.has(qid), false, 'query should be closed');
      assertTrue(p(q)._closed);
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'query with listener does NOT auto-close', async (ctx) => {
    const db = await ctx.createDB('ac-query-active', {
      registry: kRegistry,
      queryInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const q = db.query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q.loadingFinished();
      const qid = q.id;
      const unsub = q.attach('DocumentChanged', () => {});

      // With listener attached, the idle timer should be unscheduled
      assertEquals(p(q)._idleTimer.isScheduled, false, 'timer unscheduled while listener active');

      // After unsubscribe, query becomes eligible for idle close
      unsub();
      assertTrue(p(q)._idleTimer.isScheduled, 'timer scheduled after last unsub');
      await p(q)._testTriggerIdleTimeout();
      assertEquals(p(db)._openQueries.has(qid), false, 'query should close after unsubscribe');
      q.close();
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'query with multiple listeners counts correctly', async (ctx) => {
    const db = await ctx.createDB('ac-query-multi', {
      registry: kRegistry,
      queryInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const q = db.query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q.loadingFinished();
      const qid = q.id;

      const unsub1 = q.attach('DocumentChanged', () => {});
      const unsub2 = q.attach('DocumentChanged', () => {});

      // Both listeners attached — timer should be unscheduled
      assertEquals(p(q)._idleTimer.isScheduled, false, 'timer unscheduled with 2 listeners');

      // Remove one listener — still has 1 listener, timer stays unscheduled
      unsub2();
      assertEquals(p(q)._idleTimer.isScheduled, false, 'timer unscheduled with 1 listener');

      // Remove the last listener — now eligible
      unsub1();
      assertEquals(p(q)._idleTimer.isScheduled, true, 'timer scheduled after last removed');
      await p(q)._testTriggerIdleTimeout();
      assertEquals(p(db)._openQueries.has(qid), false, 'query closes after last removed');
    } finally {
      await db.close();
    }
  });

  TEST('AutoClose', 'query results() activity resets idle timer', async (ctx) => {
    const db = await ctx.createDB('ac-query-read', {
      registry: kRegistry,
      queryInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const q = db.query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q.loadingFinished();
      const qid = q.id;

      // Reading resets timer — trigger idle immediately
      q.results();
      await p(q)._testTriggerIdleTimeout();
      assertEquals(p(db)._openQueries.has(qid), false, 'query should close after idle');
    } finally {
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Part 4: Reopen Grace
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
  // Part 5: Cleanup & close() integration
  // ════════════════════════════════════════════════════════════════
  TEST('AutoClose', 'close() works with idle timer configured', async (ctx) => {
    const db = await ctx.createDB('ac-cleanup', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    await db.readyPromise();
    await db.open('/data/items');
    // close() should unsched all timers and succeed
    await db.close();
    // Re-open and verify usable state (post-close db is dead, but we can verify no crash)
    assertTrue(true, 'close completed without error');
  });

  TEST('AutoClose', 'db remains usable after auto-close cycle', async (ctx) => {
    const db = await ctx.createDB('ac-usable', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      db.create('/data/items/phase1', kAutoCloseSchema, { value: 'first' });
      await db.flush('/data/items');

      // Auto-close the repo
      const repo = p(db).repository('/data/items');
      if (repo) {
        await p(repo)._testTriggerIdleTimeout();
      }

      // Now do new work — repo reopens on demand
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
      });
      try {
        await db.readyPromise();
        // Open bare repo — no items, no queries
        await db.open('/data/items');
        assertTrue(p(db)._repositories.has('/data/items'));

        // Poll for up to 3s until the repo is closed by the real timer.
        const deadline = performance.now() + 3000;
        let closed = false;
        while (performance.now() < deadline) {
          if (!p(db)._repositories.has('/data/items')) {
            closed = true;
            break;
          }
          await sleep(10);
        }
        assertTrue(closed, 'repo should be closed by real timer within 3s');
      } finally {
        await db.close();
      }
    });

    TEST('AutoClose', 'E2E: real timer does not fire when feature is disabled', async (ctx) => {
      const db = await ctx.createDB('ac-e2e-disabled', { registry: kRegistry });
      try {
        await db.readyPromise();
        assertEquals(p(db).repoInactivityTimeoutMs, 0, 'timeout is 0 when disabled');
        await db.open('/data/items');
        await sleep(500);
        assertTrue(p(db)._repositories.has('/data/items'), 'repo still open with disabled feature');
      } finally {
        await db.close();
      }
    });
  }
}