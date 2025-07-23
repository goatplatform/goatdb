/**
 * End-to-End Latency Test for GoatDB Setup and Export
 * 
 * This module provides setup function for the test infrastructure.
 * All actual test code is defined below and registered via the setup function.
 */

/**
 * Setup function required by GoatDB test infrastructure
 * 
 * This function registers all tests in this module with the test runner.
 * It must be the default export so tests-entry.ts can import and call it.
 */
export default function setupE2ELatency() {
  // Test registration happens automatically when TEST() calls are executed
  // The actual test definitions below will register themselves when this module loads
}

/**
 * End-to-End Latency Test for GoatDB
 * 
 * This test measures the real-world synchronization latency between two GoatDB clients
 * connected through a server. The test simulates a typical distributed scenario where:
 * 1. Multiple clients are connected to a central server
 * 2. One client creates data
 * 3. Other clients need to receive that data as quickly as possible
 * 
 * The test measures the time from item creation to item visibility on remote clients,
 * providing insights into GoatDB's real-time synchronization performance.
 */

import { assertEquals, assertExists, assertTrue, assertLessThan } from './asserts.ts';
import { TEST, TestSuite } from './mod.ts';
import { GoatDB } from '../db/db.ts';
import { Server } from '../net/server/server.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { sleep } from '../base/time.ts';

/**
 * Schema definition for latency test items
 * 
 * Each test item contains:
 * - message: A human-readable description of the test
 * - createdAt: High-precision timestamp (performance.now()) when item was created
 * - clientId: Identifier of the client that created the item
 */
const LatencyTestSchema = {
  ns: 'latency-test',
  version: 1,
  fields: {
    message: { type: 'string', required: true },
    createdAt: { type: 'number', required: true },    // Stores performance.now() timestamp
    clientId: { type: 'string', required: true },     // 'client-a' or 'client-b'
  },
} as const;

// TypeScript type for better type safety in test code
type LatencyTestItem = {
  message: string;
  createdAt: number;
  clientId: string;
};

/**
 * Test-specific data registry
 * 
 * Each test needs its own registry to avoid conflicts with other tests.
 * The registry must be shared between server and all clients for schema consistency.
 */
const testRegistry = new DataRegistry();
testRegistry.registerSchema(LatencyTestSchema);

/**
 * Domain configuration for test environment
 * 
 * GoatDB uses domain resolution to determine which organization a client belongs to.
 * For testing, we map all localhost connections to a single test organization.
 */
