import { isBrowser, isDeno, isNode } from '../base/common.ts';
import { TestsRunner } from './mod.ts';
import setupUntrusted from './db-untrusted.test.ts';
import setupTrusted from './db-trusted.test.ts';
import setupItemPath from './item-path.ts';
import setupOrderstamp from './orderstamp-expose.test.ts';
import setupGoatRequestTest from './goat-request.test.ts';
import setupSession from './session.test.ts';
import setupCommit from './commit.test.ts';
import setupServerArchitectureTest from './server-architecture.test.ts';
import { exit } from '../base/process.ts';
import setupStaticAssetsEndpointTest from './static-assets-endpoint.test.ts';
import setupHealthCheckEndpointTest from './health-check-endpoint.test.ts';
import setupMinimalSync from './minimal-client-server-sync.test.ts';
import setupE2ELatency from './e2e-latency.test.ts';
import setupClusterLatency from './cluster-latency.test.ts';

// Minimal interface for globalThis with process.env
interface GlobalWithProcessEnv {
  process?: {
    env?: Record<string, string | undefined>;
  };
}

// Cross-platform env getter
function getEnvVar(key: string): string | undefined {
  if (isDeno()) {
    // deno-lint-ignore no-explicit-any
    return (Deno.env as any)?.get?.(key);
  } else if (isNode()) {
    const g = globalThis as unknown as GlobalWithProcessEnv;
    return g.process?.env?.[key];
  }
  return undefined;
}

/**
 * Main entry point for running tests.
 *
 * This function:
 * 1. Sets up all test suites by calling their setup functions
 * 2. Reads test configuration from environment variables
 * 3. Runs the specified tests using the default test runner
 * 4. Exits the process with code 0 if not running in a browser
 *
 * To register new tests:
 * 1. Create a new test file (e.g. my-feature.test.ts)
 * 2. Import the TEST function from './mod.ts'
 * 3. Define test cases using TEST(suiteName, testName, testFunction)
 * 4. Create a setup function that registers all tests
 * 5. Import and call the setup function here in main()
 *
 * Example test registration:
 * ```ts
 * import { TEST } from './mod.ts';
 *
 * export default function setupMyFeatureTests() {
 *   TEST('MyFeature', 'should do something', async (ctx) => {
 *     // Test implementation
 *   });
 * }
 * ```
 */
async function main(): Promise<void> {
  // Set up all test suites
  setupUntrusted();
  setupTrusted();
  setupItemPath();
  setupOrderstamp();
  setupGoatRequestTest();
  setupSession();
  setupCommit();
  await setupServerArchitectureTest();
  setupStaticAssetsEndpointTest();
  setupHealthCheckEndpointTest();
  setupMinimalSync();
  setupE2ELatency();
  setupClusterLatency();

  // Get test configuration from environment
  const suiteName = getEnvVar('GOATDB_SUITE');
  const testName = getEnvVar('GOATDB_TEST');

  // Run the tests
  await TestsRunner.default.run(suiteName, testName);

  // Exit if not in browser environment
  if (!isBrowser()) {
    await exit(0);
  }
}

main();
