/**
 * Entry point for running tests in the server environment (Deno or Node.js).
 * For browser tests, see `tests-entry-browser.ts`.
 */

import { EXIT_CODE_NO_MATCH, NoMatchError } from '../base/test-runner-error.ts';
import { TestsRunner, type TestSummary } from './mod.ts';
import { registerAllTests } from './test-registry.ts';
import { exit } from '../base/process.ts';
import { getEnvVar } from '../base/os.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { assert } from '../base/error.ts';

async function main(): Promise<void> {
  // Register all tests (order optimized for fast feedback in test-registry.ts)
  await registerAllTests();

  // Get test configuration from environment
  const suiteName = getEnvVar('GOATDB_SUITE');
  const testName = getEnvVar('GOATDB_TEST');

  // Run the tests
  let summary: TestSummary;
  try {
    summary = await TestsRunner.default.run(
      suiteName,
      testName,
    );
  } catch (error) {
    if (error instanceof NoMatchError) {
      console.error(error.message);
      exit(EXIT_CODE_NO_MATCH);
      return;
    }
    throw error;
  }

  // Print summary
  TestsRunner.printSummary(summary);

  // Exit with code 1 if any tests failed, 0 if all passed
  const exitCode = summary.failed > 0 ? 1 : 0;
  exit(exitCode);
}

assert(
  getRuntime().id !== 'browser',
  'Tests entry point should only be used in server environment',
);

main();
