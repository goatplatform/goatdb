/**
 * Tests for the Automatic Closing of Repositories & Queries feature.
 *
 * Design (lease-based, per-resource one-shot timers):
 *  - Each Repository and Query owns a one-shot SimpleTimer; no global poller.
 *  - A repo/query is eligible for idle close only when it has no active
 *    leases, no external `DocumentChanged` listeners (derived from Emitter's
 *    own registrations via listenerCount), no open dependent queries, and is
 *    not a /sys/ repo.
 *  - Auto-close tears down the repo directly (_tearDownRepo) and does NOT
 *    call item.commit(). Pending edits reopen the repo on demand via
 *    acquireRepo (which awaits any in-flight close).
 *  - `db.acquireRepo()` returns a Disposable lease token; releasing it
 *    re-arms the idle timer.
 *  - A formal `open -> closing -> closed` state machine serializes
 *    close/open, so close/open cannot overlap and a slow open cannot
 *    immediately expire.
 *
 * Tests assert observable lifecycle contracts through public APIs where one
 * exists (e.g. `db.repository(path) === undefined`). A few assertions still
 * read @internal state that has no public equivalent (open-query membership,
 * the log-file map, close state, idle-ready flag); those are marked in-line.
 * Deterministic hooks (`_testTriggerIdleTimeout`) drive eligibility decisions;
 * only a small E2E layer uses real timers for scheduler integration.
 */

import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { isBrowser } from '../base/common.ts';
import { sleep } from '../base/time.ts';
import { ServerError } from '../cfds/base/errors.ts';
import { Item } from '../cfds/base/item.ts';
import type { Repository } from '../repo/repo.ts';

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
// deno-lint-ignore no-explicit-any
function p(obj: unknown): any {
  // deno-lint-ignore no-explicit-any
  return obj as any;
}

/** Helper: resolve the (possibly re-opened) repository for a path. */
// deno-lint-ignore no-explicit-any
function repoFor(db: any, repoId: string): Repository | undefined {
  return db.repository(repoId);
}

/**
 * Asserts that an async call rejects with a ServerError, i.e. the explicit
 * `serviceUnavailable()` failure used by the write-during-close guard.
 */
async function assertRejectsServiceUnavailable(
  fn: () => Promise<unknown>,
  message: string,
): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  assertTrue(caught instanceof ServerError, message);
}

