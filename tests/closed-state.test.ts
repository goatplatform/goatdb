/**
 * Tests for GoatDB instance lifecycle: booting -> ready -> closing -> closed.
 *
 * Assertions use the public lifecycle API (`state`, `isOpen`, `close()`,
 * `readyPromise()`, and data operations), so they survive internal changes. A
 * test that must prove an internal leak states its deviation inline.
 */

import {
  assertEquals,
  assertThrows,
  assertTrue,
  withLogCapture,
} from './asserts.ts';
import { TEST } from './mod.ts';
import { GoatDB } from '../db/db.ts';
import { Code, ServerError } from '../cfds/base/errors.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { Item } from '../cfds/base/item.ts';
import { kSchemaSession, type SchemaTypeSession } from '../cfds/base/schema.ts';
import { generateSession, sessionToItem } from '../db/session.ts';
import { pathExists, writeTextFile } from '../base/json-log/file-impl.ts';
import { isBrowser } from '../base/common.ts';
import { sleep } from '../base/time.ts';
import { RepoClient } from '../net/client.ts';
import { sendJSONToURL } from '../net/rest-api.ts';
import {
  blockedDBPath,
  trackUnhandledRejections,
  waitForState,
} from './lifecycle-fixtures.ts';

const kClosedStateSchema = {
  ns: 'closed-state-test',
  version: 1,
  fields: {
    value: { type: 'string', default: () => '' },
    num: { type: 'number', default: () => 0 },
  },
} as const;

// Higher version of the same namespace; proves the schema setter would mutate.
const kClosedStateSchemaV2 = {
  ns: 'closed-state-test',
  version: 2,
  fields: { value: { type: 'string', default: () => '' } },
} as const;

const kRegistry = new DataRegistry();
kRegistry.registerSchema(kClosedStateSchema);
kRegistry.registerSchema(kClosedStateSchemaV2);

/**
 * Asserts that an operation fails at the API boundary with the canonical
 * serviceUnavailable error.
 */
async function assertServiceUnavailable(
  fn: () => unknown,
  message: string,
): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  assertTrue(
    caught instanceof ServerError && caught.code === Code.ServiceUnavailable,
    message,
  );
}

/**
 * Observes one repo's RepoClients through the prototype: which clients armed a
 * sync timer, and when the stalled peer's client started syncing. The patch is
 * process-global, so callers MUST call restore() in a finally block.
 */
function probeRepoClients(
  repoPath: string,
  peers: ReadonlySet<string>,
  stalledPeer: string,
) {
  const started: RepoClient[] = [];
  const inFlight = Promise.withResolvers<void>();
  const isOurs = (client: RepoClient) =>
    client.repoPath === repoPath && peers.has(client.serverUrl);
  const originalStart = RepoClient.prototype.startSyncing;
  const originalSync = RepoClient.prototype.sync;
  RepoClient.prototype.startSyncing = function (): RepoClient {
    if (isOurs(this)) started.push(this);
    return originalStart.call(this);
  };
  RepoClient.prototype.sync = function (): Promise<void> {
    if (isOurs(this) && this.serverUrl === stalledPeer) {
      inFlight.resolve();
    }
    return originalSync.call(this);
  };
  const restore = () => {
    RepoClient.prototype.startSyncing = originalStart;
    RepoClient.prototype.sync = originalSync;
  };
  return { started, inFlight: inFlight.promise, restore };
}

