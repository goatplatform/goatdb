/**
 * Lifecycle edge cases that were fixed together with the shutdown/repo
 * rework: committed-null trust-pool semantics, teardown rejecting on dropped
 * writes, cancellation vs real peer failure, write validation, write
 * guards on persistVerifiedCommits, teardown-safe query source lookup, and
 * recoverable close after bootstrap failure.
 *
 * All assertions use public APIs or declared `@internal` seams (fault
 * injection, close-time repo acquisition); no private fields.
 */

import {
  assertEquals,
  assertThrows,
  assertTrue,
  withLogCapture,
} from './asserts.ts';
import { TEST, TestsRunner, type TestSuite } from './mod.ts';
import { GoatDB, GoatDBCloseError, type SyncResult } from '../db/db.ts';
import { Item } from '../cfds/base/item.ts';
import type { Commit } from '../repo/commit.ts';
import { encodeSession, generateSession } from '../db/session.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { isBrowser } from '../base/common.ts';
import { sleep } from '../base/time.ts';
import { waitUntil } from './lifecycle-fixtures.ts';
import { SyncMessage } from '../net/message.ts';
import { JSONCyclicalEncoder } from '../base/core-types/encoding/json.ts';
import { BloomFilter } from '../base/bloom.ts';
import { CancelledError, Code, ServerError } from '../cfds/base/errors.ts';
import type {
  ReadonlyJSONArray,
  ReadonlyJSONObject,
} from '../base/interfaces.ts';

const kLifecycleSchema = {
  ns: 'closed-state-lifecycle',
  version: 1,
  fields: {
    value: { type: 'string', default: () => '' },
  },
} as const;

// A real schema validator (field-level `validate`), not a private-record
// mutation, so validation failures exercise the genuine code path.
const kValidatedSchema = {
  ns: 'closed-state-lifecycle-validated',
  version: 1,
  fields: {
    name: {
      type: 'string',
      default: () => '',
      validate: (data: { name?: string }) => (data.name ?? '').length >= 3,
    },
  },
} as const;

// Carries an optional peer field so a remote rebase can merge it into an
// item; the name validator supplies the invalid-edit cases.
const kRebaseSchema = {
  ns: 'closed-state-lifecycle-rebase',
  version: 1,
  fields: {
    name: {
      type: 'string',
      default: () => '',
      validate: (data: { name?: string }) => (data.name ?? '').length >= 3,
    },
    peer: { type: 'string', default: () => '' },
  },
} as const;

// v1 stores unvalidated data; v2 adds the same validator, so an auto
// schema-upgrade of a short name leaves an invalid, synthetic-dirty item.
const kUpgradeV1 = {
  ns: 'closed-state-lifecycle-upgrade',
  version: 1,
  fields: { name: { type: 'string', default: () => '' } },
} as const;

const kUpgradeV2 = {
  ns: 'closed-state-lifecycle-upgrade',
  version: 2,
  fields: {
    name: {
      type: 'string',
      default: () => '',
      validate: (data: { name?: string }) => (data.name ?? '').length >= 3,
    },
  },
} as const;

const kRegistry = new DataRegistry();
kRegistry.registerSchema(kLifecycleSchema);
kRegistry.registerSchema(kValidatedSchema);
kRegistry.registerSchema(kRebaseSchema);
kRegistry.registerSchema(kUpgradeV1);
kRegistry.registerSchema(kUpgradeV2);

