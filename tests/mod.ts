/**
 * A simple test runner framework specifically for GoatDB's needs.
 *
 * This module provides a lightweight testing framework that runs all tests
 * in the same process. It's designed to be compatible with all environments
 * that GoatDB supports, including browsers and Deno.
 *
 * Features:
 * - Organizes tests into suites
 * - Provides test context with utilities like temporary directories
 * - Simple API for defining and running tests
 * - Automatic cleanup of temporary resources
 * - Extremely fast execution since all tests run in the same process
 *
 * Unlike more complex test frameworks, this runner executes tests sequentially
 * in the same process, making it easier to debug and ensuring consistent
 * state between tests while maintaining high performance.
 */
import * as path from '@std/path';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import { isBrowser } from '../base/common.ts';
import { GoatDB } from '../db/db.ts';
import type { DBInstanceConfig } from '../db/db.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { ProgressBar } from '../shared/progress.ts';
import { Emitter } from '../base/emitter.ts';

/**
 * A test function that takes a TestSuite context and returns either void or a
 * Promise<void>. This function type is used to define individual test cases
 * within a test suite. The test succeeds if it returns successfully and fails
 * on any uncaught errors.
 *
 * @param ctx - The TestSuite instance providing test utilities and context
 * @returns void or Promise<void> - The test function can be synchronous or
 * asynchronous
 */
export type TestFunc = (ctx: TestSuite) => Promise<void> | void;

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
 * Represents a collection of related test cases that can be run together.
 * Each test suite has a name and maintains a map of test functions.
 * The suite manages a temporary directory that is:
 * - Created on demand when tests need temporary storage
 * - Automatically cleaned up after all tests in the suite complete
 * - Shared across all tests in the suite for consistent resource management
 * This temporary directory system allows tests to safely create and manipulate
 * files without worrying about cleanup or conflicts with other tests.
 */
export class TestSuite {
  private readonly _tests: Map<string, TestFunc>;
  private _tempDir: string | undefined;

  /**
   * Creates a new test suite with the given name.
   * @param name - The name of the test suite
   */
  constructor(readonly name: string) {
    this._tests = new Map();
  }

  /**
   * Adds a test case to the suite.
   * @param name - The name of the test case
   * @param test - The test function to execute
   */
  add(name: string, test: TestFunc) {
    this._tests.set(name, test);
  }

  /**
   * Runs all test cases in the suite sequentially.
   * Logs the results and timing for each test.
   * Cleans up temporary directory after all tests complete.
   * @returns Array of test results
   */
  async run(): Promise<TestResult[]> {
    console.log(`Running suite: ${this.name}`);
    const results: TestResult[] = [];

    for (const [name, test] of this._tests.entries()) {
      const start = performance.now();
      try {
        await test(this);
        results.push({
          suiteName: this.name,
          testName: name,
          passed: true,
          duration: performance.now() - start,
        });
      } catch (error) {
        formatError(error);
        results.push({
          suiteName: this.name,
          testName: name,
          passed: false,
          duration: performance.now() - start,
          error: error instanceof Error
            ? error
            : new Error(error ? String(error) : 'Unknown error'),
        });
      }
    }

    if (this._tempDir) {
      await (await FileImplGet()).remove(this._tempDir);
    }

    return results;
  }

  /**
   * Gets the path to a temporary directory for the test suite.
   * Creates the directory if it doesn't exist.
   * @param subPath - Optional subpath to append to the temp directory
   * @returns The full path to the temporary directory or subdirectory
   */
  async tempDir(subPath?: string): Promise<string> {
    if (!this._tempDir) {
      const fileImpl = await FileImplGet();
      const systemTempDir = await fileImpl.getTempDir();
      this._tempDir = path.join(systemTempDir, 'test-' + this.name);
    }
    const finalPath = subPath
      ? path.join(this._tempDir, subPath)
      : this._tempDir;

    // Ensure the directory exists
    const fileImpl = await FileImplGet();
    await fileImpl.mkdir(finalPath);

    return finalPath;
  }

  /**
   * Creates a GoatDB instance configured for the current test environment.
   *
   * - Server environments (Deno/Node): Standalone database with file system paths
   * - Browser environment: Client database connected to debug server using OPFS paths
   *
   * @param testId - Unique identifier for this test database within the suite
   * @param config - Additional configuration to merge with environment defaults
   * @returns Configured GoatDB instance ready for testing
   */
  async createDB<S extends Schema = Schema>(
    testId: string,
    config: Partial<DBInstanceConfig> = {},
  ): Promise<GoatDB<S>> {
    // Use same tempDir mechanism for both environments (file system + OPFS abstraction)
    const tempPath = await this.tempDir(testId);

    if (isBrowser()) {
      // Browser: Client mode with server connection using OPFS path for isolation
      return new GoatDB<S>({
        path: tempPath, // OPFS path from FileImpl abstraction
        peers: 'https://localhost:8080', // Connect to debug server
        ...config, // User overrides
      });
    } else {
      // Server: Standalone mode with file system path
      return new GoatDB<S>({
        path: tempPath, // File system path from FileImpl abstraction
        orgId: 'test-org', // Consistent test org
        trusted: true, // Default for tests
        registry: DataRegistry.default, // Default registry
        ...config, // User overrides
      });
    }
  }
}

/**
 * Manages and runs test suites.
 * Provides a default instance and methods to create and run test suites.
 */
export class TestsRunner extends Emitter<'testStart' | 'testComplete'> {
  private readonly _suites: Map<string, TestSuite>;

  /** Default instance of TestsRunner */
  static default = new TestsRunner();

  constructor() {
    super();
    this._suites = new Map();
  }