export default function setup(): void {
  TEST(
    'ClosedState',
    'state and isOpen track the close lifecycle',
    async (ctx) => {
      const db = await ctx.createDB('closed-lifecycle', {
        registry: kRegistry,
      });
      try {
        assertEquals(db.state, 'booting', 'booting before bootstrap');
        assertTrue(db.isOpen, 'booting instance accepts work');

        await db.readyPromise();
        assertEquals(db.state, 'ready', 'ready after bootstrap');
        assertTrue(db.isOpen, 'ready instance accepts work');

        await db.open('/data/items');
        const closeP = db.close();
        assertEquals(db.state, 'closing', 'closing while teardown runs');
        assertEquals(db.isOpen, false, 'closing instance rejects work');

        await closeP;
        assertEquals(db.state, 'closed', 'closed after teardown');
        assertEquals(db.isOpen, false, 'closed instance rejects work');
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'teardown released repositories',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST('ClosedState', 'close is single-flight and idempotent', async (ctx) => {
    const db = await ctx.createDB('closed-idempotent', {
      registry: kRegistry,
    });
    await db.readyPromise();

    const first = db.close();
    const second = db.close();
    assertTrue(
      first === second,
      'concurrent close() calls share the same promise',
    );

    await first;
    await second;
    await db.close();
    assertEquals(db.state, 'closed', 'instance stays closed');
  });

  TEST(
    'ClosedState',
    'data operations on a closed instance reject with serviceUnavailable',
    async (ctx) => {
      const db = await ctx.createDB('closed-ops', {
        registry: kRegistry,
      });
      await db.readyPromise();
      await db.close();

      await assertServiceUnavailable(
        () => db.item('/data/items/x'),
        'item() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.create('/data/items/x', kClosedStateSchema, { value: 'x' }),
        'create() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.open('/data/items'),
        'open() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () =>
          db.query({
            source: '/data/items',
            predicate: () => true,
            schema: kClosedStateSchema,
          }),
        'query() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.loginWithMagicLinkEmail('closed@example.com'),
        'loginWithMagicLinkEmail() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.flushAll(),
        'flushAll() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.sync('/data/items'),
        'sync() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.getTrustPool(),
        'getTrustPool() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.count('/data/items'),
        'count() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.keys('/data/items'),
        'keys() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.logout(),
        'logout() throws serviceUnavailable',
      );
      assertEquals(
        db.loggedIn,
        false,
        'closed instance reports no active session',
      );
    },
  );

  TEST(
    'ClosedState',
    'inspection stays available on a closed instance',
    async (ctx) => {
      const db = await ctx.createDB('closed-inspection', {
        registry: kRegistry,
      });
      await db.readyPromise();
      await db.close();

      assertEquals(
        db.repository('/data/items'),
        undefined,
        'repository() is an honest lookup after close',
      );
      assertEquals(
        db.itemLoaded('/data/items/x'),
        false,
        'itemLoaded() is false after close',
      );
      assertEquals(
        Array.from(db.clientsForRepo('/data/items')),
        [],
        'clientsForRepo() is empty after close',
      );
      assertEquals(db.state, 'closed', 'lifecycle stays inspectable');
      assertEquals(db.isOpen, false, 'lifecycle stays inspectable');
    },
  );

  TEST(
    'ClosedState',
    'logout on a closed instance fails without wiping data',
    async (ctx) => {
      const dataPath = await ctx.tempDir('closed-logout');
      const db = await ctx.createDB('closed-logout', { registry: kRegistry });
      try {
        await db.readyPromise();
        db.create('/data/items/x', kClosedStateSchema, { value: 'x' });
        await db.flushAll();
        await db.close();

        await assertServiceUnavailable(
          () => db.logout(),
          'logout() throws serviceUnavailable',
        );
        assertTrue(
          await pathExists(dataPath),
          'failed logout must keep the data directory',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'ClosedState',
    'close persists unflushed edits from open and auto-closed repos',
    async (ctx) => {
      const db = await ctx.createDB('closed-durability', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      const openItem = db.create('/data/open/item', kClosedStateSchema, {
        value: 'initial',
      });
      const autoItem = db.create('/data/auto/item', kClosedStateSchema, {
        value: 'initial',
      });
      await Promise.all([openItem.commit(), autoItem.commit()]);
      await db.flushAll();

      // Force the auto repo closed so close() must persist through the
      // _commitForClose/_acquireRepoForClose path; the open repo exercises
      // _closeRepo/_commitTo.
      const autoRepo = db.repository('/data/auto') as unknown as {
        _testTriggerIdleTimeout(): Promise<void>;
      };
      await autoRepo._testTriggerIdleTimeout();
      assertEquals(
        db.repository('/data/auto'),
        undefined,
        'auto repo closed',
      );

      openItem.set('value', 'open-dirty');
      autoItem.set('value', 'auto-dirty');
      await db.close();

      const db2 = await ctx.createDB('closed-durability', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 0,
      });
      try {
        await db2.readyPromise();
        await Promise.all([db2.open('/data/open'), db2.open('/data/auto')]);
        assertEquals(
          db2.item('/data/open/item').get('value'),
          'open-dirty',
          'unflushed edit in an open repo survives close()',
        );
        assertEquals(
          db2.item('/data/auto/item').get('value'),
          'auto-dirty',
          'unflushed edit in an auto-closed repo survives close()',
        );
      } finally {
        await db2.close();
      }
    },
  );

  TEST(
    'ClosedState',
    'close rejects and retries when a pending item commit fails',
    async (ctx) => {
      // Filesystem trick: replaces the repo log path with a directory so the
      // close-time reopen fails. Not portable to OPFS/browser.
      if (isBrowser() || typeof Deno === 'undefined') return;
      const dataPath = await ctx.tempDir('close-commit-fail');
      const db = await ctx.createDB('close-commit-fail', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      const repoFile = `${dataPath}/data/items.goat`;
      try {
        const item = db.create('/data/items/x', kClosedStateSchema, {
          value: 'initial',
        });
        await item.commit();
        await db.flushAll();

        // Auto-close the repo so close() must persist the dirty item through
        // the close-time reopen (the open-repo path commits via the repo's
        // own live file handle and would not hit the directory).
        const repo = db.repository('/data/items') as unknown as {
          _testTriggerIdleTimeout(): Promise<void>;
        };
        await repo._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo auto-closed',
        );

        // Make the repo log path a directory so the close-time reopen fails.
        await Deno.remove(repoFile);
        await Deno.mkdir(repoFile);

        item.set('value', 'pending');
        await assertThrows(() => db.close(), 'close rejects on failed commit');
        assertEquals(db.state, 'failed', 'failed close reports failed');

        await Deno.remove(repoFile);
        await db.close(); // retried close completes
        assertEquals(db.state, 'closed', 'retried close completes');

        const db2 = await ctx.createDB('close-commit-fail', {
          registry: kRegistry,
        });
        try {
          await db2.readyPromise();
          await db2.open('/data/items');
          assertEquals(
            db2.item('/data/items/x').get('value'),
            'pending',
            'retried commit persisted',
          );
        } finally {
          await db2.close();
        }
      } finally {
        await Deno.remove(repoFile).catch(() => {});
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedState',
    'close cancels an open deferred behind an in-flight repo close',
    async (ctx) => {
      const db = await ctx.createDB('closed-deferred-open', {
        registry: kRegistry,
      });
      await db.readyPromise();
      await db.open('/data/items');

      const [repoClose, deferred, teardown] = await Promise.allSettled([
        db.closeRepo('/data/items'),
        db.open('/data/items'),
        db.close(),
      ]);

      assertEquals(repoClose.status, 'fulfilled', 'closeRepo fulfills');
      assertEquals(teardown.status, 'fulfilled', 'close fulfills');
      assertEquals(deferred.status, 'rejected', 'deferred open is cancelled');
      const reason = (deferred as PromiseRejectedResult).reason;
      assertTrue(
        reason instanceof ServerError &&
          reason.code === Code.ServiceUnavailable,
        'deferred open fails with serviceUnavailable',
      );
      assertEquals(db.state, 'closed', 'close wins the ordering race');
      assertEquals(db.repository('/data/items'), undefined, 'no repo survives');
      assertTrue(db.close() === db.close(), 'close() reuses the promise');
    },
  );

  TEST(
    'ClosedState',
    'close aborts an in-flight peer sync instead of waiting on it',
    async (ctx) => {
      // Two peers: one resets every connection, so its client finishes syncing
      // and arms a repeating timer first; one accepts and never answers, so its
      // client stalls and close() aborts the open mid-flight.
      if (isBrowser() || typeof Deno === 'undefined') return;
      const repoPath = '/data/items';
      const resetting = Deno.listen({ hostname: '127.0.0.1', port: 0 });
      const stalled = Deno.listen({ hostname: '127.0.0.1', port: 0 });
      const urlOf = (listener: Deno.Listener) =>
        `http://127.0.0.1:${(listener.addr as Deno.NetAddr).port}`;
      const failPeer = urlOf(resetting);
      const stalledPeer = urlOf(stalled);
      // The iterator rejects once the listener closes; that is teardown.
      const resets = (async () => {
        for await (const conn of resetting) conn.close();
      })().catch(() => {});
      try {
        const db = await ctx.createDB('closed-peer-stall', {
          registry: kRegistry,
          peers: [failPeer, stalledPeer],
        });
        // An armed sync timer has no public surface, so this regression reads
        // clients directly (see the file header).
        const probe = probeRepoClients(
          repoPath,
          new Set([failPeer, stalledPeer]),
          stalledPeer,
        );
        try {
          await db.readyPromise();
          const openP = db.open(repoPath);
          // Handle the rejection up front: the open is doomed once close starts.
          const openSettled = openP.then(
            () => 'resolved' as const,
            (e: unknown) => e,
          );
          assertTrue(
            await Promise.race([
              probe.inFlight.then(() => true),
              sleep(3000).then(() => false),
            ]),
            'the second peer client stalled on its initial sync',
          );
          const raced = await Promise.race([
            db.close().then(
              () => 'closed' as const,
              (e: unknown) => `failed: ${e}`,
            ),
            sleep(2000).then(() => 'timeout' as const),
          ]);
          assertEquals(
            raced,
            'closed',
            'close() must not wait on the peer response or its timeout',
          );
          assertEquals(
            db.state,
            'closed',
            'close finished while the peer stalled',
          );
          const open = await openSettled;
          assertTrue(
            open instanceof ServerError &&
              open.code === Code.ServiceUnavailable,
            'an open that loses the race to close rejects with ' +
              `serviceUnavailable, got ${open}`,
          );
          assertEquals(
            db.repository(repoPath),
            undefined,
            'teardown released the half-open repo',
          );
          assertTrue(
            probe.started.length > 0 &&
              probe.started.every((c) => c.closed),
            'every peer client that armed a sync timer is closed',
          );
        } finally {
          probe.restore();
          await db.close();
        }
      } finally {
        stalled.close();
        resetting.close();
        await resets;
      }
    },
  );

  TEST(
    'ClosedState',
    'a stalled response body cannot outlive the request timeout',
    async (ctx) => {
      if (isBrowser() || typeof Deno === 'undefined') return;
      const server = Deno.serve(
        { hostname: '127.0.0.1', port: 0 },
        () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode('['));
              },
            }),
          ),
      );
      try {
        const outcome = await Promise.race([
          sendJSONToURL(
            `http://127.0.0.1:${server.addr.port}/batch-sync`,
            undefined,
            {},
            undefined,
            50,
          ).then(() => 'resolved', () => 'rejected'),
          sleep(2000).then(() => 'timeout'),
        ]);
        assertEquals(
          outcome,
          'rejected',
          'timeout cancels the stalled body read',
        );
      } finally {
        server.shutdown();
      }
    },
  );

  TEST(
    'ClosedState',
    'a failed teardown reports failed and a later close() retries',
    async (ctx) => {
      const db = await ctx.createDB('closed-teardown-retry', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');

        db._testForceTeardownFailures = 2;
        await assertThrows(
          () => db.close(),
          'close() rejects when teardown fails',
        );
        assertEquals(
          db.state,
          'failed',
          'a failed teardown is not reported as closed',
        );
        assertEquals(db.isOpen, false, 'failed instance rejects work');
        assertEquals(db.loggedIn, false, 'failed instance reports no session');

        await assertThrows(
          () => db.close(),
          'the retry rejects while teardown still fails',
        );
        assertEquals(
          db.state,
          'failed',
          'a second failed retry still reports failed',
        );

        await db.close();
        assertEquals(
          db.state,
          'closed',
          'a later close() retries the partial teardown',
        );
        assertEquals(db.isOpen, false, 'closed instance rejects work');
        assertEquals(db.loggedIn, false, 'no session after retried close');
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'retry released the repository',
        );
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'ClosedState',
    'failed bootstrap close rejects and retains accepted edits',
    async (ctx) => {
      if (isBrowser()) return; // OPFS has no "path occupied by a file" failure
      const dir = await ctx.tempDir('closed-failed');
      const dbPath = `${dir}/not-a-directory`;
      assertTrue(await writeTextFile(dbPath, 'x'), 'blocker file written');

      const db = new GoatDB({
        path: dbPath,
        orgId: 'test-org',
        registry: kRegistry,
      });
      db.create('/data/items/x', kClosedStateSchema, { value: 'pending' });
      let caught: unknown;
      try {
        await db.readyPromise();
      } catch (e) {
        caught = e;
      }
      assertTrue(caught !== undefined, 'readyPromise() rejects');
      assertEquals(db.state, 'failed', 'state reports the failed bootstrap');
      assertEquals(db.isOpen, false, 'failed instance rejects work');
      await assertServiceUnavailable(
        () => db.getTrustPool(),
        'getTrustPool() fails closed after a failed bootstrap',
      );

      await assertThrows(
        () => db.close(),
        'close rejects after failed bootstrap',
      );
      assertEquals(db.state, 'failed', 'failed close keeps state failed');
      const internals = db as unknown as { _items: Map<string, unknown> };
      assertEquals(internals._items.size, 1, 'accepted edit retained');
    },
  );

  TEST('ClosedState', 'failed bootstrap is handled', async (ctx) => {
    if (isBrowser()) return; // OPFS has no "path occupied by a file" failure
    const dir = await ctx.tempDir('closed-failed-state-only');
    const dbPath = await blockedDBPath(dir, 'not-a-directory');
    const rejections = trackUnhandledRejections();
    const db = new GoatDB({ path: dbPath, orgId: 'test-org' });
    try {
      await waitForState(db, 'failed');
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(db.state, 'failed', 'failed bootstrap state');
      assertEquals(rejections.reasons.length, 0, 'no unhandled rejection');
    } finally {
      rejections.restore();
      await db.close().catch(() => {});
    }
  });

  TEST(
    'ClosedState',
    'item load failure rejects readyPromise without an unhandled rejection',
    async (ctx) => {
      if (isBrowser()) return; // OPFS has no "path occupied by a file" failure
      const dir = await ctx.tempDir('closed-item-load');
      const dbPath = await blockedDBPath(dir, 'not-a-directory');
      const rejections = trackUnhandledRejections();
      const db = new GoatDB({ path: dbPath, orgId: 'test-org' });
      try {
        // Created while booting, so the load targets the doomed bootstrap.
        const item = db.item('/data/items/thing');
        const outcome = item.readyPromise().then(
          () => 'resolved' as const,
          (e: unknown) => e,
        );
        await waitForState(db, 'failed');
        const caught = await outcome;
        assertTrue(
          caught instanceof Error,
          `readyPromise() must reject with the load error, got ${caught}`,
        );
        assertEquals(item.ready, false, 'a failed load never reports ready');
        await new Promise((resolve) => setTimeout(resolve, 0));
        assertEquals(rejections.reasons.length, 0, 'no unhandled rejection');
      } finally {
        rejections.restore();
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedState',
    'mutators on a held item throw after close and drop no edits',
    async (ctx) => {
      const db = await ctx.createDB('closed-item-mutators', {
        registry: kRegistry,
      });
      const item = db.create('/data/items/x', kClosedStateSchema, {
        value: 'committed',
      });
      await item.commit();
      await db.close();

      const mutators: Array<[string, () => unknown]> = [
        ['set', () => item.set('value', 'lost-edit')],
        ['setMulti', () => item.setMulti({ value: 'lost-multi' })],
        ['delete', () => item.delete('value')],
        [
          'schema setter',
          () => (item.schema =
            kClosedStateSchemaV2 as unknown as typeof kClosedStateSchema),
        ], // V2 proves setter throws; cast bypasses pinned V1 setter type
        ['isDeleted setter', () => (item.isDeleted = true)],
      ];
      for (const [name, mutate] of mutators) {
        await assertServiceUnavailable(mutate, `${name} throws after close`);
      }
      const db2 = await ctx.createDB('closed-item-mutators', {
        registry: kRegistry,
      });
      try {
        await db2.readyPromise();
        await db2.open('/data/items');
        assertEquals(
          db2.item('/data/items/x').get('value'),
          'committed',
          'held item edits were never dropped',
        );
      } finally {
        await db2.close();
      }
    },
  );

  TEST(
    'ClosedState',
    'close during bootstrap cannot become ready later',
    async (ctx) => {
      await withLogCapture(async (captured) => {
        const db = await ctx.createDB('closed-during-boot', {
          registry: kRegistry,
        });
        assertEquals(db.state, 'booting', 'bootstrap has not completed');

        await db.close();
        assertEquals(
          db.state,
          'closed',
          'close during boot never becomes ready',
        );
        assertEquals(db.isOpen, false, 'closed instance rejects work');
        assertEquals(
          db.repository('/sys/sessions'),
          undefined,
          'bootstrap repositories are torn down',
        );
        await assertServiceUnavailable(
          () => db.readyPromise(),
          'readyPromise() rejects after close',
        );
        await assertServiceUnavailable(
          () => db.getTrustPool(),
          'getTrustPool() rejects after close',
        );
        await db.getTrustPool().catch(() => {});
        assertTrue(
          !captured.some((e) => e.severity === 'ERROR'),
          'close during bootstrap must not log an ERROR',
        );
      });
    },
  );

  TEST(
    'ClosedState',
    'close during bootstrap with peers',
    async (ctx) => {
      if (isBrowser() || typeof Deno === 'undefined') return;
      // Dead-port peer: bootstrap never connects (sys-repo opens skip initial
      // sync), so it only forces schedulers to be born mid-close.
      const db = await ctx.createDB('closed-peer-during-boot', {
        registry: kRegistry,
        peers: ['http://127.0.0.1:1'],
      });
      // Pre-wait abort runs before schedulers exist; the post-bootstrap abort
      // must reap them. Private-field read: a leaked interval has no public
      // surface.
      const unhandled = trackUnhandledRejections();
      try {
        await db.close();
        assertEquals(db.state, 'closed', 'close completes');
        const schedulers = (db as unknown as {
          _syncSchedulers?: unknown[];
        })._syncSchedulers;
        assertEquals(
          schedulers,
          undefined,
          'no sync scheduler survives close-during-bootstrap',
        );
        assertTrue(
          unhandled.reasons.length === 0,
          'close-during-bootstrap leaves no unhandled rejection',
        );
      } finally {
        unhandled.restore();
        await db.close();
      }
    },
  );
  TEST(
    'ClosedState',
    'close during boot persists accepted edits',
    async (ctx) => {
      const db = await ctx.createDB('closed-during-boot-durability', {
        registry: kRegistry,
      });
      db.create('/data/items/x', kClosedStateSchema, { value: 'pending' });
      await db.close();
      assertEquals(db.state, 'closed', 'close completes');
      const db2 = await ctx.createDB('closed-during-boot-durability', {
        registry: kRegistry,
      });
      await db2.readyPromise();
      await db2.open('/data/items');
      assertEquals(
        db2.item('/data/items/x').get('value'),
        'pending',
        'edit created during boot survived close',
      );
      await db2.close();
    },
  );

  TEST(
    'ClosedState',
    'a failed close keeps /sys repos retryable and persists dirty sessions',
    async (ctx) => {
      const session = await generateSession('f1-user');
      const rec = await sessionToItem(session, kRegistry);
      const db = await ctx.createDB('closed-f1-sys', { registry: kRegistry });
      await db.readyPromise();
      const item = db.create(`/sys/sessions/${session.id}`, kSchemaSession, {
        id: rec.get('id'),
        publicKey: 'bad-key',
        expiration: rec.get('expiration'),
        owner: rec.get('owner'),
      });
      await db.closeRepo('/sys/sessions'); // commit fails; item stays dirty
      item.set('publicKey', rec.get('publicKey'));
      db._testForceCommitFailures = 0;
      await assertThrows(() => db.close(), 'close rejects');
      assertEquals(db.state, 'failed', 'failed close reports failed');
      db._testForceCommitFailures = -1;
      await db.close();
      assertEquals(db.state, 'closed', 'retried close completes');
      const db2 = await ctx.createDB('closed-f1-sys', { registry: kRegistry });
      await db2.readyPromise();
      const repo = await db2.open('/sys/sessions');
      const got = repo.valueForKey<SchemaTypeSession>(session.id);
      assertTrue(got?.[0].get('owner') === 'f1-user', 'session persisted');
      await db2.close();
      await db.close();
    },
  );

  TEST(
    'ClosedState',
    'a failed sibling commit is recovered by repo-close retries',
    async (ctx) => {
      const db = await ctx.createDB('closed-f2-siblings', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      await db.readyPromise();
      const a = db.create('/data/items/a', kClosedStateSchema);
      const b = db.create('/data/items/b', kClosedStateSchema);
      await Promise.all([a.commit(), b.commit()]);
      await db.flushAll();
      const repo = db.repository('/data/items') as unknown as {
        _testTriggerIdleTimeout(): Promise<void>;
      };
      await repo._testTriggerIdleTimeout();
      a.set('value', 'a1');
      b.set('value', 'b1');
      db._testForceCommitFailures = 1; // allow a; fail b
      await db.close(); // repo close retries b; close reports success once
      assertEquals(db.state, 'closed', 'single close succeeds');
      const db2 = await ctx.createDB('closed-f2-siblings', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 0,
      });
      await db2.readyPromise();
      await db2.open('/data/items');
      assertEquals(db2.item('/data/items/a').get('value'), 'a1', 'a kept');
      assertEquals(db2.item('/data/items/b').get('value'), 'b1', 'b kept');
      await db2.close();
      await db.close();
    },
  );

  TEST(
    'ClosedState',
    'a NaN-valued sibling commit recovered by repo-close retry closes cleanly',
    async (ctx) => {
      const db = await ctx.createDB('closed-f1-nan', { registry: kRegistry });
      await db.readyPromise();
      const a = db.create('/data/items/a', kClosedStateSchema);
      const b = db.create('/data/items/b', kClosedStateSchema);
      await Promise.all([a.commit(), b.commit()]);
      const repo = db.repository('/data/items') as unknown as {
        _testTriggerIdleTimeout(): Promise<void>;
      };
      await repo._testTriggerIdleTimeout();
      a.set('value', 'a1');
      b.set('value', 'b1');
      b.set('num', NaN); // NaN never equals itself; rebase always diffs it
      db._testForceCommitFailures = 1; // allow a; fail b
      await db.close();
      assertEquals(db.state, 'closed', 'single close succeeds despite NaN');
      // Enforce the durable contract through persisted state only: a
      // successful close() must persist every accepted edit. NaN itself is
      // not representable in the storage format (JSON coerces it to null),
      // so the observable round-trip value is null; the crucial invariant is
      // that the retried close neither wedges nor drops the sibling edit.
      const db2 = await ctx.createDB('closed-f1-nan', { registry: kRegistry });
      await db2.readyPromise();
      await db2.open('/data/items');
      const entry = db2.repository('/data/items')!.valueForKey('b')![0];
      assertEquals(entry.get('value'), 'b1', 'b kept');
      assertEquals(entry.get('num'), null, 'NaN round-trips to null');
      await db2.close();
    },
  );

  TEST(
    'ClosedState',
    'a failed close-time commit leaks no half-open repo or file handle',
    async (ctx) => {
      const db = await ctx.createDB('closed-half-open-leak', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 100,
      });
      await db.readyPromise();
      const item = db.create('/data/items/x', kClosedStateSchema);
      await item.commit();
      const repo = db.repository('/data/items') as unknown as {
        _testTriggerIdleTimeout(): Promise<void>;
      };
      await repo._testTriggerIdleTimeout();
      item.set('value', 'pending');
      db._testForceCommitFailures = 0; // fail the close-time reopen
      await assertThrows(() => db.close(), 'close rejects');
      assertEquals(db.state, 'failed', 'failed close reports failed');
      const internals = db as unknown as {
        _files: Map<string, unknown>;
        _repositories: Map<string, unknown>;
      };
      assertEquals(
        internals._files.has('/data/items') ||
          internals._repositories.has('/data/items'),
        false,
        'no half-open repo or leaked handle',
      );
      db._testForceCommitFailures = -1;
      await db.close();
      const db2 = await ctx.createDB('closed-half-open-leak', {
        registry: kRegistry,
      });
      await db2.readyPromise();
      await db2.open('/data/items');
      assertEquals(
        db2.item('/data/items/x').get('value'),
        'pending',
        'dirty edit persisted on retried close',
      );
      await db2.close();
    },
  );

  TEST(
    'ClosedState',
    'retried close persists dirty edits after a detach-time teardown failure',
    async (ctx) => {
      const db = await ctx.createDB('cd-retry', { registry: kRegistry });
      await db.readyPromise();
      const item = db.create('/data/items/x', kClosedStateSchema);
      await item.commit();
      const repo = db.repository('/data/items')!;
      item.set('value', 'v2');
      db._testForceFileCloseFailures = 1;
      await assertThrows(
        () => db._requestRepoIdleClose(repo),
        'auto-close fails after detach',
      );
      await db.close();
      const db2 = await ctx.createDB('cd-retry', { registry: kRegistry });
      await db2.readyPromise();
      await db2.open('/data/items');
      assertEquals(db2.item('/data/items/x').get('value'), 'v2', 'kept');
      await db2.close();
    },
  );

  TEST(
    'ClosedState',
    'close persists a local edit across a divergent remote write',
    async (ctx) => {
      const db = await ctx.createDB('closed-f2-divergent', {
        registry: kRegistry,
      });
      await db.readyPromise();
      const x = db.create('/data/items/x', kClosedStateSchema);
      await x.commit();
      x.set('value', 'local');
      const repo = db.repository('/data/items')!;
      const remote = new Item(
        { schema: kClosedStateSchema, data: { value: 'remote', num: 5 } },
        kRegistry,
      );
      // The mid-commit divergence race (the head moves while a write is in
      // flight) is not reproducible through the public API: the repo rejects
      // concurrent writes to a key while a commit is pending. The parity
      // invariant below pins the user-facing contract that replaces it.
      await repo.setValueForKey('x', remote, undefined);
      // Wait (public reads only) for the remote head to be merged into the
      // local view; sync delivery is async in the browser runtime.
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline && x.get('num') !== 5) {
        await sleep(10);
      }
      // Parity invariant: everything observable on the item just before a
      // successful close() must be exactly what a fresh open reads.
      const value = x.get('value');
      const num = x.get('num');
      await db.close();
      const db2 = await ctx.createDB('closed-f2-divergent', {
        registry: kRegistry,
      });
      await db2.readyPromise();
      await db2.open('/data/items');
      const entry = db2.repository('/data/items')!.valueForKey('x')![0];
      assertEquals(entry.get('value'), value, 'observable value persisted');
      assertEquals(entry.get('num'), num, 'observable num persisted');
      await db2.close();
    },
  );
}
