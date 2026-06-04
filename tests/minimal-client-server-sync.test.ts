import { TEST } from './mod.ts';
import { GoatDB } from '../db/db.ts';
import { Server } from '../net/server/server.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import {
  assertEquals,
  assertExists,
  assertLessThan,
  assertThrows,
} from './asserts.ts';
import { generateBuildInfo } from '../base/build-info.ts';
import * as path from '../base/path.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { sleep } from '../base/time.ts';
import { createTestDomainConfig } from './merge-test-utils.ts';

// Define a minimal test schema
const MinimalTestSchema = {
  ns: 'sync-test',
  version: 1,
  fields: {
    title: { type: 'string', required: true },
    value: { type: 'number', default: () => 100 },
    timestamp: { type: 'number', required: true },
  },
} as const;

// Create and register the schema with a registry
const testRegistry = new DataRegistry();
testRegistry.registerSchema(MinimalTestSchema);

export default function setup(): void {
  TEST(
    'MinimalSync',
    'client creates item and syncs with server',
    async (ctx) => {
      // Create server with temporary directory and OS-assigned port
      const serverPath = await ctx.tempDir('sync-server');
      const { domain, setPort } = createTestDomainConfig();

      // Generate build info
      const buildInfo = await generateBuildInfo(
        path.join((await FileImplGet()).getCWD(), 'deno.json'),
      );

      // Initialize server
      const server = new Server<Schema>({
        path: serverPath,
        orgId: 'test-org',
        port: 0,
        registry: testRegistry,
        buildInfo,
        domain,
      });

      // Initialize client
      let client: GoatDB | undefined;

      try {
        // Start the server and capture the actual port
        await server.start();
        assertExists(server.port, 'Server port must be assigned after start()');
        setPort(server.port);

        // Create client with connection to server
        const clientPath = await ctx.tempDir('sync-client');
        client = new GoatDB({
          path: clientPath,
          orgId: 'test-org',
          mode: 'client',
          peers: [`http://localhost:${server.port}`],
          registry: testRegistry,
        });

        // Wait for client initialization
        await client.readyPromise();

        // Create test item on client
        const testData = {
          title: 'Test Item for Sync',
          value: 42,
          timestamp: Date.now(),
        };
        const item = client.create(
          '/test/sync-repo',
          MinimalTestSchema,
          testData,
        );
        assertExists(item);
        assertEquals(item.get('title'), testData.title);
        assertEquals(item.get('value'), testData.value);
        assertEquals(item.get('timestamp'), testData.timestamp);

        // Force sync and verify success
        const syncResult = await client.sync('/test/sync-repo');
        assertEquals(syncResult.status, 'success');

        // Verify item exists on server
        const serverServices = await server.servicesForOrganization('test-org');
        const serverDb = serverServices.db;
        await serverDb.open('/test/sync-repo');
        const serverItem = serverDb.item('/test/sync-repo', item.key);

        // Wait for the server item to finish loading from local DB.
        // Once loaded, the item's schema is populated (exists === true)
        // if the sync data has arrived. Polling with a generous timeout
        // handles the race between client.sync() completing and the
        // server-side DB write being visible via the open reference.
        await serverItem.readyPromise();
        const sleepStart = performance.now();
        while (!serverItem.exists) {
          await sleep(10);
          assertLessThan(
            performance.now() - sleepStart,
            5000,
            'Timeout waiting for item to exist',
          );
        }

        // Verify all data fields match
        assertExists(serverItem);
        assertEquals(serverItem.get('title'), testData.title);
        assertEquals(serverItem.get('value'), testData.value);
        assertEquals(serverItem.get('timestamp'), testData.timestamp);
        assertEquals(serverItem.schema.ns, 'sync-test');
      } finally {
        // Clean up resources
        if (client) {
          await client.flushAll();
          await client.close();
        }

        await server.stop();
      }
    },
  );

  TEST(
    'MinimalSync',
    'server start keeps shutdown guards closed while awaiting a prior stop',
    async (ctx) => {
      const serverPath = await ctx.tempDir('sync-server-stop-guard');
      const { domain } = createTestDomainConfig();
      const buildInfo = await generateBuildInfo(
        path.join((await FileImplGet()).getCWD(), 'deno.json'),
      );
      const server = new Server<Schema>({
        path: serverPath,
        orgId: 'test-org',
        port: 0,
        registry: testRegistry,
        buildInfo,
        domain,
      });
      let releaseClose: (() => void) | undefined;

      try {
        const services = await server.servicesForOrganization('test-org');
        const originalClose = services.db.close.bind(services.db);
        const closeGate = new Promise<void>((resolve) => {
          releaseClose = resolve;
        });
        services.db.close = async () => {
          await closeGate;
          return await originalClose();
        };

        const stopPromise = server.stop();
        const restartPromise = server.start();
        await sleep(10);

        await assertThrows(
          () => server.servicesForOrganization('test-org'),
          Error,
          'Service Unavailable',
        );

        releaseClose?.();
        await Promise.all([stopPromise, restartPromise]);
      } finally {
        releaseClose?.();
        await server.stop();
      }
    },
  );

  TEST(
    'MinimalSync',
    'server start does not bind after stop wins during service startup',
    async (ctx) => {
      const serverPath = await ctx.tempDir('sync-server-stop-during-start');
      const { domain } = createTestDomainConfig();
      const buildInfo = await generateBuildInfo(
        path.join((await FileImplGet()).getCWD(), 'deno.json'),
      );
      const server = new Server<Schema>({
        path: serverPath,
        orgId: 'test-org',
        port: 0,
        registry: testRegistry,
        buildInfo,
        domain,
      });
      let releaseEmailStart: (() => void) | undefined;

      try {
        const services = await server.servicesForOrganization('test-org');
        const originalEmailStart = services.email.start.bind(services.email);
        const emailStartGate = new Promise<void>((resolve) => {
          releaseEmailStart = resolve;
        });
        services.email.start = async () => {
          await emailStartGate;
          originalEmailStart();
        };

        const startPromise = server.start();
        const stopPromise = server.stop();
        releaseEmailStart?.();
        await Promise.all([startPromise, stopPromise]);

        assertEquals(
          server.port,
          undefined,
          'start() must not bind after stop() wins during service startup',
        );
      } finally {
        releaseEmailStart?.();
        await server.stop();
      }
    },
  );
}
