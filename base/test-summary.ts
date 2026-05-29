/**
 * Shared types and utilities for test result summaries.
 *
 * Extracted from the test framework so that orchestrator code in base/
 * can use them without a reverse dependency on tests/.
 */

/**
 * Result of a single test execution.
 */
export interface TestResult {
  readonly suiteName: string;
  readonly testName: string;
  readonly passed: boolean;
  readonly duration: number;
  readonly error?: Error;
}

/**
 * Summary of all test execution results.
 */
export interface TestSummary {
  readonly totalTests: number;
  readonly passed: number;
  readonly failed: number;
  readonly duration: number;
  readonly results: TestResult[];
}

/**
 * Prints a summary of test results to the console.
 * No-op when no tests ran (totalTests === 0).
 */
export function printSummary(summary: TestSummary): void {
  if (summary.totalTests === 0) return;

  console.log();
  console.log('=== Test Summary ===');
  console.log(`Total: ${summary.totalTests} tests`);
  console.log(`Passed: ${summary.passed}`);
  if (summary.failed > 0) {
    console.log(`Failed: ${summary.failed}`);
    console.log();
    console.log('Failed tests:');
    const failures = summary.results.filter((r) => !r.passed);
    for (let i = 0; i < failures.length; i++) {
      const result = failures[i];
      console.log(
        `${i + 1}. ${result.suiteName}/${result.testName} (${
          Math.round(result.duration)
        }ms)`,
      );
      if (result.error) {
        console.log(`   ${result.error.name}: ${result.error.message}`);
        if (result.error.stack) {
          const stackLines = result.error.stack.split('\n').slice(1);
          for (const line of stackLines) {
            console.log(`   ${line}`);
          }
        }
        console.log();
      }
    }
  }
  console.log(`Duration: ${(summary.duration / 1000).toFixed(2)}s`);
  console.log();
}
