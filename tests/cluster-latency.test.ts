import { assertExists, assertTrue } from './asserts.ts';
import { TEST, TestSuite } from './mod.ts';
import { GoatDB } from '../db/db.ts';
import { Server } from '../net/server/server.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { sleep } from '../base/time.ts';
import { generateSession, encodeSession } from '../db/session.ts';
import { prettyJSON } from '../base/common.ts';
import * as path from '@std/path';
import { FileImplGet, writeTextFile } from '../base/json-log/file-impl.ts';
import { generateBuildInfo } from '../server/build-info.ts';

// Schema definition for cluster latency test items
const ClusterLatencyTestSchema = {
  ns: 'cluster-latency-test',
  version: 1,
  fields: {
    message: { type: 'string', required: true },
    createdAt: { type: 'number', required: true },    // performance.now() timestamp
    clientId: { type: 'string', required: true },     // 'server-0', 'server-1', 'server-2'
  },
} as const;

// Test-specific data registry
const testRegistry = new DataRegistry();
testRegistry.registerSchema(ClusterLatencyTestSchema);

// Domain configuration for test environment
function createTestDomainConfig() {
  return {
    resolveOrg: (orgId: string) => `http://localhost/${orgId}`,
    resolveDomain: (url: string) => {
      try {
        const u = new URL(url);
        return u.hostname === 'localhost' ? 'cluster-test' : '';
      } catch {
        return '';
      }
    },
  };
}

// Helper function to get build info dynamically
async function getTestBuildInfo() {
  const fileImpl = await FileImplGet();
  const cwd = fileImpl.getCWD();
  const denoJsonPath = path.join(cwd, 'deno.json');
  
  return await generateBuildInfo(denoJsonPath);
}

// Helper function to wait for an item to appear in a server's database
async function waitForItemInServer(
  db: GoatDB, 
  itemPath: string, 
  creationTime: number,
  serverName: string
): Promise<{ latency: number | null; error?: string }> {
  const maxWait = 3000;  // 3 seconds timeout
  const pollInterval = 10;  // 10ms polling
  const startWait = performance.now();
  
  while (performance.now() - startWait < maxWait) {
    try {
      const item = db.item(itemPath);
      if (item.exists) {
        const receivedTime = performance.now();
        // Verify the item data matches
        if (item.get('createdAt') === creationTime) {
          return { latency: receivedTime - creationTime };
        } else {
          return { 
            latency: null, 
            error: `Item exists but createdAt mismatch: expected ${creationTime}, got ${item.get('createdAt')}` 
          };
        }
      }
    } catch (e) {
      return { latency: null, error: `Error accessing item: ${e instanceof Error ? e.message : String(e)}` };
    }
    await sleep(pollInterval);
  }
  
  // On timeout, provide general debug info
  const elapsed = performance.now() - startWait;
  return { 
    latency: null, 
    error: `Timeout after ${elapsed.toFixed(0)}ms. Item not found on ${serverName}` 
  };
}