  /**
   * Gets or creates a test suite with the given name.
   * @param name - The name of the test suite
   * @returns The test suite instance
   */
  suite(name: string) {
    let suite = this._suites.get(name);
    if (!suite) {
      suite = new TestSuite(name);
      this._suites.set(name, suite);
    }
    return suite;
  }

  /**
   * Runs test suites and their tests.
   * Can run all suites, a specific suite, or a specific test within a suite.
   * @param suiteName - Optional name of suite to run
   * @param testName - Optional name of specific test to run
   * @returns Test execution summary
   */
  async run(suiteName?: string, testName?: string): Promise<TestSummary> {
    const allResults: TestResult[] = [];
    const runStart = performance.now();

    // Calculate total tests for progress bar
    let totalTests = 0;
    for (const [name, suite] of this._suites.entries()) {
      if (suiteName && name !== suiteName) continue;
      if (testName) {
        totalTests += suite['_tests'].has(testName) ? 1 : 0;
      } else {
        totalTests += suite['_tests'].size;
      }
    }

    const progress = new ProgressBar(totalTests);
    let currentTest = 0;

    for (const [name, suite] of this._suites.entries()) {
      if (suiteName && name !== suiteName) continue;

      if (testName) {
        // Run only the specific test in the suite
        const test = suite['_tests'].get(testName);
        if (test) {
          currentTest++;
          progress.update(currentTest - 1, '', `${suite.name}/${testName}`);
          this.emit('testStart', { suite: suite.name, name: testName, current: currentTest, total: totalTests });
          
          const start = performance.now();
          try {
            await test(suite);
            progress.update(currentTest, '');
            const result = {
              suiteName: suite.name,
              testName,
              passed: true,
              duration: performance.now() - start,
            };
            allResults.push(result);
            this.emit('testComplete', result);
          } catch (error) {
            progress.update(currentTest, '');
            formatError(error);
            const result = {
              suiteName: suite.name,
              testName,
              passed: false,
              duration: performance.now() - start,
              error: error instanceof Error
                ? error
                : new Error(error ? String(error) : 'Unknown error'),
            };
            allResults.push(result);
            this.emit('testComplete', result);
          }
        } else {
          console.log(`Test '${testName}' not found in suite '${suite.name}'.`);
        }
        if (suite['_tempDir']) {
          await (await FileImplGet()).remove(suite['_tempDir']);
        }
        // Clear progress bar after single test completion
        progress.clear();
      } else {
        const results = await this.runSuiteWithProgress(suite, progress, currentTest, totalTests);
        allResults.push(...results);
        currentTest += results.length;
      }
    }

    progress.finish();
    
    const totalDuration = performance.now() - runStart;
    const summary = this.createSummary(allResults, totalDuration);

    return summary;
  }
  
  /**
   * Runs a test suite with progress tracking.
   * @param suite - The test suite to run
   * @param progress - The progress bar to update
   * @param startingTest - Current test number before running this suite
   * @param totalTests - Total number of tests
   * @returns Array of test results
   */
  private async runSuiteWithProgress(
    suite: TestSuite, 
    progress: ProgressBar, 
    startingTest: number,
    totalTests: number
  ): Promise<TestResult[]> {
    // Suite name will be shown in progress bar title
    const results: TestResult[] = [];
    let currentTest = startingTest;

    for (const [name, test] of suite['_tests'].entries()) {
      currentTest++;
      progress.update(currentTest - 1, '', `${suite.name}/${name}`);
      this.emit('testStart', { suite: suite.name, name, current: currentTest, total: totalTests });
      
      const start = performance.now();
      try {
        await test(suite);
        progress.update(currentTest, '');
        const result = {
          suiteName: suite.name,
          testName: name,
          passed: true,
          duration: performance.now() - start,
        };
        results.push(result);
        this.emit('testComplete', result);
      } catch (error) {
        progress.update(currentTest, '');
        formatError(error);
        const result = {
          suiteName: suite.name,
          testName: name,
          passed: false,
          duration: performance.now() - start,
          error: error instanceof Error
            ? error
            : new Error(error ? String(error) : 'Unknown error'),
        };
        results.push(result);
        this.emit('testComplete', result);
      }
    }

    if (suite['_tempDir']) {
      await (await FileImplGet()).remove(suite['_tempDir']);
    }

    // Clear progress bar after suite completion
    progress.clear();

    return results;
  }
  
  /**
   * Creates a test summary from results.
   * @param results - All test results
   * @param duration - Total execution duration
   * @returns Test summary
   */
  private createSummary(results: TestResult[], duration: number): TestSummary {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    return {
      totalTests: results.length,
      passed,
      failed,
      duration,
      results,
    };
  }

  /**
   * Prints a summary of test results.
   * @param summary - The test summary to print
   */
  static printSummary(summary: TestSummary) {
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
        }
      }
    }
    console.log(`Duration: ${(summary.duration / 1000).toFixed(2)}s`);
    console.log();
  }
}

/**
 * Formats and displays an error with full stack trace.
 * @param error - The error to format
 */
function formatError(error: unknown) {
  if (error instanceof Error) {
    console.log(`   ${error.name}: ${error.message}`);
    if (error.stack) {
      console.log(error.stack);
    }
  } else if (error) {
    console.log(`   Error: ${String(error)}`);
  } else {
    console.log(`   Error: Unknown error`);
  }
  console.log(); // Empty line for readability
}

/**
 * Registers a test with the default test runner.
 * @param suite - The name of the test suite
 * @param name - The name of the test
 * @param test - The test function to run
 */

export function TEST(suite: string, name: string, test: TestFunc) {
  TestsRunner.default.suite(suite).add(name, test);
}
