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
import { registerAllTests } from './test-registry.ts';
import { exit } from '../base/process.ts';
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
  // Register all tests (order optimized for fast feedback in test-registry.ts)
  await registerAllTests();

  // Get test configuration from environment
  const suiteName = getEnvVar('GOATDB_SUITE');
  const testName = getEnvVar('GOATDB_TEST');

  // Run the tests
  const summary: TestSummary = await TestsRunner.default.run(
    suiteName,
    testName,
  );
  
  // Print summary
  TestsRunner.printSummary(summary);
  
  // Exit with code 1 if any tests failed, 0 if all passed
  const exitCode = summary.failed > 0 ? 1 : 0;
  await exit(exitCode);
}

assert(
  !isBrowser(),
  'Tests entry point should only be used in server environment',
);

main();