export default function setup(): void {
  // ════════════════════════════════════════════════════════════════
  // Part 1: Config Plumbing (reused — verifies wiring, unchanged)
  // ════════════════════════════════════════════════════════════════
  TEST(
    'AutoClose',
    'config properties exist with correct values',
    async (ctx) => {
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
    },
  );

  TEST(
    'AutoClose',
    'defaults to 0 (disabled) when not configured',
    async (ctx) => {
      const db = await ctx.createDB('ac-defaults', { registry: kRegistry });
      try {
        await db.readyPromise();
        assertEquals(p(db).repoInactivityTimeoutMs, 0);
        assertEquals(p(db).queryInactivityTimeoutMs, 0);
      } finally {
        await db.close();
      }
    },
  );

  TEST('AutoClose', 'negative timeout throws', async (ctx) => {
    // A negative value would spin a timer in the old global-poller design;
    // now rejected at construction and at the value level.
    let threw = false;
    try {
      await ctx.createDB('ac-negative', {
        registry: kRegistry,
        repoInactivityTimeoutMs: -1,
      });
    } catch {
      threw = true;
    }
    assertTrue(threw, 'negative repoInactivityTimeoutMs must throw');
  });

  // ════════════════════════════════════════════════════════════════
  // Part 2: Repo Auto-Close Lifecycle Contracts
  // ════════════════════════════════════════════════════════════════

  TEST('AutoClose', 'bare repo auto-closes on idle timeout', async (ctx) => {
    const db = await ctx.createDB('ac-repo-bare', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      await db.open('/data/items');
      assertTrue(
        repoFor(db, '/data/items') !== undefined,
        'repo open initially',
      );

      await p(p(db).repository('/data/items'))._testTriggerIdleTimeout();

      assertEquals(
        db.repository('/data/items'),
        undefined,
        'bare repo closes',
      );
    } finally {
      await db.close();
    }
  });

  TEST(
    'AutoClose',
    'idle lease from acquireRepo prevents close',
    async (ctx) => {
      const db = await ctx.createDB('ac-lease-block', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        const repo = p(db).repository('/data/items');
        assertExists(repo);

        // Hold a lease — idle close must defer.
        const lease = await db.acquireRepo('/data/items');
        await p(repo)._testTriggerIdleTimeout();
        assertTrue(
          db.repository('/data/items') !== undefined,
          'lease pins repo open',
        );

        // Release the lease — idle close may now proceed.
        lease.dispose();
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo closes after lease released',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'auto-close never calls item.commit(); pending edit reopens repo',
    async (ctx) => {
      // An uncommitted edit (set) scheduled a 300ms commit. Auto-close must
      // close without calling item.commit(); the pending commit reopens the
      // repo on demand and persists the edit.
      const db = await ctx.createDB('ac-no-commit', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/reopen', kAutoCloseSchema, {
          value: 'a',
        });
        await item.commit();
        await db.flush('/data/items');

        // New uncommitted edit -> schedules a 300ms commit
        item.set('value', 'b');
        const repo = p(db).repository('/data/items');
        assertExists(repo);
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo auto-closed without committing',
        );

        // The pending commit fires later, reopening the repo and persisting.
        // Call commit() directly (same as the 300ms timer callback) to avoid
        // a wall-clock sleep(400) in the test.
        await item.commit();
        assertTrue(
          db.repository('/data/items') !== undefined,
          'pending edit reopened repo',
        );
        assertEquals(item.get('value'), 'b');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'repo is retained by an open query (source listener pin)',
    async (ctx) => {
      const db = await ctx.createDB('ac-query-pin', {
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

        // The query holds a DocumentChanged listener on the repo -> pin.
        await p(repo)._testTriggerIdleTimeout();
        assertTrue(
          db.repository('/data/items') !== undefined,
          'open query pins its repo',
        );

        // Close the query -> releases the repo listener -> repo can close.
        q.close();
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo closes after query closed',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'external repo listener pins the repo; final detach permits close',
    async (ctx) => {
      const db = await ctx.createDB('ac-repo-listener', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        const repo = await db.open('/data/items');
        const unsub = repo.attach('DocumentChanged', () => {});

        await p(repo)._testTriggerIdleTimeout();
        assertTrue(
          db.repository('/data/items') !== undefined,
          'external listener pins repo',
        );

        unsub();
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'final detach permits close',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST('AutoClose', 'sys repos are never auto-closed', async (ctx) => {
    const db = await ctx.createDB('ac-repo-sys', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const repo = await db.open('/sys/sessions');
      assertExists(repo);

      await p(repo)._testTriggerIdleTimeout();
      assertTrue(
        db.repository('/sys/sessions') !== undefined,
        '/sys/sessions never auto-closes',
      );
    } finally {
      await db.close();
    }
  });

  TEST(
    'AutoClose',
    'repo read activity does not pin the repo (bare repo still closes)',
    async (ctx) => {
      const db = await ctx.createDB('ac-repo-read', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        let repo = await db.open('/data/items');
        assertTrue(db.repository('/data/items') !== undefined);

        // A read (keys) touches activity but does not pin the repo:
        // the deterministic trigger ignores timer age, so this asserts that
        // reads leave the repo idle-eligible (bare repo still closes).
        repo.keys();
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo closed after read+idle',
        );

        // Reopen and verify usable.
        repo = await db.open('/data/items');
        assertExists(repo);
      } finally {
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // Part 3: Query Auto-Close Lifecycle Contracts
  // ════════════════════════════════════════════════════════════════

  TEST(
    'AutoClose',
    'unstarted query reports loading=false and is idle-eligible',
    async (ctx) => {
      const db = await ctx.createDB('ac-query-unstarted', {
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
        const qid = q.id;
        // Loading is lazy: a fresh, unobserved query is not "loading".
        assertEquals(q.loading, false, 'fresh query reports loading=false');
        assertTrue(p(db)._openQueries.has(qid), 'query open initially');

        await p(q)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._openQueries.has(qid),
          false,
          'unstarted listenerless query is idle-eligible',
        );
        assertTrue(p(q)._closed);
        // close() settles the loading waiter; this must not hang.
        await q.loadingFinished();
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'query without listeners auto-closes after timeout',
    async (ctx) => {
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

        await p(q)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._openQueries.has(qid),
          false,
          'listenerless query closes',
        );
        assertTrue(p(q)._closed);
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'query with listener does NOT auto-close; final detach permits close',
    async (ctx) => {
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

        // With a listener, idle close defers.
        await p(q)._testTriggerIdleTimeout();
        assertTrue(p(db)._openQueries.has(qid), 'listener pins query open');

        // Drop the last listener -> now eligible.
        unsub();
        await p(q)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._openQueries.has(qid),
          false,
          'query closes after last listener removed',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'query listener count derives from Emitter registrations',
    async (ctx) => {
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
        assertTrue(p(db)._openQueries.has(qid), 'query open');

        const unsub1 = q.attach('DocumentChanged', () => {});
        const unsub2 = q.attach('DocumentChanged', () => {});

        // Two listeners -> pinned.
        await p(q)._testTriggerIdleTimeout();
        assertTrue(p(db)._openQueries.has(qid), 'two listeners pin query');

        // Remove one -> still pinned.
        unsub2();
        await p(q)._testTriggerIdleTimeout();
        assertTrue(p(db)._openQueries.has(qid), 'one listener still pins');

        // Remove the last -> closes. Counts come straight from Emitter
        // registrations (not a parallel counter), so a stale counter can
        // never keep an idle query open.
        unsub1();
        await p(q)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._openQueries.has(qid),
          false,
          'no listeners permits close',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'query results() activity does not pin the query (still closes)',
    async (ctx) => {
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

        // A read (results) touches activity but does not add a listener, so the
        // query stays idle-eligible and a single deterministic trigger closes
        // it. (This cannot prove a timer reset: the hook ignores timer age.)
        q.results();
        await p(q)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._openQueries.has(qid),
          false,
          'query closes after read+idle',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST('AutoClose', 'chained query retains its source query', async (ctx) => {
    const db = await ctx.createDB('ac-chain', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
      queryInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const q1 = db.query({
        source: '/data/items',
        predicate: () => true,
        schema: kAutoCloseSchema,
      });
      await q1.loadingFinished();
      const q2 = db.query({ source: q1, predicate: () => true });
      await q2.loadingFinished();

      // q2 listens to q1 -> q1 cannot auto-close.
      await p(q1)._testTriggerIdleTimeout();
      assertTrue(
        p(db)._openQueries.has(q1.id),
        'q1 retained while chained query listens',
      );

      // Close q2 -> q1 loses its listener -> q1 can close.
      q2.close();
      await p(q1)._testTriggerIdleTimeout();
      assertEquals(
        p(db)._openQueries.has(q1.id),
        false,
        'q1 closes after q2 gone',
      );

      // q1 closed -> its repo listener released -> repo can close.
      const repo = p(db).repository('/data/items');
      if (repo) await p(repo)._testTriggerIdleTimeout();
      assertEquals(
        db.repository('/data/items') !== undefined,
        false,
        'repo closes after q1 closed',
      );
    } finally {
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Part 4: Reopen & Durability Contracts
  // ════════════════════════════════════════════════════════════════

  TEST('AutoClose', 'commit() reopens auto-closed repo', async (ctx) => {
    const db = await ctx.createDB('ac-reopen', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    try {
      await db.readyPromise();
      const item = db.create('/data/items/reopen', kAutoCloseSchema, {
        value: 'a',
      });
      await item.commit();
      await db.flush('/data/items');

      await db.closeRepo('/data/items');
      assertEquals(
        db.repository('/data/items') !== undefined,
        false,
        'repo closed',
      );

      item.set('value', 'b');
      await item.commit();
      assertTrue(
        db.repository('/data/items') !== undefined,
        'commit() reopened repo',
      );
      assertEquals(item.get('value'), 'b');
      await db.flush('/data/items');
    } finally {
      await db.close();
    }
  });

  TEST(
    'AutoClose',
    'auto-closed repo reopens with committed data intact',
    async (ctx) => {
      const db = await ctx.createDB('ac-auto-durable', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/durable', kAutoCloseSchema, {
          value: 'saved',
        });
        await item.commit();
        await db.flush('/data/items');

        const repo = p(db).repository('/data/items');
        if (repo) await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items') !== undefined,
          false,
          'repo auto-closed',
        );

        // Reopen and verify durability.
        // In-memory read works without reopening (the item survives auto-close).
        const reloaded = db.item('/data/items/durable');
        assertEquals(reloaded.get('value'), 'saved');
        // Explicit reopen reads persisted data back from disk.
        const repo2 = await db.open('/data/items');
        assertExists(repo2, 'repo reopened on demand');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'item.get() works from memory when repo is closed',
    async (ctx) => {
      const db = await ctx.createDB('ac-get-memory', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/mem', kAutoCloseSchema, {
          value: 'cached',
        });
        await item.commit();
        await db.flush('/data/items');

        await db.closeRepo('/data/items');

        // get() reads from in-memory state regardless of repo open/closed.
        assertEquals(item.get('value'), 'cached');
      } finally {
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // Part 5: Concurrency & Cleanup Contracts
  // ════════════════════════════════════════════════════════════════

  TEST(
    'AutoClose',
    'close/open cannot overlap without corruption',
    async (ctx) => {
      const db = await ctx.createDB('ac-race', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 1000, // long: rely on deterministic trigger
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        const repo = p(db).repository('/data/items');
        assertExists(repo);

        // Kick off an idle close (async teardown).
        const closeP = p(repo)._testTriggerIdleTimeout();
        // Concurrently open must await the close, then reopen a fresh repo.
        const reopened = await db.open('/data/items');
        await closeP;

        assertExists(reopened);
        assertTrue(
          db.repository('/data/items') !== undefined,
          'repo reopened after close',
        );
        assertTrue(reopened !== repo, 'reopened is a fresh instance');
        assertEquals(reopened.path, '/data/items');
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'idle timer is armed only after open completes (no slow-open expiry)',
    async (ctx) => {
      // With a very short timeout, a timer armed mid-load would expire the
      // repo before open() resolves. Prove the arming order deterministically:
      // the repo instance is installed while open is still in flight, but the
      // idle timer must not be armed until the load completes.
      const db = await ctx.createDB('ac-slow-open', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 1,
      });
      try {
        await db.readyPromise();
        const openP = db.open('/data/items');
        // Spin microtasks until _openImpl installs the repo instance, which
        // happens before its file load (and _startIdleTimer) completes.
        for (
          let i = 0;
          i < 100 && db.repository('/data/items') === undefined;
          i++
        ) {
          await Promise.resolve();
        }
        const pending = db.repository('/data/items');
        assertExists(pending, 'repo installed while open is in flight');
        assertEquals(
          p(pending)._idleReady,
          false,
          'idle timer not armed until open completes',
        );
        const repo = await openP;
        assertEquals(p(repo)._idleReady, true, 'idle timer armed after open');
        assertTrue(
          db.repository('/data/items') === repo,
          'repo is live immediately after open resolves',
        );
        // Let the timeout window elapse while pinned: an early-armed timer
        // would already have closed the repo.
        const unsub = repo.attach('DocumentChanged', () => {});
        await sleep(20);
        assertTrue(
          db.repository('/data/items') === repo,
          'pinned repo survived the timeout window',
        );
        unsub();
      } finally {
        await db.close();
      }
    },
  );

  TEST('AutoClose', 'close() works with idle timer configured', async (ctx) => {
    const db = await ctx.createDB('ac-cleanup', {
      registry: kRegistry,
      repoInactivityTimeoutMs: 100,
    });
    await db.readyPromise();
    await db.open('/data/items');
    await db.close();
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

      const repo = p(db).repository('/data/items');
      if (repo) await p(repo)._testTriggerIdleTimeout();

      // New work reopens the repo on demand.
      const item2 = db.create('/data/items/phase2', kAutoCloseSchema, {
        value: 'second',
      });
      await item2.commit();
      await db.flush('/data/items');
      assertEquals(item2.get('value'), 'second');
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Part 6: Listener & detachAll Coverage
  // ════════════════════════════════════════════════════════════════

  TEST(
    'AutoClose',
    'detachAll(DocumentChanged) re-arms idle timer',
    async (ctx) => {
      const db = await ctx.createDB('ac-detachall', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        const repo = await db.open('/data/items');
        // Attach a listener that pins the repo open
        repo.attach('DocumentChanged', () => {});
        await p(repo)._testTriggerIdleTimeout();
        assertTrue(
          db.repository('/data/items') !== undefined,
          'listener pins repo before detachAll',
        );

        // detachAll('DocumentChanged') must re-arm the timer via
        // _onListenersChanged, unlike the old attach/detach overrides that
        // detachAll bypassed.
        repo.detachAll('DocumentChanged');
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items') !== undefined,
          false,
          'detachAll re-arms timer and repo closes',
        );
      } finally {
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // Part 7: Query Loading Guard (no auto-close mid-load)
  // ════════════════════════════════════════════════════════════════

  TEST(
    'AutoClose',
    'loading query is not eligible for idle close',
    async (ctx) => {
      const db = await ctx.createDB('ac-loading-guard', {
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
        // Kick off loading: resume() sets _loading synchronously before it
        // awaits the open, so a loading query is observable here.
        const loaded = q.loadingFinished();
        assertTrue(q.loading, 'scan is in flight after loadingFinished()');
        // The constructor-armed timer must be unscheduled while loading.
        assertEquals(
          p(q)._idleTimer?.isScheduled,
          false,
          'idle timer unscheduled while loading',
        );
        // A read during loading must neither start loading nor arm the timer.
        q.has('/data/items/nonexistent');
        assertTrue(p(db)._openQueries.has(q.id), 'query open during load');

        await loaded;
        // After loading finishes, the timer arms on the next accessor call.
        // The query has no external listeners -> eligible for close.
        await p(q)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._openQueries.has(q.id),
          false,
          'query closes after loading done + idle',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'resume() failure clears loading and keeps query reclaimable',
    async (ctx) => {
      const db = await ctx.createDB('ac-resume-fail', {
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
        // Force the lazy source open to fail once.
        const realOpen = db.open.bind(db);
        let failOnce = true;
        p(db).open = (path: string, opts?: unknown) => {
          if (failOnce) {
            failOnce = false;
            return Promise.reject(new Error('synthetic open failure'));
          }
          return realOpen(path, opts);
        };
        // loadingFinished() starts the (failing) load. It must settle rather
        // than hang, and the query must not stay stuck in "scan in flight".
        await q.loadingFinished();
        assertEquals(q.loading, false, 'loading cleared after resume failure');
        assertEquals(
          p(q)._idleTimer?.isScheduled,
          true,
          'failed query is idle-eligible',
        );
        await p(q)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._openQueries.has(q.id),
          false,
          'failed query is reclaimable',
        );
      } finally {
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // Part 8: Concurrent closeRepo Mutex
  // ════════════════════════════════════════════════════════════════

  TEST(
    'AutoClose',
    'concurrent manual closeRepo calls do not race',
    async (ctx) => {
      const db = await ctx.createDB('ac-close-race', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        // Fire off two concurrent closeRepo calls. The second must be
        // blocked by the mutex (not double-destroy the repo).
        const [r1, r2] = await Promise.allSettled([
          db.closeRepo('/data/items'),
          db.closeRepo('/data/items'),
        ]);
        assertEquals(r1.status, 'fulfilled', 'first closeRepo ok');
        assertEquals(r2.status, 'fulfilled', 'second closeRepo ok (noop)');
        assertEquals(
          db.repository('/data/items') !== undefined,
          false,
          'repo closed after concurrent calls',
        );
      } finally {
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // Part 9: Idle Lease in Write Path
  // ════════════════════════════════════════════════════════════════

  TEST(
    'AutoClose',
    'repo.setValueForKey acquires idle lease to prevent mid-write close',
    async (ctx) => {
      const db = await ctx.createDB('ac-lease-write', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        const repo = p(db).repository('/data/items');
        assertExists(repo);

        // Call setValueForKey directly (no await boundary).
        // Inside setValueForKey the lease is acquired synchronously.
        const Item = (await import('../cfds/base/item.ts')).Item;
        const testItem = new Item(
          { schema: kAutoCloseSchema, data: { value: 'written-during-lease' } },
          kRegistry,
        );
        const writeP = repo.setValueForKey(
          'test-key',
          testItem,
          undefined,
        );

        // The lease was acquired synchronously inside setValueForKey.
        await p(repo)._testTriggerIdleTimeout();
        assertTrue(
          db.repository('/data/items') !== undefined,
          'repo pinned by write lease',
        );
        await writeP;

        // After write completes, lease is released. Now close is possible.
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items') !== undefined,
          false,
          'repo closes after write completes',
        );

        // Open again and verify data persisted.
        const repo2 = await db.open('/data/items');
        assertExists(repo2);
        const val = repo2.valueForKey('test-key');
        assertExists(val, 'valueForKey returns data');
        assertEquals(val[0].get('value'), 'written-during-lease');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // Part 10: db.close() Commits Dirty Items from Auto-Closed Repos
  // ════════════════════════════════════════════════════════════════

  TEST(
    'AutoClose',
    'close() commits pending edits from auto-closed repos',
    async (ctx) => {
      const db = await ctx.createDB('ac-close-dirty', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/pending', kAutoCloseSchema, {
          value: 'initial',
        });
        await item.commit();
        await db.flush('/data/items');

        // Auto-close the repo.
        const repo = p(db).repository('/data/items');
        if (repo) await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items') !== undefined,
          false,
          'repo auto-closed',
        );

        // Make a dirty (uncommitted) edit.
        item.set('value', 'dirty-but-saved');

        // close() must commit the dirty edit before deactivating.
        await db.close();

        // Reopen the DB at the SAME path and verify the pending edit was
        // committed. Use the same testId so createDB returns the same dir.
        const db2 = await ctx.createDB('ac-close-dirty', {
          registry: kRegistry,
          repoInactivityTimeoutMs: 0,
        });
        try {
          await db2.readyPromise();
          // Open the repo manually since item() doesn't open automatically
          await db2.open('/data/items');
          const item2 = db2.item('/data/items/pending');
          assertEquals(
            item2.get('value'),
            'dirty-but-saved',
            'pending edit persisted across close()',
          );
        } finally {
          await db2.close();
        }
      } finally {
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // E2E: Real Timer (scheduler integration only)
  // ════════════════════════════════════════════════════════════════
  if (!isBrowser()) {
    TEST('AutoClose', 'E2E: real timer auto-closes idle repo', async (ctx) => {
      const db = await ctx.createDB('ac-e2e-real', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 200,
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        assertTrue(db.repository('/data/items') !== undefined);

        // Poll until the real timer closes the bare repo.
        const deadline = performance.now() + 3000;
        let closed = false;
        while (performance.now() < deadline) {
          if (db.repository('/data/items') === undefined) {
            closed = true;
            break;
          }
          await sleep(10);
        }
        assertTrue(closed, 'repo closed by real timer within 3s');
      } finally {
        await db.close();
      }
    });

    TEST(
      'AutoClose',
      'E2E: real timer does not fire when feature is disabled',
      async (ctx) => {
        const db = await ctx.createDB('ac-e2e-disabled', {
          registry: kRegistry,
        });
        try {
          await db.readyPromise();
          assertEquals(p(db).repoInactivityTimeoutMs, 0);
          await db.open('/data/items');
          await sleep(500);
          assertTrue(
            db.repository('/data/items') !== undefined,
            'repo stays open when disabled',
          );
        } finally {
          await db.close();
        }
      },
    );
  }

  // ════════════════════════════════════════════════════════════════
  // Part 11: Auto-Close + Manual Close Serialization
  // ════════════════════════════════════════════════════════════════

  TEST(
    'AutoClose',
    'manual closeRepo awaits in-flight auto-close',
    async (ctx) => {
      const db = await ctx.createDB('ac-race-auto-manual', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 0, // deterministic hook
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        assertTrue(db.repository('/data/items') !== undefined);

        // Fire auto-close via the deterministic hook. The hook returns after
        // the close is registered (state 'closing', teardown in flight).
        const repo = p(db).repository('/data/items');
        assertExists(repo);
        const autoCloseP = p(repo)._testTriggerIdleTimeout();

        // While auto-close is in-flight, fire a manual closeRepo. It must await
        // the auto-close teardown, not race past it.
        await db.closeRepo('/data/items');

        // ORDERING assertion (not eventual state): sample immediately after
        // closeRepo resolves, BEFORE awaiting autoCloseP. Pre-fix closeRepo
        // returned early (state still 'closing', file entry still present)
        // while teardown was in flight; this ordering check fails there and
        // passes only when closeRepo truly joined the in-flight teardown.
        assertEquals(
          p(repo)._closeState,
          'closed',
          'closeRepo awaited the in-flight auto-close teardown',
        );
        assertEquals(
          p(db)._files.has('/data/items'),
          false,
          'file entry already removed when closeRepo resolved',
        );
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo fully closed after race',
        );

        // Then confirm the auto-close promise settles too.
        await autoCloseP;

        // Verify a subsequent open works cleanly.
        await db.open('/data/items');
        assertTrue(
          db.repository('/data/items') !== undefined,
          'reopen works after race resolution',
        );
      } finally {
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // Part 12: Write-During-Close & Close/Open Edge Contracts
  // ════════════════════════════════════════════════════════════════

  TEST(
    'AutoClose',
    'direct repo write begun during auto-close fails explicitly',
    async (ctx) => {
      const db = await ctx.createDB('ac-write-during-close', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 0, // deterministic hook
      });
      try {
        await db.readyPromise();
        const repo = await db.open('/data/items');
        const lateItem = new Item(
          { schema: kAutoCloseSchema, data: { value: 'late' } },
          kRegistry,
        );

        // Start auto-close. The repo transitions to 'closing' synchronously,
        // so a write begun now lands on a repo whose teardown is in flight.
        const autoCloseP = p(repo)._testTriggerIdleTimeout();

        // A lease cannot stop an in-flight teardown, so the write path must
        // fail explicitly instead of resolving and silently losing the write.
        await assertRejectsServiceUnavailable(
          () => repo.setValueForKey('late', lateItem, undefined),
          'setValueForKey during close must throw serviceUnavailable',
        );
        await assertRejectsServiceUnavailable(
          () => repo.insert([{ key: 'late-bulk', value: lateItem }]),
          'insert during close must throw serviceUnavailable',
        );

        await autoCloseP;
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo fully closed after rejected writes',
        );

        // Reopen: nothing was persisted by the rejected writes.
        const repo2 = await db.open('/data/items');
        assertEquals(
          repo2.valueForKey('late'),
          undefined,
          'no silent single write',
        );
        assertEquals(
          repo2.valueForKey('late-bulk'),
          undefined,
          'no silent bulk write',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'manual closeRepo drains an in-flight repository write',
    async (ctx) => {
      const db = await ctx.createDB('ac-close-inflight-write', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 0, // deterministic
      });
      try {
        await db.readyPromise();
        const repo = await db.open('/data/items');
        const item = new Item(
          { schema: kAutoCloseSchema, data: { value: 'inflight' } },
          kRegistry,
        );

        // Begin the write while the repo is open and leave it in flight, then
        // close. The close must drain the pending write before teardown;
        // otherwise NewCommitSync is detached and the commit never persists.
        const writeP = repo.setValueForKey('inflight', item, undefined);
        await db.closeRepo('/data/items');
        await writeP;

        const repo2 = await db.open('/data/items');
        const val = repo2.valueForKey('inflight');
        assertExists(val, 'in-flight write persisted across closeRepo');
        assertEquals(val[0].get('value'), 'inflight');
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'closeRepo settles loadingFinished for a mid-load query',
    async (ctx) => {
      const db = await ctx.createDB('ac-close-midload', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 0,
        queryInactivityTimeoutMs: 0,
      });
      try {
        await db.readyPromise();
        const q = db.query({
          source: '/data/items',
          predicate: () => true,
          schema: kAutoCloseSchema,
        });
        // loadingFinished() triggers resume (opens the repo + starts the scan).
        // Do not await it yet: close the repo while the query is still loading.
        const loaded = q.loadingFinished();
        await db.closeRepo('/data/items');

        // loadingFinished() must settle, not hang forever (round-6 finding:
        // a closed mid-load query never emitted LoadingFinished).
        const raced = await Promise.race([
          loaded.then(() => 'loaded' as const),
          sleep(2000).then(() => 'timeout' as const),
        ]);
        assertEquals(
          raced,
          'loaded',
          'loadingFinished() settled after closeRepo closed the repo',
        );
        assertEquals(q.loading, false, 'query is no longer loading');
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'db.close() racing an in-flight auto-close does not error',
    async (ctx) => {
      const db = await ctx.createDB('ac-dbclose-vs-auto', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 0, // deterministic hook
      });
      await db.readyPromise();
      const repo = await db.open('/data/items');

      // Trigger auto-close, then immediately close the whole database. The two
      // teardown paths must serialize through _closeLocks/_closePromises
      // instead of double-tearing the repo down.
      const autoCloseP = p(repo)._testTriggerIdleTimeout();
      await db.close();
      await autoCloseP;

      assertEquals(
        db.repository('/data/items'),
        undefined,
        'repo closed after db.close() raced auto-close',
      );
    },
  );

  TEST(
    'AutoClose',
    'repo.insert acquires an idle lease to prevent mid-write close',
    async (ctx) => {
      const db = await ctx.createDB('ac-lease-bulk', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        const repo = await db.open('/data/items');
        const entries = [
          {
            key: 'bulk-1',
            value: new Item(
              { schema: kAutoCloseSchema, data: { value: 'b1' } },
              kRegistry,
            ),
          },
          {
            key: 'bulk-2',
            value: new Item(
              { schema: kAutoCloseSchema, data: { value: 'b2' } },
              kRegistry,
            ),
          },
        ];

        // insert() acquires its idle lease synchronously, before any await.
        const writeP = repo.insert(entries);
        await p(repo)._testTriggerIdleTimeout();
        assertTrue(
          db.repository('/data/items') !== undefined,
          'bulk insert lease pins the repo open',
        );
        await writeP;

        // Lease released -> idle close can proceed.
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo closes after the bulk insert completes',
        );

        // Reopen and verify the bulk write persisted.
        const repo2 = await db.open('/data/items');
        assertExists(repo2.valueForKey('bulk-1'), 'bulk-1 persisted');
        assertExists(repo2.valueForKey('bulk-2'), 'bulk-2 persisted');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'db.insert bulk write persists across an auto-close cycle',
    async (ctx) => {
      const db = await ctx.createDB('ac-bulk-db-insert', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        await db.insert('/data/items', kAutoCloseSchema, [
          { key: 'db-bulk-1', data: { value: 'x' } },
          { key: 'db-bulk-2', data: { value: 'y' } },
        ]);

        const repo = db.repository('/data/items');
        assertExists(repo);
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo auto-closed after db.insert',
        );

        const repo2 = await db.open('/data/items');
        assertExists(
          repo2.valueForKey('db-bulk-1'),
          'db.insert item persisted',
        );
        assertExists(
          repo2.valueForKey('db-bulk-2'),
          'db.insert item persisted',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'bare query detachAll() permits idle close',
    async (ctx) => {
      const db = await ctx.createDB('ac-query-detachall', {
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

        q.attach('DocumentChanged', () => {});
        await p(q)._testTriggerIdleTimeout();
        assertTrue(p(db)._openQueries.has(qid), 'listener pins query open');

        // Bare detachAll() (no event arg) must re-evaluate idle state through
        // the Emitter hook, which receives undefined for the removed event.
        q.detachAll();
        await p(q)._testTriggerIdleTimeout();
        assertTrue(
          p(q)._closed,
          'bare detachAll permits the query to close',
        );
        assertEquals(
          p(db)._openQueries.has(qid),
          false,
          'closed query is removed from the registry',
        );
      } finally {
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // Part 13: Regression - Query cleanup without an open source repo
  // ════════════════════════════════════════════════════════════════
  // A query created but never loaded has no open source repo. Query.close()
  // and Query.suspend() must use the DB's own registry/persistence rather than
  // dereferencing a missing repo, otherwise a later db.close() rejects with
  // "Cannot read properties of undefined (reading 'db')".
  TEST(
    'AutoClose',
    'closing an unloaded query does not crash',
    async (ctx) => {
      const db = await ctx.createDB('ac-unloaded-close', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const q = db.query({
          source: '/data/items',
          predicate: () => true,
          schema: kAutoCloseSchema,
        });
        // Query creation is lazy: it must not open the source repo.
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo not opened by query creation',
        );
        q.close();
        assertTrue(p(q)._closed, 'query closed without an open repo');
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'close during load does not leak the source listener',
    async (ctx) => {
      const db = await ctx.createDB('ac-close-during-load', {
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
        // Start loading (resume() -> await db.open()) and close mid-load.
        const loaded = q.loadingFinished();
        q.close();
        await loaded;

        // Await the same in-flight open that resume() is waiting on. resume()
        // registered its continuation first, so its post-await code has run by
        // the time this resolves.
        const repo = await db.open('/data/items');
        assertEquals(
          repo.listenerCount('DocumentChanged'),
          0,
          'close during load must not leak the source listener',
        );

        // With no leaked listener the repo is idle-eligible and auto-closes;
        // a leaked listener would pin it open forever.
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo auto-closes after close-during-load',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'query detach before load does not crash suspend()',
    async (ctx) => {
      const db = await ctx.createDB('ac-unloaded-suspend', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const q = db.query({
          source: '/data/items',
          predicate: () => true,
          schema: kAutoCloseSchema,
        });
        // Attach then immediately detach the last listener: the emitter goes
        // inactive and calls suspend() before the repo open completes.
        const unsub = q.onResultsChanged(() => {});
        unsub();
      } finally {
        await db.close();
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  // Part 14: Manual closeRepo must not hand out the closing repo
  // ════════════════════════════════════════════════════════════════
  TEST(
    'AutoClose',
    'open() during manual closeRepo() never returns the closing repo',
    async (ctx) => {
      const db = await ctx.createDB('ac-manual-close-open', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const repo = await db.open('/data/items');

        // Begin a manual close but do not await it. A manual close keeps the
        // repo's _closeState === 'open' through the commit/flush phase.
        const closeP = db.closeRepo('/data/items');
        const reopened = await db.open('/data/items');

        // open() must serialize behind the in-flight close and return a fresh
        // repo, never the instance that is being torn down.
        assertTrue(
          reopened !== repo,
          'open() must not return the mid-close repo instance',
        );
        await closeP;
        assertExists(
          db.repository('/data/items'),
          'repo is open after close+open serialized',
        );

        // The serially reopened repo must be fully usable.
        const item = db.create('/data/items/x', kAutoCloseSchema, {
          value: 'ok',
        });
        await item.commit();
        assertEquals(item.get('value'), 'ok');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'AutoClose',
    'open() during an in-flight open + close never returns the closing repo',
    async (ctx) => {
      const db = await ctx.createDB('ac-inflight-open-close', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        // Start the open but do NOT await it, so _openPromises holds an entry
        // when the close is registered behind it.
        const openA = db.open('/data/items');
        const closeP = db.closeRepo('/data/items');

        // A concurrent open must not reuse the in-flight open promise: that
        // promise resolves with the repo the close is about to tear down.
        // It must wait for the close and return a fresh, usable repo.
        const reopened = await db.open('/data/items');
        await closeP;

        assertTrue(
          reopened !== await openA,
          'open() must not return the in-flight repo being closed',
        );
        assertEquals(
          p(reopened)._closeState,
          'open',
          'reopened repo is open, not the torn-down instance',
        );
        assertExists(
          db.repository('/data/items'),
          'repo is open after in-flight open + close serialized',
        );

        // The reopened repo must be fully usable.
        const item = db.create('/data/items/x', kAutoCloseSchema, {
          value: 'ok',
        });
        await item.commit();
        assertEquals(item.get('value'), 'ok');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
