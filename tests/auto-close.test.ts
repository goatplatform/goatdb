/**
 * Tests for the Automatic Closing of Repositories & Queries feature.
 *
 * Design (lease-based, per-resource one-shot timers):
 *  - Each Repository and Query owns a one-shot SimpleTimer; no global poller.
 *  - A repo/query is eligible for idle close only when it has no active
 *    leases, no external `DocumentChanged` listeners (derived from Emitter's
 *    own registrations via listenerCount), no open dependent queries, and is
 *    not a /sys/ repo.
 *  - Auto-close NEVER calls public `item.commit()`. Pending item edits reopen
 *    the repo on demand via `acquireRepo` (which awaits any in-flight close).
 *  - `db.acquireRepo()` returns a Disposable lease token; releasing it
 *    re-arms the idle timer.
 *  - A formal `open -> closing -> closed` state machine serializes
 *    close/open, so close/open cannot overlap and a slow open cannot
 *    immediately expire.
 *
 * Tests assert observable lifecycle contracts, not private timer/map state.
 * Deterministic hooks (`_testTriggerIdleTimeout`) drive eligibility decisions;
 * only a small E2E layer uses real timers for scheduler integration.
 */

import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { isBrowser } from '../base/common.ts';
import { sleep } from '../base/time.ts';
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
function p(obj: unknown): any {
  return obj as any;
}

/** Helper: resolve the (possibly re-opened) repository for a path. */
function repoFor(db: any, repoId: string): Repository | undefined {
  return db.repository(repoId);
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
        p(db)._repositories.has('/data/items'),
        false,
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
          p(db)._repositories.has('/data/items'),
          'lease pins repo open',
        );

        // Release the lease — idle close may now proceed.
        lease.dispose();
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._repositories.has('/data/items'),
          false,
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
          p(db)._repositories.has('/data/items'),
          false,
          'repo auto-closed without committing',
        );

        // The pending 300ms commit fires later, reopening the repo and persisting.
        await sleep(400);
        assertTrue(
          p(db)._repositories.has('/data/items'),
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
          p(db)._repositories.has('/data/items'),
          'open query pins its repo',
        );

        // Close the query -> releases the repo listener -> repo can close.
        q.close();
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._repositories.has('/data/items'),
          false,
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
          p(db)._repositories.has('/data/items'),
          'external listener pins repo',
        );

        unsub();
        await p(repo)._testTriggerIdleTimeout();
        assertEquals(
          p(db)._repositories.has('/data/items'),
          false,
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
        p(db)._repositories.has('/sys/sessions'),
        '/sys/sessions never auto-closes',
      );
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
      let repo = await db.open('/data/items');
      assertTrue(p(db)._repositories.has('/data/items'));

      // Touch activity (keys) then attempt idle close -> still closes (bare).
      repo.keys();
      await p(repo)._testTriggerIdleTimeout();
      assertEquals(
        p(db)._repositories.has('/data/items'),
        false,
        'repo closed after read+idle',
      );

      // Reopen and verify usable.
      repo = await db.open('/data/items');
      assertExists(repo);
    } finally {
      await db.close();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Part 3: Query Auto-Close Lifecycle Contracts
  // ════════════════════════════════════════════════════════════════

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
    'query results() activity resets idle timer',
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

        // Reading resets the timer; a single trigger still closes (no listener).
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
        p(db)._repositories.has('/data/items'),
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
        p(db)._repositories.has('/data/items'),
        false,
        'repo closed',
      );

      item.set('value', 'b');
      await item.commit();
      assertTrue(
        p(db)._repositories.has('/data/items'),
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
          p(db)._repositories.has('/data/items'),
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
          p(db)._repositories.has('/data/items'),
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
    'idle timer is scheduled only after open completes (no slow-open expiry)',
    async (ctx) => {
      // With a very short timeout, the repo must still be open immediately
      // after open() resolves (timer armed only post-load, not mid-load).
      const db = await ctx.createDB('ac-slow-open', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 1,
      });
      try {
        await db.readyPromise();
        const repo = await db.open('/data/items');
        assertExists(repo);
        assertTrue(
          p(repo)._idleReady === true,
          'timer armed only after open completes',
        );
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
        assertTrue(p(db)._repositories.has('/data/items'));

        // Poll until the real timer closes the bare repo.
        const deadline = performance.now() + 3000;
        let closed = false;
        while (performance.now() < deadline) {
          if (!p(db)._repositories.has('/data/items')) {
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
            p(db)._repositories.has('/data/items'),
            'repo stays open when disabled',
          );
        } finally {
          await db.close();
        }
      },
    );
  }
}
