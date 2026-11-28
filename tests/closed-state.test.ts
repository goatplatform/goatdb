/**
 * Tests for GoatDB instance lifecycle: booting -> ready -> closing -> closed.
 *
 * Assertions use the public lifecycle API (`state`, `isOpen`, `close()`,
 * `readyPromise()`, repository/client lookups, and data operations), so they
 * survive internal changes. Where a test must force or observe an internal
 * condition it uses declared `@internal` seams (test hooks, the close-time
 * repo acquisition) instead of private fields.
 */

import {
  assertEquals,
  assertThrows,
  assertThrowsInstanceOf,
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
import {
  FileImplGet,
  pathExists,
  writeTextFile,
} from '../base/json-log/file-impl.ts';
import { isBrowser } from '../base/common.ts';
import { sleep } from '../base/time.ts';
import { sendJSONToURL } from '../net/rest-api.ts';
import {
  blockedDBPath,
  trackUnhandledRejections,
  waitForState,
  waitUntil,
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
  await assertThrowsInstanceOf(
    async () => {
      try {
        await fn();
      } catch (e) {
        caught = e;
        throw e;
      }
    },
    ServerError,
    message,
  );
  assertTrue(
    (caught as ServerError).code === Code.ServiceUnavailable,
    message,
  );
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
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repository() is gated while closing',
        );

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
      await assertServiceUnavailable(
        () => db.acquireRepo('/data/items'),
        'acquireRepo() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.closeRepo('/data/items'),
        'closeRepo() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.flush('/data/items'),
        'flush() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.syncAll(),
        'syncAll() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () =>
          db.insert('/data/items', kClosedStateSchema, [
            { data: { value: 'x', num: 0 } },
          ]),
        'insert() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () =>
          db.load('/data/items/x', kClosedStateSchema, {
            value: 'x',
            num: 0,
          }),
        'load() throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.currentUser,
        'currentUser getter throws serviceUnavailable',
      );
      await assertServiceUnavailable(
        () => db.currentSession,
        'currentSession getter throws serviceUnavailable',
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
      const autoRepo = db.repository('/data/auto')!;
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
        const repo = db.repository('/data/items')!;
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
    { skip: isBrowser() || typeof Deno === 'undefined' },
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
      // One peer resets every connection (its client finishes syncing and arms
      // a repeating timer); the other accepts and stalls. Both listeners keep
      // arrival counts, so a leaked client shows up as new connections after
      // close. The iterators reject when the listeners close (teardown).
      const repoPath = '/data/items';
      const resetting = Deno.listen({ hostname: '127.0.0.1', port: 0 });
      const stalled = Deno.listen({ hostname: '127.0.0.1', port: 0 });
      const urlOf = (listener: Deno.Listener) =>
        `http://127.0.0.1:${(listener.addr as Deno.NetAddr).port}`;
      const failPeer = urlOf(resetting);
      const stalledPeer = urlOf(stalled);
      const resettingConns: Deno.Conn[] = [];
      const resets = (async () => {
        for await (const conn of resetting) {
          resettingConns.push(conn);
          conn.close();
        }
      })().catch(() => {});
      const stalledConns: Deno.Conn[] = [];
      const stalls = (async () => {
        for await (const conn of stalled) stalledConns.push(conn);
      })().catch(() => {});
      const unhandled = trackUnhandledRejections();
      try {
        const db = await ctx.createDB('closed-peer-stall', {
          registry: kRegistry,
          peers: [failPeer, stalledPeer],
        });
        try {
          await db.readyPromise();
          const openP = db.open(repoPath);
          const openSettled = openP.then(
            () => 'resolved' as const,
            (e: unknown) => e,
          );
          assertTrue(
            await waitUntil(() => stalledConns.length > 0, 3000),
            'a peer client connected and stalled on its initial sync',
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
          const stalledAtClose = stalledConns.length;
          const resettingAtClose = resettingConns.length;
          await sleep(1500);
          assertEquals(
            [stalledConns.length, resettingConns.length],
            [stalledAtClose, resettingAtClose],
            'no new peer connections after close',
          );
          assertTrue(
            unhandled.reasons.length === 0,
            'close leaves no unhandled rejection',
          );
        } finally {
          await db.close();
        }
      } finally {
        unhandled.restore();
        stalled.close();
        resetting.close();
        for (const conn of stalledConns) conn.close();
        await Promise.all([resets, stalls]);
      }
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
  );

  TEST(
    'ClosedState',
    'a stalled response body cannot outlive the request timeout',
    async (_ctx) => {
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
    { skip: isBrowser() || typeof Deno === 'undefined' },
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

        db.setTestFaults({ teardownFailures: 2 });
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
      const dir = await ctx.tempDir('closed-failed');
      const dbPath = `${dir}/not-a-directory`;
      assertTrue(await writeTextFile(dbPath, 'x'), 'blocker file written');

      const db = new GoatDB({
        path: dbPath,
        orgId: 'test-org',
        registry: kRegistry,
      });
      try {
        const item = db.create('/data/items/x', kClosedStateSchema, {
          value: 'pending',
        });
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
        assertEquals(
          db._testResourceCounts(),
          [0, 0],
          'failed close released all resources',
        );
        // The accepted edit must survive the failed close: the held item
        // reference stays readable and dirty so a retried close persists it.
        assertEquals(item.get('value'), 'pending', 'accepted edit retained');
        assertEquals(item.isDirty, true, 'accepted edit stays pending');

        assertTrue(
          await (await FileImplGet()).remove(dbPath),
          'blocker removed',
        );
        await db.close();
        assertEquals(db.state, 'closed', 'retried close settles closed');
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'the failed bootstrap never installed the repo',
        );
        assertEquals(item.get('value'), 'pending', 'accepted edit retained');
        assertEquals(item.isDirty, false, 'retried close persisted the edit');
      } finally {
        await db.close().catch(() => {});
      }
    },
    { skip: isBrowser },
  );

  TEST(
    'ClosedState',
    'failed bootstrap is handled',
    async (ctx) => {
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
    },
    { skip: isBrowser },
  );

  TEST(
    'ClosedState',
    'item load failure rejects readyPromise without an unhandled rejection',
    async (ctx) => {
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
    { skip: isBrowser },
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
          // V2 proves setter throws; structural view bypasses pinned V1 type.
          () => ((item as { schema: unknown }).schema = kClosedStateSchemaV2),
        ],
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
      // Dead-port peer: bootstrap never connects (sys-repo opens skip initial
      // sync), so it only forces schedulers to be born mid-close.
      const db = await ctx.createDB('closed-peer-during-boot', {
        registry: kRegistry,
        peers: ['http://127.0.0.1:1'],
      });
      // The post-bootstrap abort must reap schedulers born mid-close.
      const unhandled = trackUnhandledRejections();
      try {
        await db.close();
        assertEquals(db.state, 'closed', 'close completes');
        assertEquals(
          db._testResourceCounts(),
          [0, 0],
          'no live sync resources survive close',
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
    { skip: isBrowser() || typeof Deno === 'undefined' },
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
    'a close-time validation failure rejects close and preserves the edit',
    async (ctx) => {
      // Dedicated registry holding only the V1 schema so the auto-upgrade path
      // is inert and the test is deterministic across the full suite.
      const regV1Only = new DataRegistry();
      regV1Only.registerSchema(kClosedStateSchema);

      const db = await ctx.createDB('closed-schema-drop', {
        registry: regV1Only,
      });
      const item = db.create('/data/items/x', kClosedStateSchema, {
        value: 'committed',
        num: 1,
      });
      await item.commit();
      await db.close();

      // Reopen and stage a genuine edit whose data is invalid under the schema
      // (an extra unknown field), so the close-time commit is skipped. This
      // mirrors the non-debug validation-failure path that used to silently
      // drop the edit while close() reported success.
      const db2 = await ctx.createDB('closed-schema-drop', {
        registry: regV1Only,
      });
      try {
        await db2.readyPromise();
        const item2 = db2.item('/data/items/x');
        await item2.readyPromise();
        // Inject an unknown field directly onto the underlying data; set()
        // would reject it, and normalize() preserves it, keeping the item
        // invalid.
        (item2 as unknown as {
          _item: { dataUnsafe(): Record<string, unknown> };
        })._item.dataUnsafe()['zombie'] = 7;
        item2.set('value', 'edited');

        await assertThrows(
          () => db2.close(),
          'close rejects when a pending edit cannot persist',
        );
        assertEquals(db2.state, 'failed', 'failed close reports failed');
        assertEquals(
          item2.get('value'),
          'edited',
          'held item keeps the unpersisted edit',
        );
        assertEquals(item2.isDirty, true, 'unpersisted edit stays pending');
        // The retry contract holds: while the edit is still invalid, close
        // keeps rejecting instead of silently dropping it.
        await assertThrows(
          () => db2.close(),
          'a retried close still rejects while the edit is invalid',
        );
        // Restore validity, then the retried close persists the edit.
        delete (item2 as unknown as {
          _item: { dataUnsafe(): Record<string, unknown> };
        })._item.dataUnsafe()['zombie'];
        await db2.close();
        assertEquals(db2.state, 'closed', 'valid edit persists on retry');
      } finally {
        await db2.close().catch(() => {});
      }

      // A fresh instance must read the persisted edit: it was neither dropped
      // nor half-written during the failed closes.
      const db3 = await ctx.createDB('closed-schema-drop', {
        registry: kRegistry,
      });
      try {
        await db3.readyPromise();
        const db3item = db3.item('/data/items/x');
        await db3item.readyPromise();
        assertEquals(
          db3item.get('value'),
          'edited',
          'edit persisted after the retried close',
        );
      } finally {
        await db3.close();
      }
    },
  );

  TEST(
    'ClosedState',
    'failed bootstrap logs once and close reports it without an ERROR',
    async (ctx) => {
      const dir = await ctx.tempDir('closed-bootstrap-log');
      const dbPath = `${dir}/not-a-directory`;
      assertTrue(await writeTextFile(dbPath, 'x'), 'blocker file written');

      const captured = await withLogCapture(async (captured) => {
        const db = new GoatDB({
          path: dbPath,
          orgId: 'test-org',
          registry: kRegistry,
        });
        try {
          await waitForState(db, 'failed');
          await assertThrows(
            () => db.close(),
            'close rejects after a failed bootstrap',
          );
          // The failure surfaced once; a retried close settles after cleanup.
          await db.close();
          assertEquals(db.state, 'closed', 'retried close settles closed');
        } finally {
          await db.close().catch(() => {});
        }
        return captured;
      });

      const bootstrapErrors = captured.filter((e) =>
        e.severity === 'ERROR' &&
        (e.message ?? '').includes('Database bootstrap failed')
      );
      assertEquals(
        bootstrapErrors.length,
        1,
        'exactly one bootstrap ERROR is logged',
      );
      const closeFailures = captured.filter((e) =>
        (e.message ?? '').includes('Database close failed')
      );
      assertEquals(
        closeFailures.length,
        0,
        'a bootstrap-caused close must not log an ERROR close failure',
      );
      const infoReports = captured.filter((e) =>
        e.severity === 'INFO' &&
        (e.message ?? '').includes('close reported earlier bootstrap failure')
      );
      assertEquals(
        infoReports.length,
        1,
        'the bootstrap-caused close is reported once as INFO',
      );
    },
    { skip: isBrowser },
  );

  TEST(
    'ClosedState',
    'close cancels a stalled client bootstrap promptly',
    async (ctx) => {
      const requests: string[] = [];
      const server = Deno.serve(
        { hostname: '127.0.0.1', port: 0 },
        (req) => {
          requests.push(req.url);
          return new Promise<Response>(() => {}); // stall forever
        },
      );
      const url = `http://127.0.0.1:${server.addr.port}`;
      const dir = await ctx.tempDir('closed-stalled-bootstrap');
      const rejections = trackUnhandledRejections();
      const db = new GoatDB({
        path: dir,
        orgId: 'test-org',
        mode: 'client',
        peers: [url],
        registry: kRegistry,
      });
      try {
        // Let the bootstrap reach the stalled server before closing.
        assertTrue(
          await waitUntil(() => requests.length > 0, 2000),
          'client bootstrap reached the stalled server',
        );
        await assertThrows(
          () => db.close(),
          'close rejects surfacing the cancelled bootstrap',
        );
        assertEquals(
          db.state,
          'failed',
          'cancelled bootstrap close reports failed',
        );
        assertEquals(
          db._testResourceCounts(),
          [0, 0],
          'the cancelled bootstrap leaks no resources',
        );
        await db.close();
        assertEquals(db.state, 'closed', 'retried close settles closed');
        await new Promise((resolve) => setTimeout(resolve, 0));
        assertEquals(
          rejections.reasons.length,
          0,
          'the cancelled bootstrap leaves no unhandled rejection',
        );
      } finally {
        rejections.restore();
        await db.close().catch(() => {});
        server.shutdown();
      }
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
  );

  TEST(
    'ClosedState',
    'sync cancelled by close reports cancelled, not failed',
    async (ctx) => {
      const stalled = Deno.listen({ hostname: '127.0.0.1', port: 0 });
      const url = `http://127.0.0.1:${(stalled.addr as Deno.NetAddr).port}`;
      const conns: Deno.Conn[] = [];
      const acceptLoop = (async () => {
        for await (const conn of stalled) conns.push(conn);
      })().catch(() => {});
      const db = await ctx.createDB('closed-sync-cancel', {
        registry: kRegistry,
        peers: [url],
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');

        const syncP = db.sync('/data/items');
        // Give the sync a chance to reach the stalled peer before closing.
        assertTrue(
          await waitUntil(() => conns.length > 0, 3000),
          'the sync connected to the stalled peer',
        );
        const closeP = db.close();
        const raced = await Promise.race([
          Promise.all([syncP, closeP]).then(([r]) => r),
          sleep(5000).then(() => 'timeout' as const),
        ]);
        assertTrue(
          raced !== 'timeout',
          'close must not be held by a stalled sync',
        );
        const status = (raced as { status: string }).status;
        assertTrue(
          status === 'cancelled' || status === 'success',
          `sync cancelled by close reports cancelled or success, got ${status}`,
        );
        assertEquals(db.state, 'closed', 'close completes');
      } finally {
        await db.close().catch(() => {});
        stalled.close();
        for (const conn of conns) conn.close();
        await acceptLoop;
      }
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
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
      db.setTestFaults({ commitFailures: 0 });
      await assertThrows(() => db.close(), 'close rejects');
      assertEquals(db.state, 'failed', 'failed close reports failed');
      db.setTestFaults({ commitFailures: -1 });
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
      const repo = db.repository('/data/items')!;
      await repo._testTriggerIdleTimeout();
      a.set('value', 'a1');
      b.set('value', 'b1');
      db.setTestFaults({ commitFailures: 1 }); // allow a; fail b
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
      const repo = db.repository('/data/items')!;
      await repo._testTriggerIdleTimeout();
      a.set('value', 'a1');
      b.set('value', 'b1');
      b.set('num', NaN); // NaN never equals itself; rebase always diffs it
      db.setTestFaults({ commitFailures: 1 }); // allow a; fail b
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
      const repo = db.repository('/data/items')!;
      await repo._testTriggerIdleTimeout();
      item.set('value', 'pending');
      db.setTestFaults({ commitFailures: 0 }); // fail the close-time reopen
      await assertThrows(() => db.close(), 'close rejects');
      assertEquals(db.state, 'failed', 'failed close reports failed');
      // The failed close must release the reopened log-file handle; the
      // declared @internal count drops to zero only once the handle is closed.
      assertEquals(
        db._testResourceCounts(),
        [0, 0],
        'no leaked log-file handle after failed close',
      );
      db.setTestFaults({ commitFailures: -1 });
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
      // Force the detach-time teardown failure through the declared @internal
      // seam. Deterministic: the rejected idle close leaves the repo
      // registered and the DB ready for a retried close().
      db.setTestFaults({ fileCloseFailures: 1 });
      await assertThrows(
        () => db._requestRepoIdleClose(repo),
        'auto-close fails after detach',
      );
      assertEquals(db.state, 'ready', 'a failed auto-close keeps the DB open');
      assertTrue(
        db.repository('/data/items') !== undefined,
        'a failed auto-close stays retryable',
      );
      await db.close();
      assertEquals(db.state, 'closed', 'the retried teardown completes');
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

  TEST(
    'ClosedState',
    'a held repository write rejects after close() begins',
    async (ctx) => {
      const db = await ctx.createDB('closed-held-write', {
        registry: kRegistry,
      });
      await db.readyPromise();
      const repo = await db.open('/data/items');
      const item = new Item(
        { schema: kClosedStateSchema, data: { value: 'kept' } },
        kRegistry,
      );

      const closeP = db.close();
      // The lease-free repo reference must not accept a write once shutdown
      // started: a silently accepted write would be lost with the teardown.
      await assertServiceUnavailable(
        () => repo.setValueForKey('x', item, undefined),
        'setValueForKey on a held repo rejects after close() begins',
      );
      await closeP;
      assertEquals(db.state, 'closed', 'close completes');
    },
  );

  TEST(
    'ClosedState',
    'the close-only repo bypass rejects after terminal close',
    async (ctx) => {
      const db = await ctx.createDB('closed-bypass', { registry: kRegistry });
      await db.readyPromise();
      await db.open('/data/items');
      await db.close();

      // Declared @internal seam: close() is its only legitimate caller.
      await assertServiceUnavailable(
        () => db._acquireRepoForClose('/data/items'),
        'the close-only bypass rejects after close',
      );
      assertEquals(
        db.repository('/data/items'),
        undefined,
        'no repository is reinstalled after close',
      );
      assertEquals(db.state, 'closed', 'the instance stays closed');
    },
  );

  TEST(
    'ClosedState',
    'an in-flight getTrustPool during close rejects',
    async (ctx) => {
      const db = await ctx.createDB('closed-trust-pool-race', {
        registry: kRegistry,
      });
      // Bootstrap is still running: the call passes the entry check, then
      // close() moves the instance out of the open states before the pool
      // resolves.
      const poolP = db.getTrustPool();
      const closeP = db.close();
      await assertServiceUnavailable(
        () => poolP,
        'a getTrustPool pending when close starts fails closed',
      );
      await closeP;
      assertEquals(db.state, 'closed', 'close completes');
    },
  );
}
