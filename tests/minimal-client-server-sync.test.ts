import { TEST } from './mod.ts';
import { GoatDB } from '../db/db.ts';
import { Server } from '../net/server/server.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { assertEquals, assertExists } from './asserts.ts';
import { generateBuildInfo } from '../server/build-info.ts';
import * as path from '@std/path';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import type { Schema } from '../cfds/base/schema.ts';

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

/**
 * Creates a minimal domain config for testing
 */
function createTestDomainConfig() {
  return {
    resolveOrg: (orgId: string) => `http://localhost/${orgId}`,
    resolveDomain: (url: string) => {
      try {
        const u = new URL(url);
        return u.hostname === 'localhost' ? 'test-org' : '';
      } catch {
        return '';
      }
    },
  };
}

export default function setup(): void {
  TEST(
    'MinimalSync',
    'client creates item and syncs with server',
    async (ctx) => {
      // Create server with temporary directory and explicit test port
      const serverPath = await ctx.tempDir('sync-server');
      const testPort = 9876; // Use an explicit port for testing
      const domain = createTestDomainConfig();

      // Generate build info
      const buildInfo = await generateBuildInfo(
        path.join((await FileImplGet()).getCWD(), 'deno.json'),
      );

      // Initialize server
      const server = new Server<Schema>({
        path: serverPath,
        orgId: 'test-org',
        port: testPort,
        registry: testRegistry,
        buildInfo,
        domain,
      });

      // Initialize client
      let client: GoatDB | undefined;

      try {
        // Start the server
        await server.start();

        // Create client with connection to server
        const clientPath = await ctx.tempDir('sync-client');
        client = new GoatDB({
          path: clientPath,
          orgId: 'test-org',
          mode: 'client',
          peers: [`http://localhost:${testPort}`],
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

        // Wait for the server item to finish loading
        // ManagedItem starts with null state and loads asynchronously
        await new Promise<void>((resolve) => {
          const checkLoaded = () => {
            if (serverItem.schema.ns !== null) {
              resolve();
            } else {
              setTimeout(checkLoaded, 50);
            }
          };
          checkLoaded();
        });

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
        }

        // Stop the server by aborting its signal
        if (server['_abortController']) {
          server['_abortController'].abort();
        }

        // Give a moment for the server to shut down
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  );
}