function createTestDomainConfig() {
  return {
    // Map organization IDs to their base URLs
    resolveOrg: (orgId: string) => `http://localhost/${orgId}`,
    
    // Extract organization from incoming URLs (reverse mapping)
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

/**
 * Build information required by GoatDB server
 * 
 * In production, this would contain actual version/commit info.
 * For tests, we use placeholder values.
 */
const buildInfo = {
  version: '0.0.0',
  commit: 'test',
  buildTime: new Date().toISOString(),
};

/**
 * PRIMARY TEST: Basic End-to-End Latency Measurement
 * 
 * This test implements the core requirement:
 * 1. Start server
 * 2. Connect client A 
 * 3. Connect client B
 * 4. A creates item with timestamp
 * 5. B waits for item, measures when it appears
 * 6. Calculate latency = received_time - created_time
 * 
 * The test also verifies bidirectional sync to ensure the system works symmetrically.
 */
TEST('e2e-latency', 'measure-item-sync-latency', async (ctx: TestSuite) => {
  // Use unique port to avoid conflicts with other tests running concurrently
  const testPort = 9877;
  
  // Initialize all resources as null for proper cleanup in finally block
  let server: Server<typeof LatencyTestSchema> | null = null;
  let clientA: GoatDB | null = null;
  let clientB: GoatDB | null = null;

  try {
    console.log('🚀 Starting end-to-end latency measurement test...\n');

    // ============================================================================
    // STEP 1: START THE SERVER
    // ============================================================================
    console.log('📡 Step 1: Starting GoatDB server...');
    
    // Create isolated temporary directory for server data
    const serverPath = await ctx.tempDir('latency-server');
    const domain = createTestDomainConfig();

    // Initialize server with test configuration
    server = new Server({
      path: serverPath,              // Persistent storage location
      orgId: 'test-org',            // Organization identifier for multi-tenancy
      port: testPort,               // HTTP port for client connections
      registry: testRegistry,       // Schema registry (must match clients)
      buildInfo,                    // Version/build metadata
      domain,                       // Domain resolution configuration
    });

    // Start HTTP server and wait for it to be ready
    await server.start();
    console.log(`✅ Server started successfully on port ${testPort}\n`);

    // ============================================================================
    // STEP 2: CONNECT CLIENT A (THE SENDER)
    // ============================================================================
    console.log('👤 Step 2: Connecting Client A (sender)...');
    
    // Create isolated directory for client A's local storage
    const clientAPath = await ctx.tempDir('latency-client-a');
    
    // Initialize client A with connection to our test server
    clientA = new GoatDB({
      path: clientAPath,                          // Local storage path
      orgId: 'test-org',                         // Must match server organization
      mode: 'client',                            // Client mode (not standalone)
      peers: [`http://localhost:${testPort}`],   // Server endpoints to sync with
      registry: testRegistry,                    // Schema registry (must match server)
    });

    // Wait for client to fully initialize and establish server connection
    await clientA.readyPromise();
    console.log('✅ Client A connected and ready\n');

    // ============================================================================
    // STEP 3: CONNECT CLIENT B (THE RECEIVER)
    // ============================================================================
    console.log('👥 Step 3: Connecting Client B (receiver)...');
    
    // Create isolated directory for client B's local storage
    const clientBPath = await ctx.tempDir('latency-client-b');
    
    // Initialize client B with identical configuration to client A
    clientB = new GoatDB({
      path: clientBPath,                          // Different local storage path
      orgId: 'test-org',                         // Same organization as client A
      mode: 'client',                            // Client mode (not standalone)
      peers: [`http://localhost:${testPort}`],   // Same server as client A
      registry: testRegistry,                    // Same schema registry
    });

    // Wait for client B to fully initialize and establish server connection
    await clientB.readyPromise();
    console.log('✅ Client B connected and ready\n');

    // Give both clients time to establish stable sync connections with server
    // This prevents timing issues where sync hasn't fully initialized
    console.log('⏳ Allowing sync connections to stabilize...');
    await sleep(100);

    // ============================================================================
    // STEP 4: CLIENT A CREATES ITEM (START TIMING)
    // ============================================================================
    console.log('📝 Step 4: Client A creating test item...');
    
    // Define path for test item (format: /type/repo/item)
    const itemPath = '/data/latency-test/test-item-1';
    
    // Record high-precision timestamp at moment of creation
    const creationTime = performance.now();
    
    // Create item on client A with timestamp payload
    const itemA = clientA.create(itemPath, LatencyTestSchema, {
      message: 'Hello from Client A',
      createdAt: creationTime,        // Embed creation timestamp in item data
      clientId: 'client-a',           // Identify the creating client
    });

    // Verify item was created successfully on client A
    assertExists(itemA, 'Item should be created on client A');
    assertTrue(itemA.exists, 'Item should exist on client A');
    console.log(`✅ Item created at ${creationTime.toFixed(2)}ms\n`);

    // ============================================================================
    // STEP 5: CLIENT B WAITS FOR ITEM (END TIMING)
    // ============================================================================
    console.log('👀 Step 5: Client B waiting for item to sync...');
    
    // Start polling for item existence on client B
    let itemB = clientB.item(itemPath);          // Get item reference (may not exist yet)
    let receivedTime: number | null = null;       // Will store when item appears
    const maxWaitTime = 5000;                     // 5 second timeout to prevent hanging
    const startWait = performance.now();          // Track total wait time

    // Poll until item appears on client B or timeout occurs
    while (!itemB.exists && (performance.now() - startWait) < maxWaitTime) {
      await sleep(10);                           // Check every 10ms for responsiveness
      itemB = clientB.item(itemPath);           // Refresh item reference
      
      // Record precise moment when item becomes visible
      if (itemB.exists && !receivedTime) {
        receivedTime = performance.now();
        console.log(`✅ Item received at ${receivedTime.toFixed(2)}ms\n`);
        break;
      }
    }

    // ============================================================================
    // STEP 6: VERIFY SYNC SUCCESS AND CALCULATE LATENCY
    // ============================================================================
    
    // Ensure item was actually received (didn't timeout)
    assertExists(receivedTime, 'Item should have been received by client B within timeout');
    assertTrue(itemB.exists, 'Item should exist on client B');

    // Load item data on client B to verify complete synchronization
    const itemBLoaded = clientB.item(itemPath);
    
    // Verify data integrity - all fields should match exactly
    assertEquals(itemBLoaded.get('message'), 'Hello from Client A', 'Message should match exactly');
    assertEquals(itemBLoaded.get('clientId'), 'client-a', 'Client ID should match exactly');
    assertEquals(itemBLoaded.get('createdAt'), creationTime, 'Creation timestamp should match exactly');

    // Calculate the core metric: end-to-end synchronization latency
    const latency = receivedTime - creationTime;
    
    // ============================================================================
    // RESULTS REPORTING
    // ============================================================================
    console.log(`📊 === LATENCY MEASUREMENT RESULTS ===`);
    console.log(`📅 Item creation time: ${creationTime.toFixed(2)}ms`);
    console.log(`📨 Item received time: ${receivedTime.toFixed(2)}ms`);
    console.log(`⚡ End-to-end latency: ${latency.toFixed(2)}ms`);
    console.log(`=======================================\n`);

    // Validate latency is within reasonable bounds
    assertLessThan(latency, 1000, `Latency should be under 1 second, got ${latency.toFixed(2)}ms`);
    assertTrue(latency > 0, `Latency should be positive, got ${latency.toFixed(2)}ms`);

    // ============================================================================
    // BIDIRECTIONAL VERIFICATION
    // ============================================================================
    console.log('🔄 Additional Test: Verifying bidirectional sync...');
    
    const itemPath2 = '/data/latency-test/test-item-2';
    const creationTime2 = performance.now();
    
    // Now client B creates an item (reverse direction)
    const itemB2 = clientB.create(itemPath2, LatencyTestSchema, {
      message: 'Hello from Client B',
      createdAt: creationTime2,
      clientId: 'client-b',
    });

    // Client A waits for it (same polling pattern)
    let itemA2 = clientA.item(itemPath2);
    let receivedTime2: number | null = null;
    const startWait2 = performance.now();

    while (!itemA2.exists && (performance.now() - startWait2) < maxWaitTime) {
      await sleep(10);
      itemA2 = clientA.item(itemPath2);
      
      if (itemA2.exists && !receivedTime2) {
        receivedTime2 = performance.now();
        break;
      }
    }

    // Verify bidirectional sync also works
    assertExists(receivedTime2, 'Item 2 should have been received by client A');
    const latency2 = receivedTime2 - creationTime2;
    console.log(`✅ Bidirectional latency: ${latency2.toFixed(2)}ms`);
    console.log('🎉 End-to-end latency test completed successfully!\n');

  } finally {
    // ============================================================================
    // CLEANUP: ENSURE ALL RESOURCES ARE PROPERLY RELEASED
    // ============================================================================
    console.log('🧹 Cleaning up test resources...');
    
    // Flush and close client A
    if (clientA) {
      await clientA.flushAll();
    }
    
    // Flush and close client B  
    if (clientB) {
      await clientB.flushAll();
    }
    
    // Shut down server
    if (server && server['_abortController']) {
      server['_abortController'].abort();
      // Brief delay to allow clean server shutdown
      await sleep(100);
    }
    
    console.log('✅ Cleanup completed\n');
  }
});

/**
 * SECONDARY TEST: Latency Under Load
 * 
 * This test measures how GoatDB's sync performance scales under load by:
 * 1. Creating multiple items in rapid succession
 * 2. Measuring latency for each item individually  
 * 3. Computing statistical metrics (avg, min, max, success rate)
 * 4. Verifying system stability under concurrent load
 * 
 * This helps identify performance degradation patterns and bottlenecks.
 */
TEST('e2e-latency', 'measure-latency-under-load', async (ctx: TestSuite) => {
  // Use different port to avoid conflicts with the primary test
  const testPort = 9878;
  
  // Initialize resources for cleanup
  let server: Server<typeof LatencyTestSchema> | null = null;
  let clientA: GoatDB | null = null;
  let clientB: GoatDB | null = null;

  try {
    console.log('🔥 Starting latency-under-load test...\n');

    // ============================================================================
    // SETUP: IDENTICAL TO PRIMARY TEST BUT WITH DIFFERENT PORT
    // ============================================================================
    console.log('📡 Setting up server and clients for load test...');
    
    // Server setup
    const serverPath = await ctx.tempDir('latency-load-server');
    const domain = createTestDomainConfig();

    server = new Server({
      path: serverPath,
      orgId: 'test-org',
      port: testPort,
      registry: testRegistry,
      buildInfo,
      domain,
    });

    await server.start();
    console.log(`✅ Load test server started on port ${testPort}`);

    // Client A setup
    const clientAPath = await ctx.tempDir('latency-load-client-a');
    clientA = new GoatDB({
      path: clientAPath,
      orgId: 'test-org',
      mode: 'client',
      peers: [`http://localhost:${testPort}`],
      registry: testRegistry,
    });
    await clientA.readyPromise();
    console.log('✅ Load test Client A ready');

    // Client B setup  
    const clientBPath = await ctx.tempDir('latency-load-client-b');
    clientB = new GoatDB({
      path: clientBPath,
      orgId: 'test-org',
      mode: 'client',
      peers: [`http://localhost:${testPort}`],
      registry: testRegistry,
    });
    await clientB.readyPromise();
    console.log('✅ Load test Client B ready\n');

    // Allow sync connections to stabilize
    await sleep(100);

    // ============================================================================
    // LOAD TESTING: CREATE MULTIPLE ITEMS AND MEASURE EACH
    // ============================================================================
    
    // Configuration for load test
    const numItems = 10;                    // Number of items to create
    const latencies: number[] = [];         // Store successful latency measurements
    const maxWaitTime = 2000;               // 2 second timeout per item (shorter than primary test)
    const itemDelay = 50;                   // Delay between item creations to prevent overwhelming
    
    console.log(`📈 Creating ${numItems} items rapidly to measure latency distribution...\n`);
    
    // Create items in sequence and measure each one's sync latency
    for (let i = 0; i < numItems; i++) {
      // Generate unique path for this test item
      const itemPath = `/data/latency-test/load-item-${i}`;
      
      // Record creation timestamp
      const creationTime = performance.now();
      
      // Client A creates the item
      const createdItem = clientA.create(itemPath, LatencyTestSchema, {
        message: `Load test item ${i}`,      // Include index for debugging
        createdAt: creationTime,
        clientId: 'client-a',
      });

      // Client B polls for the item (same pattern as primary test but faster)
      let itemB = clientB.item(itemPath);
      const startWait = performance.now();

      // Poll every 5ms (faster than primary test for better responsiveness)
      while (!itemB.exists && (performance.now() - startWait) < maxWaitTime) {
        await sleep(5);
        itemB = clientB.item(itemPath);
      }

      // Record result for this item
      if (itemB.exists) {
        const receivedTime = performance.now();
        const latency = receivedTime - creationTime;
        latencies.push(latency);
        console.log(`📦 Item ${i.toString().padStart(2)}: ${latency.toFixed(2)}ms`);
      } else {
        // Item didn't sync within timeout - this indicates system stress
        console.log(`❌ Item ${i.toString().padStart(2)}: TIMEOUT (>${maxWaitTime}ms)`);
      }

      // Brief pause between items to avoid overwhelming the system
      // This simulates realistic usage patterns rather than a stress test
      await sleep(itemDelay);
    }

    // ============================================================================
    // STATISTICAL ANALYSIS OF RESULTS
    // ============================================================================
    
    // Calculate key performance metrics
    const totalItems = numItems;
    const successfulItems = latencies.length;
    const failedItems = totalItems - successfulItems;
    
    // Only calculate statistics if we have successful measurements
    let avgLatency = 0;
    let minLatency = 0;
    let maxLatency = 0;
    let successRate = 0;
    
    if (latencies.length > 0) {
      avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      minLatency = Math.min(...latencies);
      maxLatency = Math.max(...latencies);
      successRate = (successfulItems / totalItems) * 100;
    }
    
    // ============================================================================
    // RESULTS REPORTING
    // ============================================================================
    console.log(`\n📊 === LOAD TEST RESULTS ===`);
    console.log(`📤 Total items created: ${totalItems}`);
    console.log(`✅ Items successfully synced: ${successfulItems}`);
    console.log(`❌ Items that timed out: ${failedItems}`);
    console.log(`📈 Success rate: ${successRate.toFixed(1)}%`);
    console.log(`⚡ Average latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`🚀 Best (min) latency: ${minLatency.toFixed(2)}ms`);
    console.log(`🐌 Worst (max) latency: ${maxLatency.toFixed(2)}ms`);
    console.log(`🎯 Latency spread: ${(maxLatency - minLatency).toFixed(2)}ms`);
    console.log(`============================\n`);

    // ============================================================================
    // PERFORMANCE ASSERTIONS
    // ============================================================================
    
    // Ensure the system handled the load reasonably well
    assertTrue(latencies.length > 0, 'At least some items should sync successfully under load');
    
    // Average latency should remain reasonable even under load
    if (latencies.length > 0) {
      assertLessThan(avgLatency, 2000, `Average latency under load should be reasonable, got ${avgLatency.toFixed(2)}ms`);
    }
    
    // Success rate should be high (at least 70% for a functioning system)
    assertTrue(successRate >= 70, `Success rate should be high under normal load, got ${successRate.toFixed(1)}%`);
    
    console.log('🎉 Load test completed successfully!\n');

  } finally {
    // ============================================================================
    // CLEANUP: SAME AS PRIMARY TEST
    // ============================================================================
    console.log('🧹 Cleaning up load test resources...');
    
    if (clientA) await clientA.flushAll();
    if (clientB) await clientB.flushAll();
    if (server && server['_abortController']) {
      server['_abortController'].abort();
      await sleep(100);
    }
    
    console.log('✅ Load test cleanup completed\n');
  }
});