// Display comprehensive cluster statistics
function displayClusterStats(
  latencies: number[][][], 
  consensusTimes: number[][],
  numServers: number,
  numRounds: number
) {
  console.log('\n📊 === CLUSTER SYNC LATENCY RESULTS ===');
  
  // Collect all successful latencies
  const allLatencies: number[] = [];
  for (let from = 0; from < numServers; from++) {
    for (let to = 0; to < numServers; to++) {
      if (from !== to) {
        allLatencies.push(...latencies[from][to]);
      }
    }
  }
  
  if (allLatencies.length === 0) {
    console.log('❌ No successful sync operations recorded!');
    return;
  }
  
  // Calculate overall statistics
  const avg = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
  const min = Math.min(...allLatencies);
  const max = Math.max(...allLatencies);
  const sorted = allLatencies.sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  
  console.log(`\n📈 Overall Statistics (${allLatencies.length} measurements):`);
  console.log(`   Average: ${avg.toFixed(2)}ms`);
  console.log(`   Median: ${median.toFixed(2)}ms`);
  console.log(`   Min: ${min.toFixed(2)}ms`);
  console.log(`   Max: ${max.toFixed(2)}ms`);
  console.log(`   Success Rate: ${(allLatencies.length / (numServers * (numServers - 1) * numRounds) * 100).toFixed(1)}%`);
  
  // Per-path statistics
  console.log(`\n📍 Per-Path Breakdown:`);
  for (let from = 0; from < numServers; from++) {
    for (let to = 0; to < numServers; to++) {
      if (from === to || latencies[from][to].length === 0) continue;
      
      const pathLatencies = latencies[from][to];
      const pathAvg = pathLatencies.reduce((a, b) => a + b, 0) / pathLatencies.length;
      const pathMin = Math.min(...pathLatencies);
      const pathMax = Math.max(...pathLatencies);
      
      console.log(`   Server ${from} → Server ${to}:`);
      console.log(`      Avg: ${pathAvg.toFixed(2)}ms, Min: ${pathMin.toFixed(2)}ms, Max: ${pathMax.toFixed(2)}ms`);
      console.log(`      Success: ${pathLatencies.length}/${numRounds} (${(pathLatencies.length/numRounds*100).toFixed(0)}%)`);
    }
  }
  
  // Consensus time statistics
  const allConsensusTimes: number[] = [];
  for (let server = 0; server < numServers; server++) {
    allConsensusTimes.push(...consensusTimes[server]);
  }
  
  if (allConsensusTimes.length > 0) {
    const avgConsensus = allConsensusTimes.reduce((a, b) => a + b, 0) / allConsensusTimes.length;
    const minConsensus = Math.min(...allConsensusTimes);
    const maxConsensus = Math.max(...allConsensusTimes);
    const sortedConsensus = allConsensusTimes.sort((a, b) => a - b);
    const medianConsensus = sortedConsensus[Math.floor(sortedConsensus.length / 2)];
    
    console.log(`\n🤝 Consensus Time Statistics (${allConsensusTimes.length} measurements):`);
    console.log(`   Average: ${avgConsensus.toFixed(2)}ms`);
    console.log(`   Median: ${medianConsensus.toFixed(2)}ms`);
    console.log(`   Min: ${minConsensus.toFixed(2)}ms`);
    console.log(`   Max: ${maxConsensus.toFixed(2)}ms`);
    console.log(`   Success Rate: ${(allConsensusTimes.length / (numServers * numRounds) * 100).toFixed(1)}%`);
    console.log(`   Note: Time until ALL servers have received the new value`);
  }
  
  console.log(`\n🏗️  Architecture Notes:`);
  console.log(`   - Latency includes network RTT + sync scheduling delays`);
  console.log(`   - GoatDB uses polling-based sync with exponential backoff`);
  console.log(`   - Consensus time = when entire cluster has the same data`);
  console.log(`======================================\n`);
}

/**
 * Cluster Latency Test for GoatDB
 * 
 * This test measures server-to-server sync latency in a 3-node cluster:
 * - Creates 3 independent GoatDB servers with unique ports
 * - Each server has the other two configured as peers for automatic sync
 * - Measures how long it takes for data to propagate between servers
 * - Reports comprehensive latency statistics for all sync paths
 */
