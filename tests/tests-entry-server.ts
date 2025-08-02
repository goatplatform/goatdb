/**
 * Main entry point for running all tests in the server environment
 * (Deno or Node.js).
 *
 * This module is loaded as the entry point when executing tests in a
 * server-side environment, such as via `deno run` or Node.js (after bundling).
 * It is responsible for:
 *
 * - Registering all server-compatible test suites by calling their setup
 *   functions.
 * - Reading test configuration (such as suite and test selection) from
 *   environment variables.
 * - Running the specified tests using the default test runner.
 * - Exiting the process with an appropriate exit code based on test results.
 *
 * To add new server-side tests, import and call their setup functions in this
 * file.
 *
 * This entry point is not intended for browser-based test execution; for
 * browser tests, see `tests-entry-browser.ts`.
 */

import { TestsRunner, type TestSummary } from './mod.ts';
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
import { getEnvVar } from '../base/os.ts';
import { isBrowser } from '../base/common.ts';
import { assert } from '../base/error.ts';

/**
 * Main entry point for running tests in the server environment.
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
  // Test execution order optimized for developer feedback speed:
  // Run fast tests first so developers get immediate pass/fail results,
  // then progressively run slower tests. This follows the test pyramid principle.

  // FAST UNIT TESTS (0-1ms each) - Pure logic, no I/O
  setupOrderstamp(); // Utility functions for distributed timestamps
  setupItemPath(); // Path validation and parsing logic
  setupHealthCheckEndpointTest(); // Simple HTTP endpoint check

  // COMPONENT TESTS (0-50ms each) - Single components with minimal dependencies
  setupCommit(); // Core commit/versioning logic
  setupSession(); // Authentication and session management
  setupGoatRequestTest(); // HTTP request processing

  // INTEGRATION TESTS (100-500ms each) - Multiple components, file I/O
  setupTrusted(); // Database operations in trusted mode
  setupUntrusted(); // Database operations in untrusted mode
  await setupServerArchitectureTest(); // Server initialization and configuration
  setupStaticAssetsEndpointTest(); // File serving and asset management

  // SYNC INTEGRATION TESTS (1-2s each) - Network operations, client-server
  setupMinimalSync(); // Basic client-server synchronization

  // HEAVY END-TO-END TESTS (10-30s each) - Full system, network latency, multi-node
  setupE2ELatency(); // Client-to-client sync latency measurement
  setupClusterLatency(); // Multi-server cluster sync performance

  // Get test configuration from environment
  const suiteName = getEnvVar('GOATDB_SUITE');
  const testName = getEnvVar('GOATDB_TEST');

  // Run the tests
  const summary: TestSummary = await TestsRunner.default.run(
    suiteName,
    testName,
  );
  // Exit with code 1 if any tests failed, 0 if all passed
  const exitCode = summary.failed > 0 ? 1 : 0;
  await exit(exitCode);
}

assert(
  !isBrowser(),
  'Tests entry point should only be used in server environment',
);

main();
