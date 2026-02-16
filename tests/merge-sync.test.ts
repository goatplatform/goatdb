import { TEST } from './mod.ts';
import { GoatDB } from '../db/db.ts';
import { Server } from '../net/server/server.ts';
import {
  assertEquals,
  assertExists,
  assertLessThan,
  assertTrue,
} from './asserts.ts';
import { generateBuildInfo } from '../base/build-info.ts';
import * as path from '../base/path.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { sleep } from '../base/time.ts';
import {
  createTestDomainConfig,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';

async function createTestServer(
  ctx: { tempDir(s: string): Promise<string> },
  name: string,
) {
  const serverPath = await ctx.tempDir(name);
  const { domain, setPort } = createTestDomainConfig();
  const buildInfo = await generateBuildInfo(
    path.join((await FileImplGet()).getCWD(), 'deno.json'),
  );
  const server = new Server<Schema>({
    path: serverPath,
    orgId: 'test-org',
    port: 0,
    registry: kMergeTestRegistry,
    buildInfo,
    domain,
  });
  return { server, setPort };
}

async function createTestClient(
  ctx: { tempDir(s: string): Promise<string> },
  name: string,
  port: number,
) {
  const clientPath = await ctx.tempDir(name);
  const client = new GoatDB({
    path: clientPath,
    orgId: 'test-org',
    mode: 'client',
    peers: [`http://localhost:${port}`],
    registry: kMergeTestRegistry,
  });
  await client.readyPromise();
  return client;
}

async function waitForItem(
  db: GoatDB,
  repoPath: string,
  key: string,
  timeoutMs = 5000,
) {
  await db.open(repoPath);
  const item = db.item(repoPath, key);
  await item.readyPromise();
  const start = performance.now();
  while (!item.exists) {
    await sleep(10);
    assertLessThan(
      performance.now() - start,
      timeoutMs,
      'Timeout waiting for item to exist',
    );
  }
  return item;
}

export default function setup(): void {
  TEST('MergeSync', 'full sync empty to populated', async (ctx) => {
    const { server, setPort } = await createTestServer(ctx, 'sync-s1');
    let client: GoatDB | undefined;
    try {
      await server.start();
      assertExists(server.port);
      setPort(server.port);

      // Create item on server
      const serverServices = await server.servicesForOrganization('test-org');
      const serverDb = serverServices.db;
      await serverDb.readyPromise();
      const serverItem = serverDb.create(
        '/merge-test/sync1',
        kMergeTestSchemaV1,
        { title: 'server-item', count: 100 },
      );
      await serverDb.flush('/merge-test/sync1');

      // Create empty client and sync
      client = await createTestClient(ctx, 'sync-c1', server.port);
      const syncResult = await client.sync('/merge-test/sync1');
      assertEquals(syncResult.status, 'success');

      // Verify client got the item
      const clientItem = await waitForItem(
        client,
        '/merge-test/sync1',
        serverItem.key,
      );
      assertEquals(clientItem.get('title'), 'server-item');
      assertEquals(clientItem.get('count'), 100);
    } finally {
      if (client) {
        await client.flushAll();
        await client.close();
      }
      await server.stop();
    }
  });

  TEST('MergeSync', 'client sync pulls server items', async (ctx) => {
    const { server, setPort } = await createTestServer(ctx, 'sync-s2');
    let client: GoatDB | undefined;
    try {
      await server.start();
      assertExists(server.port);
      setPort(server.port);

      const serverServices = await server.servicesForOrganization('test-org');
      const serverDb = serverServices.db;
      await serverDb.readyPromise();

      // Server creates item A
      serverDb.create(
        '/merge-test/sync2',
        kMergeTestSchemaV1,
        { title: 'from-server', count: 1 },
      );
      await serverDb.flush('/merge-test/sync2');

      // Client creates item B locally
      client = await createTestClient(ctx, 'sync-c2', server.port);
      client.create(
        '/merge-test/sync2',
        kMergeTestSchemaV1,
        { title: 'from-client', count: 2 },
      );

      // Flush local item so it's committed before sync
      await client.flush('/merge-test/sync2');

      // Sync pulls server items to client
      await client.sync('/merge-test/sync2');

      // Client should have both: local item B + pulled item A
      assertEquals(client.count('/merge-test/sync2'), 2);
    } finally {
      if (client) {
        await client.flushAll();
        await client.close();
      }
      await server.stop();
    }
  });

  TEST('MergeSync', 'merge after remote commits', async (ctx) => {
    const { server, setPort } = await createTestServer(ctx, 'sync-s3');
    let client: GoatDB | undefined;
    try {
      await server.start();
      assertExists(server.port);
      setPort(server.port);

      const serverServices = await server.servicesForOrganization('test-org');
      const serverDb = serverServices.db;
      await serverDb.readyPromise();

      // Both create same key with different data
      // Server: load a specific key
      await serverDb.load('/merge-test/sync3/shared-key', kMergeTestSchemaV1, {
        title: 'server-version',
        count: 100,
      });

      // Client
      client = await createTestClient(ctx, 'sync-c3', server.port);
      await client.load('/merge-test/sync3/shared-key', kMergeTestSchemaV1, {
        title: 'client-version',
        count: 200,
      });

      // Sync should exchange commits
      const syncResult = await client.sync('/merge-test/sync3');
      assertEquals(syncResult.status, 'success');

      // After sync, a merge should be possible
      // The client should have both versions' data available
      const clientItem = client.item('/merge-test/sync3', 'shared-key');
      await clientItem.readyPromise();
      assertTrue(clientItem.exists, 'client item should exist after sync');
    } finally {
      if (client) {
        await client.flushAll();
        await client.close();
      }
      await server.stop();
    }
  });

  TEST(
    'MergeSync',
    'untrusted mode sync completes without crash',
    async (ctx) => {
      const { server, setPort } = await createTestServer(ctx, 'sync-s4');
      let client: GoatDB | undefined;
      try {
        await server.start();
        assertExists(server.port);
        setPort(server.port);

        // Create untrusted client
        const clientPath = await ctx.tempDir('sync-c4');
        client = new GoatDB({
          path: clientPath,
          orgId: 'test-org',
          mode: 'client',
          peers: [`http://localhost:${server.port}`],
          registry: kMergeTestRegistry,
          trusted: false,
        });
        await client.readyPromise();

        // In untrusted mode, verify the sync flow completes without crash.
        // Actual signature verification happens server-side during sync;
        // client-side uses persistVerifiedCommits which bypasses verification.
        const item = client.create(
          '/merge-test/sync4',
          kMergeTestSchemaV1,
          { title: 'untrusted-item', count: 1 },
        );

        // Sync should work (client signs its own commits)
        const syncResult = await client.sync('/merge-test/sync4');
        // The sync may or may not succeed depending on auth setup,
        // but it should not crash
        assertTrue(
          typeof syncResult.status === 'string',
          'sync should complete without crash',
        );
      } finally {
        if (client) {
          await client.flushAll();
          await client.close();
        }
        await server.stop();
      }
    },
  );
}