export default function setupClusterLatency() {
  // Main cluster latency test
  TEST('cluster-latency', 'measure-cluster-sync-latency', async (ctx: TestSuite) => {
  const NUM_SERVERS = 3;
  const NUM_ROUNDS = 10;
  const ORG_ID = 'cluster-test';
  
  // Arrays to hold server instances
  const servers: Server<any>[] = [];
  const serverUrls: string[] = [];
  
  // Get build info for all servers
  const buildInfo = await getTestBuildInfo();
  console.log(`🏗️ Using build info: ${buildInfo.builder.runtime} ${buildInfo.createdBy}`);
  
  // Latency measurements: latencies[fromServer][toServer] = number[]
  const latencies: number[][][] = Array(NUM_SERVERS).fill(null)
    .map(() => Array(NUM_SERVERS).fill(null).map(() => []));
  
  // Consensus time measurements: consensusTimes[fromServer] = number[]
  const consensusTimes: number[][] = Array(NUM_SERVERS).fill(null)
    .map(() => []);

  try {
    console.log('🚀 Starting cluster sync latency test...\n');

    // Step 0: Create shared root session for the cluster
    console.log('🔑 Step 0: Creating shared cluster root session...');
    
    // All servers in a cluster must share the same root session for authentication.
    // We pre-create this session and write it to each server's settings file.
    const sharedRootSession = await generateSession('root', 365 * 24 * 60 * 60 * 1000);
    const encodedSettings = {
      currentSession: await encodeSession(sharedRootSession),
      roots: [await encodeSession(sharedRootSession)],
      trustedSessions: [],  // User sessions are loaded from /sys/sessions
    };
    console.log(`✅ Generated cluster root session: ${sharedRootSession.id}`);

    // Step 1: Start all servers with dynamic ports
    console.log('\n📡 Step 1: Starting cluster servers with dynamic ports...');
    
    // First pass: Start all servers with port 0 to get dynamic ports
    const tempServers: Server<any>[] = [];
    const tempPorts: number[] = [];
    
    for (let i = 0; i < NUM_SERVERS; i++) {
      const serverPath = await ctx.tempDir(`cluster-server-${i}`);
      
      // Write the shared root session to this server's settings file
      const settingsPath = path.join(serverPath, ORG_ID, 'settings.json');
      const fileImpl = await FileImplGet();
      await fileImpl.mkdir(path.dirname(settingsPath));
      await writeTextFile(settingsPath, prettyJSON(encodedSettings));
      
      // Start temporary server to get port allocation
      const tempServer = new Server({
        path: serverPath,
        orgId: ORG_ID,
        port: 0,  // Dynamic port allocation
        peers: [],
        registry: testRegistry,
        buildInfo,
        domain: createTestDomainConfig(),
        mode: 'server',
      });
      
      await tempServer.start();
      const port = tempServer.port;
      if (!port) {
        throw new Error(`Server ${i} failed to allocate port`);
      }
      
      tempPorts.push(port);
      tempServers.push(tempServer);
      serverUrls.push(`http://localhost:${port}`);
      console.log(`✅ Server ${i} allocated port ${port}`);
    }
    
    // Stop temporary servers
    console.log('\n🔄 Restarting servers with peer configuration...');
    for (const server of tempServers) {
      await server.stop();
    }
    await sleep(100); // Brief pause to ensure ports are released
    
    // Second pass: Start servers with known ports and peer configuration
    for (let i = 0; i < NUM_SERVERS; i++) {
      const serverPath = await ctx.tempDir(`cluster-server-${i}`);
      const peerUrls = serverUrls.filter((_, idx) => idx !== i);
      
      // Re-write the shared root session to this server's settings file
      const settingsPath = path.join(serverPath, ORG_ID, 'settings.json');
      const fileImpl = await FileImplGet();
      await fileImpl.mkdir(path.dirname(settingsPath));
      await writeTextFile(settingsPath, prettyJSON(encodedSettings));
      
      const server = new Server({
        path: serverPath,
        orgId: ORG_ID,
        port: tempPorts[i],  // Use the allocated port
        peers: peerUrls,     // Configure peers for server-to-server sync
        registry: testRegistry,
        buildInfo,
        domain: createTestDomainConfig(),
        mode: 'server',
      });
      
      await server.start();
      servers.push(server);
      console.log(`✅ Server ${i} started on port ${tempPorts[i]} with peers: ${peerUrls.join(', ')}`);
    }
    
    // Step 2: Wait for servers to establish sync connections
    console.log('\n⏳ Step 2: Allowing servers to establish sync connections...');
    
    // Wait for all server databases to be ready
    for (let i = 0; i < NUM_SERVERS; i++) {
      const services = await servers[i].servicesForOrganization(ORG_ID);
      await services.db.readyPromise();
      console.log(`✅ Server ${i} database ready`);
    }
    
    // Allow time for peer connections to establish
    await sleep(500);
    console.log('✅ All servers ready for testing\n');

    // Step 3: Run test rounds
    console.log(`📝 Step 3: Running ${NUM_ROUNDS} test rounds...\n`);
    
    for (let round = 0; round < NUM_ROUNDS; round++) {
      console.log(`🔄 Round ${round + 1}/${NUM_ROUNDS}`);
      
      for (let sourceServer = 0; sourceServer < NUM_SERVERS; sourceServer++) {
        const itemPath = `/data/cluster-test/round-${round}-from-${sourceServer}`;
        const creationTime = performance.now();
        
        // Create item directly on the source server's DB
        const sourceServices = await servers[sourceServer].servicesForOrganization(ORG_ID);
        
        const item = sourceServices.db.create(itemPath, ClusterLatencyTestSchema, {
          message: `Round ${round} from server ${sourceServer}`,
          createdAt: creationTime,
          clientId: `server-${sourceServer}`,
        });
        
        // Verify item was created
        assertExists(item, `Item should be created on server ${sourceServer}`);
        assertTrue(item.exists, `Item should exist on server ${sourceServer}`);
        
        console.log(`📝 Server ${sourceServer} created item at ${creationTime.toFixed(2)}ms`);

        // Measure how long it takes for other servers to receive the item
        const receivePromises = [];
        const receiptTimes: number[] = [];
        let allReceived = true;
        
        for (let targetServer = 0; targetServer < NUM_SERVERS; targetServer++) {
          if (targetServer === sourceServer) continue;
          
          const targetServices = await servers[targetServer].servicesForOrganization(ORG_ID);
          
          receivePromises.push(
            waitForItemInServer(targetServices.db, itemPath, creationTime, `server-${targetServer}`)
              .then(result => {
                if (result.latency !== null) {
                  latencies[sourceServer][targetServer].push(result.latency);
                  receiptTimes.push(creationTime + result.latency);
                  console.log(`  ✅ Server ${targetServer} received item: ${result.latency.toFixed(2)}ms`);
                  return true;
                } else {
                  console.log(`  ❌ Server ${targetServer}: ${result.error}`);
                  allReceived = false;
                  return false;
                }
              })
          );
        }
        
        const results = await Promise.all(receivePromises);
        
        // Calculate consensus time if all servers received the item
        if (allReceived && receiptTimes.length === NUM_SERVERS - 1) {
          const lastReceiptTime = Math.max(...receiptTimes);
          const consensusTime = lastReceiptTime - creationTime;
          consensusTimes[sourceServer].push(consensusTime);
          console.log(`  🤝 Consensus reached: ${consensusTime.toFixed(2)}ms`);
        }
        
        // Brief pause between source servers
        await sleep(100);
      }
      
      console.log(); // Empty line between rounds
    }

    // Step 4: Display statistics
    displayClusterStats(latencies, consensusTimes, NUM_SERVERS, NUM_ROUNDS);
    
    // Validate that we got some successful syncs
    let totalSuccessful = 0;
    for (let from = 0; from < NUM_SERVERS; from++) {
      for (let to = 0; to < NUM_SERVERS; to++) {
        if (from !== to) {
          totalSuccessful += latencies[from][to].length;
        }
      }
    }
    
    assertTrue(totalSuccessful > 0, 'At least some server-to-server syncs should succeed');
    console.log('🎉 Cluster latency test completed successfully!\n');
    
  } catch (error) {
    console.error('\n❌ Error during cluster test:', error);
    throw error;
    
  } finally {
    // Cleanup: Ensure all servers are properly shut down
    console.log('🧹 Cleaning up cluster resources...');
    
    // Stop all servers using the public API
    for (let i = 0; i < servers.length; i++) {
      if (servers[i]) {
        await servers[i].stop();
        console.log(`✅ Server ${i} stopped`);
      }
    }
    
    // Allow time for clean shutdown
    await sleep(100);
    
    console.log('✅ Cluster cleanup completed\n');
  }
  });
}