// Mock batch-sync peer serving `values` as missing commits on every request.
function serveMockPeer(
  values: [string, Commit][],
): { url: string; shutdown: () => void } {
  const server = Deno.serve(
    { hostname: '127.0.0.1', port: 0 },
    async (req) => {
      const body = (await req.json()) as ReadonlyJSONArray;
      const results: { path: string; res: ReadonlyJSONObject }[] = [];
      for (const r of body as ReadonlyJSONObject[]) {
        const syncResp = SyncMessage.build(
          new BloomFilter({ size: 1, fpr: 0.5 }),
          values,
          1,
          1,
          1,
          'test-org',
          kRegistry,
        );
        results.push({
          path: r.path as string,
          res: JSONCyclicalEncoder.serialize(syncResp),
        });
      }
      return new Response(JSON.stringify(results));
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    shutdown: () => server.shutdown(),
  };
}

async function withValidationDB(
  ctx: TestSuite,
  id: string,
  run: (db: GoatDB) => Promise<void>,
): Promise<void> {
  const db = await ctx.createDB(id, { registry: kRegistry });
  try {
    await db.readyPromise();
    await run(db);
  } finally {
    await db.close();
  }
}

async function createSavedItem(db: GoatDB) {
  const item = db.create('/data/items/c', kValidatedSchema, { name: 'abc' });
  await item.commit();
  return item;
}

export default function setup(): void {
  TEST(
    'ClosedStateLifecycle',
    'close rejects when teardown retains a failed batch; retry persists the edit',
    async (ctx) => {
      const db = await ctx.createDB('closed-dropped-writes', {
        registry: kRegistry,
      });
      const failureEvents: unknown[] = [];
      db.attach(
        'WriteFailure',
        (detail: unknown) => failureEvents.push(detail),
      );
      try {
        await db.readyPromise();
        // Repo X: commit an item but leave its append unflushed. Its
        // teardown flush exhausts retries (3 forced failures) and retains the
        // batch, rejecting close; the retried close persists it.
        const xa = db.create('/data/x/xa', kLifecycleSchema, {
          value: 'x-original',
        });
        await xa.commit();
        // Repo Y holds the new dirty edit; it persists on the retried close.
        db.create('/data/y/yb', kLifecycleSchema, {
          value: 'y-edit',
        });
        db.setTestFaults({ appendFailures: 3 });
        let rejected: unknown;
        try {
          await db.close();
        } catch (e) {
          rejected = e;
        }
        assertTrue(
          rejected !== undefined,
          'close() rejects after a retained batch',
        );
        assertTrue(rejected instanceof Error, 'close rejection is an Error');
        // A retained batch is not lost, so no WriteFailure may fire; close
        // still rejects, carrying the real storage cause of the last failure.
        assertEquals(
          failureEvents.length,
          0,
          'no WriteFailure for a retained batch',
        );
        assertEquals(
          (rejected as Error).message,
          'test-forced append failure',
          'close rejection carries the storage cause',
        );
        assertEquals(db.state, 'failed', 'failed close reports failed');

        // Retry: X re-tears-down cleanly; Y's edit is committed and flushed.
        await db.close();
        assertEquals(db.state, 'closed', 'retried close settles closed');

        const db2 = await ctx.createDB('closed-dropped-writes', {
          registry: kRegistry,
        });
        await db2.readyPromise();
        await db2.open('/data/x');
        await db2.open('/data/y');
        assertEquals(
          db2.item('/data/y/yb').get('value'),
          'y-edit',
          'the retried close persisted the new edit',
        );
        assertEquals(
          db2.item('/data/x/xa').get('value'),
          'x-original',
          'the retried close persisted the previously retained committed edit',
        );
        await db2.close();
        await db.close();
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'sync classifies a real peer failure as failed even when another peer was cancelled',
    async (ctx) => {
      const serverA = Deno.serve(
        { hostname: '127.0.0.1', port: 0 },
        () => new Response(null, { status: 503 }),
      );
      const serverB = Deno.serve(
        { hostname: '127.0.0.1', port: 0 },
        () => new Response(null, { status: 503 }),
      );
      const urlA = `http://127.0.0.1:${serverA.addr.port}`;
      const urlB = `http://127.0.0.1:${serverB.addr.port}`;
      const db = await ctx.createDB('closed-mixed-sync', {
        registry: kRegistry,
        peers: [urlA, urlB],
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        // Cancel one peer's client: its sync rejects with CancelledError.
        // The other peer still fails with real ServiceUnavailable, so the
        // result must be 'failed', not 'cancelled'.
        for (const client of db.clientsForRepo('/data/items')) {
          if (client.scheduler.url === urlB) client.close();
        }
        const result = await db.sync('/data/items');
        assertEquals(result.status, 'failed', 'mixed failure is failed');
      } finally {
        await db.close().catch(() => {});
        serverA.shutdown();
        serverB.shutdown();
      }
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
  );

  TEST(
    'ClosedStateLifecycle',
    'a closed client syncs as cancelled, not as a failed peer',
    async (ctx) => {
      // Closing a client alone (scheduler still open) is shutdown cancellation:
      // its sync must reject with CancelledError, never retry-exhaustion
      // ServiceUnavailable, so db.sync() aggregates it as cancelled.
      const server = Deno.serve(
        { hostname: '127.0.0.1', port: 0 },
        () => new Response(null, { status: 503 }),
      );
      const db = await ctx.createDB('closed-client-cancel-sync', {
        registry: kRegistry,
        peers: [`http://127.0.0.1:${server.addr.port}`],
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        const client = Array.from(db.clientsForRepo('/data/items'))[0];
        client.close();
        const err = await client.sync().then(() => undefined, (e) => e);
        assertTrue(
          err instanceof CancelledError,
          'a closed client sync is cancelled, not failed',
        );
      } finally {
        await db.close().catch(() => {});
        server.shutdown();
      }
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
  );

  TEST(
    'ClosedStateLifecycle',
    'a fulfilled peer with a cancelled one reports success, not cancelled',
    async (ctx) => {
      // Peer A answers batch-sync with valid empty results so its sync cycle
      // fulfills; peer B is a plain 503 server whose client is closed so its
      // sync rejects as a genuine cancellation. The aggregate must report the
      // fulfilled peer, never 'cancelled'.
      const serverA = serveMockPeer([]);
      const serverB = Deno.serve(
        { hostname: '127.0.0.1', port: 0 },
        () => new Response(null, { status: 503 }),
      );
      const urlB = `http://127.0.0.1:${serverB.addr.port}`;
      const db = await ctx.createDB('closed-fulfilled-cancelled-sync', {
        registry: kRegistry,
        peers: [serverA.url, urlB],
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        const item = db.create('/data/items/a', kLifecycleSchema, {
          value: 'x',
        });
        await item.commit();
        // Cancel peer B's client before syncing, so only peer A fulfills.
        for (const client of db.clientsForRepo('/data/items')) {
          if (client.scheduler.url === urlB) client.close();
        }
        const result = await db.sync('/data/items');
        assertEquals(
          result.status,
          'success',
          'fulfilled+cancelled is success',
        );
      } finally {
        await db.close().catch(() => {});
        serverA.shutdown();
        serverB.shutdown();
      }
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
  );

  TEST(
    'ClosedStateLifecycle',
    'a peer-commit ingest fault under a closing repo propagates, not cancelled',
    async (ctx) => {
      // A peer DB produces a real wire commit through the public write path.
      const peerDb = await ctx.createDB('closed-ingest-fault-peer', {
        registry: kRegistry,
      });
      await peerDb.readyPromise();
      await peerDb.open('/data/items');
      const peerRepo = peerDb.repository('/data/items')!;
      const item = peerDb.create('/data/items/g1', kLifecycleSchema, {
        value: 'v1',
      });
      await item.commit();
      const remote = peerRepo.headForKey('g1')!;
      await peerDb.close();

      const server = serveMockPeer([['g1', remote]]);
      const db = await ctx.createDB('closed-ingest-fault', {
        registry: kRegistry,
        peers: [server.url],
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        // Mark the repo mid-teardown: ingestion now hits the write guard and
        // must surface that genuine storage fault, never a cancellation.
        db.repository('/data/items')!._closeState = 'closing';
        const client = Array.from(db.clientsForRepo('/data/items'))[0];
        const err = await client.sync().then(() => undefined, (e) => e);
        assertTrue(
          err !== undefined,
          'ingestion rejects while the repo closes',
        );
        assertTrue(
          !(err instanceof CancelledError),
          'the storage fault is not reported as cancellation',
        );
        assertTrue(
          err instanceof ServerError && err.code === Code.ServiceUnavailable,
          'the storage fault carries ServiceUnavailable',
        );
      } finally {
        await db.close().catch(() => {});
        server.shutdown();
      }
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
  );

  TEST(
    'ClosedStateLifecycle',
    'close aborts an in-flight batch sync promptly without waiting for its timeout',
    async (ctx) => {
      const captured = await withLogCapture(async (logs) => {
        let gate = false;
        let parked = 0;
        const release: ((r: Response) => void)[] = [];
        const server = Deno.serve(
          { hostname: '127.0.0.1', port: 0 },
          (req) =>
            gate && new URL(req.url).pathname === '/batch-sync'
              ? (parked++, new Promise<Response>((res) => release.push(res)))
              : new Response(null, { status: 503 }),
        );
        const url = `http://127.0.0.1:${server.addr.port}`;
        const db = await ctx.createDB('closed-sync-cancel-gated', {
          registry: kRegistry,
          peers: [url],
        });
        try {
          await db.readyPromise();
          await db.open('/data/items'); // initial sync finishes against 503s
          gate = true; // park only later batch-sync fetches
          const syncP = db.sync('/data/items');
          assertTrue(
            await waitUntil(() => parked > 0, 3000),
            'the gated batch-sync request reached the peer',
          );
          const t0 = performance.now();
          const closeP = db.close();
          const result = (await Promise.all([syncP, closeP]))[0] as SyncResult;
          assertEquals(result.status, 'cancelled', 'abort reports cancelled');
          assertEquals(db.state, 'closed', 'close completes');
          assertTrue(performance.now() - t0 < 3000, 'prompt transport abort');
        } finally {
          await db.close().catch(() => {});
          for (const res of release) res(new Response(null, { status: 503 }));
          await server.shutdown();
        }
        return logs;
      });
      // A close-aborted ingest must never surface the persist write-guard as
      // an unknown sync error. Only genuine storage/transport faults may be
      // logged, and shutdown is quiet; the initial-sync warning against the
      // 503 mock (no persist involvement) is unrelated and allowed.
      const persistErrors = captured.filter((e) =>
        e.error === 'UnknownSyncError' &&
        String(e.trace ?? '').includes('persistVerifiedCommits')
      );
      assertEquals(
        persistErrors.length,
        0,
        'no persist UnknownSyncError during close',
      );
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
  );

  TEST(
    'ClosedStateLifecycle',
    'query.repo reports the explicit source repo across closeRepo and reopen',
    async (ctx) => {
      const db = await ctx.createDB('closed-query-repo-identity', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        const oldRepo = db.repository('/data/items')!;
        // Repo-level close leaves the DB open; reopening the same path yields
        // a fresh instance. The query must report the explicit source.
        await db.closeRepo('/data/items');
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo removed from the registry after close',
        );
        await db.open('/data/items');
        assertTrue(
          db.repository('/data/items') !== oldRepo,
          'reopen yields a fresh repo instance',
        );
        const q = db.query({ source: oldRepo, schema: kLifecycleSchema });
        assertEquals(
          q.repo,
          oldRepo,
          'query.repo resolves the explicit source',
        );
        assertEquals(q._repoInternal(), oldRepo, 'internal lookup matches');
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'sync of a not-open repo raced by close settles cancelled, not a 503 error',
    async (ctx) => {
      const stalled = Deno.listen({ hostname: '127.0.0.1', port: 0 });
      const url = `http://127.0.0.1:${(stalled.addr as Deno.NetAddr).port}`;
      const conns: Deno.Conn[] = [];
      const acceptLoop = (async () => {
        for await (const conn of stalled) conns.push(conn);
      })().catch(() => {});
      const db = await ctx.createDB('closed-sync-notopen-cancel', {
        registry: kRegistry,
        peers: [url],
      });
      try {
        await db.readyPromise();
        // '/data/not-open' is not open; sync() must open it itself. A close
        // racing that open is a cancellation, never a 503 peer failure.
        const result = (await Promise.all([
          db.sync('/data/not-open'),
          db.close(),
        ]))[0] as SyncResult;
        assertEquals(
          result.status,
          'cancelled',
          'open-phase cancel is cancelled',
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
    'ClosedStateLifecycle',
    'invalid create does not persist and close stays recoverable via discard',
    async (ctx) => {
      const db = await ctx.createDB('closed-invalid-create', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        db.create('/data/items/bad', kValidatedSchema, {
          name: 'ab', // fails the >=3 validator
        });
        await assertThrows(() => db.close(), 'close rejects on invalid create');
        assertEquals(db.state, 'failed', 'failed close reports failed');
        db.item('/data/items/bad').discardPendingEdits();
        await db.close();
        assertEquals(db.state, 'closed', 'retried close settles closed');

        const db2 = await ctx.createDB('closed-invalid-create', {
          registry: kRegistry,
        });
        await db2.readyPromise();
        await db2.open('/data/items'); // reopen: verify disk contents, not cache
        assertTrue(
          db2.repository('/data/items')!.valueForKey('bad') === undefined,
          'invalid value was never persisted',
        );
        await db2.close();
        await db.close();
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'invalid edit makes close reject; discard + retry settles closed',
    async (ctx) => {
      const db = await ctx.createDB('closed-invalid-edit', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/good', kValidatedSchema, {
          name: 'abc',
        });
        await item.commit();
        // Discard once while open, then re-arm, so the second discard below
        // runs on a genuinely dirty item and re-proves the snapshot invariant.
        item.set('name', 'ab'); // invalid edit, stays dirty
        item.discardPendingEdits();
        assertEquals(
          item.get('name'),
          'abc',
          'held handle reads the committed value after the first discard',
        );
        item.set('name', 'ab'); // re-arm the invalid edit while still open
        let rejected: unknown;
        try {
          await db.close();
        } catch (e) {
          rejected = e;
        }
        assertTrue(rejected !== undefined, 'close rejects on invalid edit');
        assertTrue(
          rejected instanceof GoatDBCloseError,
          'close rejection is typed',
        );
        const failedItems = (rejected as GoatDBCloseError).failedItems;
        assertTrue(
          failedItems.length === 1 &&
            failedItems[0].path === '/data/items/good' &&
            failedItems[0].cause !== undefined,
          'close rejection lists the failed item with its cause',
        );
        assertEquals(db.state, 'failed', 'failed close reports failed');
        // The held handle, not a re-fetched item, must recover: discard
        // restores the committed value and clears dirty on the same instance.
        item.discardPendingEdits();
        assertEquals(
          item.get('name'),
          'abc',
          'held handle reads the committed value after the second discard',
        );
        assertEquals(
          item.isDirty,
          false,
          'held handle is clean after the second discard',
        );
        await db.close();
        assertEquals(db.state, 'closed', 'retried close settles closed');

        const db2 = await ctx.createDB('closed-invalid-edit', {
          registry: kRegistry,
        });
        await db2.readyPromise();
        await db2.open('/data/items');
        const entry = db2.repository('/data/items')!.valueForKey('good');
        assertTrue(entry !== undefined, 'item exists');
        assertEquals(
          entry![0].get('name'),
          'abc',
          'invalid edit not persisted',
        );
        await db2.close();
        await db.close();
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'a failed item recovered during teardown is excluded from the close rejection',
    async (ctx) => {
      // [a] fails its first close-time commit (transient validator rejection)
      // but is re-persisted by dependent-item teardown, so it must not be
      // reported as failed; [b] fails validation permanently and stays dirty.
      let armReject = true;
      const kRecoverySchema = {
        ns: 'closed-state-lifecycle-recovery',
        version: 1,
        fields: {
          value: {
            type: 'string',
            default: () => '',
            validate: (data: { value?: string }) => {
              if (armReject && data.value === 'blocked') {
                armReject = false;
                return false;
              }
              return true;
            },
          },
        },
      } as const;
      const recoveryRegistry = new DataRegistry();
      recoveryRegistry.registerSchema(kRecoverySchema);
      recoveryRegistry.registerSchema(kValidatedSchema);
      const db = await ctx.createDB('closed-recovered-excluded', {
        registry: recoveryRegistry,
      });
      try {
        await db.readyPromise();
        const a = db.create('/data/x/a', kRecoverySchema, { value: 'ok' });
        const c = db.create('/data/x/c', kRecoverySchema, { value: 'ok' });
        const b = db.create('/data/y/b', kValidatedSchema, { name: 'abc' });
        await a.commit();
        await c.commit();
        await b.commit();
        // Auto-close both repos so close-time commits reopen them; the first
        // close-time validation of [a] then happens in its commit attempt.
        await db.repository('/data/x')!._testTriggerIdleTimeout();
        await db.repository('/data/y')!._testTriggerIdleTimeout();
        a.set('value', 'blocked'); // fails once, then recovers
        c.set('value', 'c2'); // commits clean, keeps /data/x in pendingRepos
        b.set('name', 'ab'); // permanently invalid
        armReject = true;
        let rejected: unknown;
        try {
          await db.close();
        } catch (e) {
          rejected = e;
        }
        assertTrue(
          rejected instanceof GoatDBCloseError,
          'close rejects with the typed error',
        );
        const failedItems = (rejected as GoatDBCloseError).failedItems;
        assertTrue(
          failedItems.length === 1 && failedItems[0].path === '/data/y/b',
          'only the still-failed item is listed, got ' +
            JSON.stringify(failedItems.map((f) => f.path)),
        );
        assertEquals(db.state, 'failed', 'failed close reports failed');
        b.discardPendingEdits();
        await db.close();
        assertEquals(db.state, 'closed', 'retried close settles closed');
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'peer commit ingestion persists while open and rejects after close',
    async (ctx) => {
      // A peer DB produces the commits through the public write path, so the
      // ingested objects are real wire commits (org, session, schema all
      // correct by construction).
      const peerDb = await ctx.createDB('closed-persist-guard-peer', {
        registry: kRegistry,
      });
      await peerDb.readyPromise();
      await peerDb.open('/data/items');
      const peerRepo = peerDb.repository('/data/items')!;
      const item1 = peerDb.create('/data/items/verified-1', kLifecycleSchema, {
        value: 'v1',
      });
      await item1.commit();
      const item2 = peerDb.create('/data/items/verified-2', kLifecycleSchema, {
        value: 'v2',
      });
      await item2.commit();
      const remote1 = peerRepo.headForKey('verified-1')!;
      const remote2 = peerRepo.headForKey('verified-2')!;
      await peerDb.close();

      const db = await ctx.createDB('closed-persist-guard', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        const repo = db.repository('/data/items')!;
        // Ingestion accepts a peer commit while open and it becomes visible
        // through the public read API.
        const persisted = await repo.persistVerifiedCommits([remote1]);
        assertEquals(persisted.length, 1, 'open db ingests a peer commit');
        const applied = db.item('/data/items/verified-1');
        await applied.readyPromise();
        assertEquals(applied.get('value'), 'v1', 'ingested commit is visible');

        await db.close();
        // After close ingestion rejects and writes nothing.
        await assertThrows(
          () => repo.persistVerifiedCommits([remote2]),
          'ingestion rejects after close',
        );
        // Reopen proves the rejected commit persisted nothing.
        const db2 = await ctx.createDB('closed-persist-guard', {
          registry: kRegistry,
        });
        await db2.readyPromise();
        await db2.open('/data/items');
        assertEquals(
          db2.count('/data/items'),
          1,
          'rejected ingestion persisted nothing; accepted one survived reopen',
        );
        assertTrue(
          db2.repository('/data/items')!.valueForKey('verified-2') ===
            undefined,
          'the rejected ingestion left no trace',
        );
        await db2.close();
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'idle auto-close joins an in-flight verified write; reopen sees it',
    async (ctx) => {
      // A peer DB produces the commit through the public write path, so the
      // ingested object is a real wire commit.
      const peerDb = await ctx.createDB('closed-idle-verified-peer', {
        registry: kRegistry,
      });
      await peerDb.readyPromise();
      await peerDb.open('/data/items');
      const peerRepo = peerDb.repository('/data/items')!;
      const peerItem = peerDb.create('/data/items/v', kLifecycleSchema, {
        value: 'v',
      });
      await peerItem.commit();
      const remote = peerRepo.headForKey('v')!;
      await peerDb.close();

      const db = await ctx.createDB('closed-idle-verified', {
        registry: kRegistry,
        repoInactivityTimeoutMs: 0, // deterministic idle hook
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        const repo = db.repository('/data/items')!;
        // Leave the verified write in flight while idle close fires. The close
        // must join it: otherwise NewCommitSync is detached and the commit
        // never reaches disk, so reopening would not see it.
        const ingestP = repo.persistVerifiedCommits([remote]);
        await repo._testTriggerIdleTimeout();
        await ingestP;
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo auto-closed while the write was in flight',
        );

        await db.close();
        const db2 = await ctx.createDB('closed-idle-verified', {
          registry: kRegistry,
        });
        await db2.readyPromise();
        await db2.open('/data/items');
        const entry = db2.repository('/data/items')!.valueForKey('v');
        assertTrue(entry !== undefined, 'in-flight verified write persisted');
        assertEquals(entry![0].get('value'), 'v');
        await db2.close();
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'closing with an in-flight query produces no TypeError log and gates query.repo',
    async (ctx) => {
      const captured = await withLogCapture(async (logs) => {
        const db = await ctx.createDB('closed-inflight-query', {
          registry: kRegistry,
        });
        await db.readyPromise();
        await db.open('/data/items');
        db.create('/data/items/q1', kLifecycleSchema, { value: 'v' });
        const repo = db.repository('/data/items')!;
        const q1 = db.query({
          source: '/data/items',
          schema: kLifecycleSchema,
        });
        const q2 = db.query({ source: repo, schema: kLifecycleSchema });
        const q3 = db.query({ source: q2, schema: kLifecycleSchema });
        q1.onResultsChanged(() => {});
        q2.onResultsChanged(() => {});
        // Subscriptions start loading synchronously; assert both are in flight.
        assertTrue(
          q1.loading && q2.loading,
          'query scans started before close',
        );
        await db.close();
        for (const q of [q1, q2, q3]) {
          assertEquals(q.repo, undefined, 'query.repo gated after close');
          assertEquals(q.loading, false, 'query loading settled after close');
          await q.loadingFinished(); // resolves; must not hang or reject
        }
        return logs;
      });
      const typeErrors = captured.filter((e) =>
        (e.message ?? '').includes('TypeError')
      );
      assertEquals(typeErrors.length, 0, 'no TypeError log during close');
      const storageWarnings = captured.filter((e) =>
        e.severity === 'WARNING' && e.error === 'StorageError'
      );
      assertEquals(
        storageWarnings.length,
        0,
        'no StorageError shutdown warning during close',
      );
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'stalled bootstrap + pending edit: first close rejects, retried close settles closed',
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
      const dir = await ctx.tempDir('closed-stalled-pending');
      const captured = await withLogCapture(async (logs) => {
        const db = new GoatDB({
          path: dir,
          orgId: 'test-org',
          mode: 'client',
          peers: [url],
          registry: kRegistry,
        });
        try {
          // A pending edit exists before bootstrap completes/fails.
          const pending = db.create('/data/items/p1', kLifecycleSchema, {
            value: 'v',
          });
          assertTrue(
            await waitUntil(() => requests.length > 0, 2000),
            'client bootstrap reached the stalled server',
          );
          await assertThrows(
            () => db.close(),
            'first close rejects surfacing the bootstrap failure',
          );
          assertEquals(db.state, 'failed', 'failed close reports failed');
          assertEquals(
            pending.isDirty,
            true,
            'draft survives the failed close; discard is explicit',
          );
          await db.close();
          assertEquals(db.state, 'closed', 'retried close settles closed');
        } finally {
          await db.close().catch(() => {});
          server.shutdown();
        }
        return logs;
      });
      const dropLogs = captured.filter((e) =>
        (e.message ?? '').includes('could not be persisted and were discarded')
      );
      assertEquals(dropLogs.length, 1, 'dropped edit logged exactly once');
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
  );

  TEST(
    'ClosedStateLifecycle',
    'a slow but healthy bootstrap is not aborted; close settles closed',
    async (ctx) => {
      const session = await generateSession('delayed-bootstrap-owner');
      const encodedSession = await encodeSession(session);
      let authHits = 0;
      const server = Deno.serve(
        { hostname: '127.0.0.1', port: 0 },
        async (req) => {
          if (new URL(req.url).pathname === '/auth/session') {
            authHits++;
            // A healthy but slow bootstrap: the server answers, just well
            // after the stock 2s stall would have aborted it.
            await sleep(2200);
            return Response.json({
              session: encodedSession,
              roots: [encodedSession],
            });
          }
          return new Response(null, { status: 500 });
        },
      );
      const url = `http://127.0.0.1:${server.addr.port}`;
      const captured = await withLogCapture(async (logs) => {
        const db = new GoatDB({
          path: await ctx.tempDir('closed-delayed-success'),
          orgId: 'test-org',
          mode: 'client',
          peers: [url],
          registry: kRegistry,
          // Raise the stall window above the healthy bootstrap's delay; if
          // close() aborted on elapsed time alone, this slow-but-healthy
          // bootstrap would be killed and close would reject.
          bootstrapStallMs: 5000,
        });
        try {
          await db.close();
          assertEquals(db.state, 'closed', 'close settles closed');
        } finally {
          await db.close().catch(() => {});
          server.shutdown();
        }
        return logs;
      });
      assertEquals(authHits, 1, 'bootstrap reached the peer exactly once');
      const stallWarnings = captured.filter((e) =>
        (e.message ?? '').includes('Bootstrap did not finish')
      );
      assertEquals(stallWarnings.length, 0, 'no stall-abort warning logged');
    },
    { skip: isBrowser() || typeof Deno === 'undefined' },
  );

  TEST(
    'ClosedStateLifecycle',
    'a clean commit clears both isDirty and hasPendingLocalEdits',
    async (ctx) => {
      const db = await ctx.createDB('closed-clean-edit', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/f17', kLifecycleSchema, {
          value: 'a',
        });
        await item.commit();
        assertEquals(item.isDirty, false, 'isDirty false after clean commit');
        assertEquals(
          item.hasPendingLocalEdits,
          false,
          'hasPendingLocalEdits false after clean commit',
        );
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'failed teardown gates item.repository and keeps session keys unreachable',
    async (ctx) => {
      const db = await ctx.createDB('closed-failed-gate', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/g', kLifecycleSchema, {
          value: 'v',
        });
        await item.commit();
        // Auto-close the repo so the close-time commit path must reopen it
        // via _acquireRepoForClose, where the injected commit fault fires.
        const repo = db.repository('/data/items')!;
        await repo._testTriggerIdleTimeout();
        item.set('value', 'v2'); // dirty so close-time commit runs
        db.setTestFaults({ commitFailures: 0 });
        await assertThrows(() => db.close(), 'close rejects');
        assertEquals(db.state, 'failed', 'failed close reports failed');
        assertEquals(
          item.repository,
          undefined,
          'item.repository gated on failure',
        );
        await assertThrows(
          () => db.getTrustPool(),
          'trust pool unreachable after failed teardown',
        );
        assertThrows(
          () => db.currentSession,
          'currentSession gated on failure',
        );
        db.setTestFaults({ commitFailures: -1 });
        await db.close();
        assertEquals(db.state, 'closed', 'retried close settles closed');
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'discard restores committed head, keeps rebased peer fields, and emits change',
    async (ctx) => {
      const db = await ctx.createDB('closed-discard-restore', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/keep', kRebaseSchema, {
          name: 'abc',
        });
        await item.commit();
        // A peer commit under a new head merges the peer field into the live
        // item via rebase.
        const repo = db.repository('/data/items')!;
        await repo.setValueForKey(
          'keep',
          new Item(
            { schema: kRebaseSchema, data: { name: 'abc', peer: 'p' } },
            db.registry,
          ),
          repo.headForKey('keep'),
        );
        item.rebase();
        assertEquals(item.get('peer'), 'p', 'rebase surfaces the peer field');

        const events: string[] = [];
        const detachChange = item.attach('change', () => events.push('change'));
        const detachItemChanged = db.attach(
          'ItemChanged',
          (path: string) => events.push(`ItemChanged:${path}`),
        );
        const detachDocChanged = repo.attach(
          'DocumentChanged',
          (key: string) => events.push(`DocumentChanged:${key}`),
        );

        item.set('name', 'ab'); // invalid local edit, stays dirty
        const ageBeforeDiscard = item.age;
        item.discardPendingEdits();
        assertEquals(item.isDirty, false, 'discard clears dirty');
        assertEquals(
          item.age,
          ageBeforeDiscard + 1,
          'discard advances the observation version',
        );
        assertEquals(
          item.get('name'),
          'abc',
          'discard restores committed head',
        );
        assertEquals(
          item.get('peer'),
          'p',
          'discard keeps rebased peer fields',
        );
        assertTrue(events.includes('change'), 'item change emitted');
        assertTrue(
          events.includes('ItemChanged:/data/items/keep'),
          'ItemChanged emitted',
        );
        assertTrue(
          events.includes('DocumentChanged:keep'),
          'DocumentChanged emitted',
        );
        detachChange();
        detachItemChanged();
        detachDocChanged();

        item.set('name', 'ab'); // re-arm the invalid edit
        await assertThrows(() => db.close(), 'close rejects on invalid edit');
        assertEquals(db.state, 'failed', 'failed close reports failed');
        item.discardPendingEdits();
        await db.close();
        assertEquals(db.state, 'closed', 'retried close settles closed');

        const db2 = await ctx.createDB('closed-discard-restore', {
          registry: kRegistry,
        });
        await db2.readyPromise();
        await db2.open('/data/items');
        assertEquals(
          db2.item('/data/items/keep').get('name'),
          'abc',
          'reopened value equals the persisted head, not the draft',
        );
        await db2.close();
        await db.close();
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'discard before the repo opens still notifies live observers',
    async (ctx) => {
      const db = await ctx.createDB('closed-preopen-discard', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.item('/data/items/pre');
        const events: string[] = [];
        const detachChange = item.attach('change', () => events.push('change'));
        const detachItemChanged = db.attach(
          'ItemChanged',
          () => events.push('ItemChanged'),
        );
        const ageBefore = item.age;
        item.discardPendingEdits();
        assertTrue(
          events.includes('change'),
          'change emitted before repo opens',
        );
        assertTrue(
          events.includes('ItemChanged'),
          'ItemChanged emitted before repo opens',
        );
        assertEquals(
          item.age,
          ageBefore + 1,
          'discard advances the observation version before repo opens',
        );
        detachChange();
        detachItemChanged();
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'discard-mid-write window leaves _head consistent',
    async (ctx) => {
      const db = await ctx.createDB('closed-discard-mid-write', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/mw', kLifecycleSchema, {
          value: 'v1',
        });
        await item.commit();
        const repo = db.repository('/data/items')!;
        // Gate the write so a discard lands mid-write; _head must still advance
        // so the follow-up commit chains onto the landed write.
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        let writeRan = false;
        const gatedWrite = async (
          key: string,
          doc: Item,
          head: string | Commit | undefined,
        ) => {
          writeRan = true;
          await gate;
          return repo.setValueForKey(key, doc, head);
        };
        item.set('value', 'v2'); // pending edit; becomes currentDoc
        const commitP = item._commitTo(repo, gatedWrite as never);
        assertTrue(
          await waitUntil(() => writeRan, 2000),
          'write started before discard',
        );
        item.discardPendingEdits(); // bump epoch mid-write
        release();
        await commitP;
        // The committed snapshot tracks the advanced head after the mid-write
        // write: a later discard restores the landed value, not the stale
        // pre-write base.
        item.discardPendingEdits();
        assertEquals(
          item.get('value'),
          'v2',
          'discard after mid-write write restores the advanced head',
        );
        const landed = repo.headForKey('mw')!;
        item.set('value', 'v3');
        await item.commit();
        // The follow-up commit must parent onto the landed mid-write write, not
        // a stale pre-write base: that is what keeps _head consistent.
        assertTrue(
          repo.headForKey('mw')!.parents.includes(landed.id),
          'follow-up commit chains onto the mid-write head',
        );
        await db.close();
        const db2 = await ctx.createDB('closed-discard-mid-write', {
          registry: kRegistry,
        });
        await db2.readyPromise();
        await db2.open('/data/items');
        assertEquals(
          db2.item('/data/items/mw').get('value'),
          'v3',
          'reopened value equals the final commit',
        );
        await db2.close();
      } finally {
        await db.close().catch(() => {});
      }
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'auto schema-upgrade skip logs a WARNING for invalid synthetic-dirty items',
    async (ctx) => {
      const id = 'closed-upgrade-warn';
      const db1 = await ctx.createDB(id, { registry: kRegistry });
      await db1.readyPromise();
      const item1 = db1.create('/data/items/w', kUpgradeV1, { name: 'ab' });
      await item1.commit();
      await db1.close();

      const captured = await withLogCapture(async (logs) => {
        const db2 = await ctx.createDB(id, { registry: kRegistry });
        await db2.readyPromise();
        const item2 = db2.item('/data/items/w');
        await item2.readyPromise();
        // Wait for the auto-upgrade commit attempt to run and log its skip.
        assertTrue(
          await waitUntil(
            () =>
              logs.some((e) =>
                (e.message ?? '').includes('Skipping commit for invalid item')
              ),
            3000,
          ),
          'auto-upgrade skip warning was logged',
        );
        item2.discardPendingEdits(); // clear synthetic dirt so close settles
        await db2.close();
        return logs;
      });
      const warnings = captured.filter((e) =>
        (e.message ?? '').includes('Skipping commit for invalid item')
      );
      assertEquals(
        warnings.length,
        1,
        'invalid synthetic-dirty drop logged once',
      );
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'committing an invalid edit leaves the saved value unchanged',
    (ctx) =>
      withValidationDB(ctx, 'invalid-public-commit', async (db) => {
        const item = await createSavedItem(db);
        try {
          item.set('name', 'ab');
          await item.commit();
          const repo = db.repository('/data/items')!;
          assertEquals(repo.valueForKey('c')?.[0].get('name'), 'abc');
        } finally {
          item.discardPendingEdits();
        }
      }),
  );

  TEST(
    'ClosedStateLifecycle',
    'close saves a valid pending edit after repo auto-close',
    async (ctx) => {
      const dbId = 'validated-close-save';
      await withValidationDB(ctx, dbId, async (db) => {
        const item = await createSavedItem(db);
        await db.repository('/data/items')!._testTriggerIdleTimeout();
        assertEquals(
          db.repository('/data/items'),
          undefined,
          'repo auto-closed',
        );
        item.set('name', 'abcd');
      });
      await withValidationDB(ctx, dbId, async (db) => {
        await db.open('/data/items');
        assertEquals(db.item('/data/items/c').get('name'), 'abcd');
      });
    },
  );

  TEST(
    'ClosedStateLifecycle',
    'idle-close retains a batch; one-failure close retry settles closed',
    (ctx) =>
      withValidationDB(ctx, 'closed-idle-retained-batch', async (db) => {
        const failureEvents: unknown[] = [];
        db.attach('WriteFailure', (d: unknown) => failureEvents.push(d));
        await db.open('/data/items');
        const item = db.create('/data/items/g1', kLifecycleSchema, {
          value: 'v1',
        });
        await item.commit();
        // 3 forced append failures retain the batch (no WriteFailure); DB stays ready.
        db.setTestFaults({ appendFailures: 3 });
        await assertThrows(
          () => db.repository('/data/items')!._testTriggerIdleTimeout(),
          'idle close rejects on a retained batch',
        );
        assertEquals(db.state, 'ready', 'DB stays ready after failed close');
        // One fresh transient failure on the retried close must settle closed and persist.
        db.setTestFaults({ appendFailures: 1 });
        await db.close();
        assertEquals(db.state, 'closed', 'retried close settles closed');
        assertEquals(failureEvents.length, 0, 'no WriteFailure at any point');
        const db2 = await ctx.createDB('closed-idle-retained-batch', {
          registry: kRegistry,
        });
        await db2.readyPromise();
        await db2.open('/data/items');
        assertEquals(
          db2.item('/data/items/g1').get('value'),
          'v1',
          'the retained commit persisted on reopen',
        );
        await db2.close();
      }),
  );
}

// Standalone smoke when executed directly: `deno run -A tests/closed-state-lifecycle.test.ts`
if (import.meta.main) {
  setup();
  const summary = await TestsRunner.default.run('ClosedStateLifecycle');
  for (const r of summary.results) {
    if (!r.passed && !r.skipped) {
      console.error(`FAIL: ${r.suiteName}/${r.testName}: ${r.error}`);
    }
  }
  Deno.exit(summary.failed > 0 ? 1 : 0);
}
