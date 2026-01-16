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
import * as path from '../base/path.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import { isBrowser } from '../base/common.ts';
import { GoatDB } from '../db/db.ts';
import type { DBInstanceConfig } from '../db/db.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { ProgressManager, type TaskId } from '../shared/progress.ts';
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
   * Returns all registered tests in this suite.
   * @returns A read-only map of test names to test functions
   */
  getTests(): ReadonlyMap<string, TestFunc> {
    return this._tests;
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

    await this.cleanup();

    return results;
  }

  /**
   * Cleans up temporary resources for this suite.
   * Called automatically by TestSuite.run(), but must be called manually
   * when tests are executed directly (e.g., worker runner).
   */
  async cleanup(): Promise<void> {
    if (this._tempDir) {
      await (await FileImplGet()).remove(this._tempDir);
      this._tempDir = undefined;
    }
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
   * Returns all registered test suites.
   * @returns A read-only map of suite names to suite instances
   */
  getSuites(): ReadonlyMap<string, TestSuite> {
    return this._suites;
  }

  /**
   * Counts tests matching optional filters.
   * @param suiteName - Optional suite name to filter by
   * @param testName - Optional test name to filter by
   * @returns Object with suiteCount and testCount
   */
  getTestCount(
    suiteName?: string,
    testName?: string,
  ): { suiteCount: number; testCount: number } {
    let suiteCount = 0;
    let testCount = 0;
    for (const [name, suite] of this._suites.entries()) {
      if (suiteName && name !== suiteName) continue;
      const tests = suite.getTests();
      if (testName) {
        if (tests.has(testName)) {
          suiteCount++;
          testCount++;
        }
      } else {
        suiteCount++;
        testCount += tests.size;
      }
    }
    return { suiteCount, testCount };
  }

  /**
   * Runs test suites and their tests.
   * Can run all suites, a specific suite, or a specific test within a suite.
   * Uses hierarchical progress tracking with ProgressManager.
   * @param suiteName - Optional name of suite to run
   * @param testName - Optional name of specific test to run
   * @returns Test execution summary
   */
  async run(suiteName?: string, testName?: string): Promise<TestSummary> {
    const allResults: TestResult[] = [];
    const runStart = performance.now();

    // Calculate total tests and suite count for progress
    let totalTests = 0;
    let suiteCount = 0;
    for (const [name, suite] of this._suites.entries()) {
      if (suiteName && name !== suiteName) continue;
      if (testName) {
        if (suite['_tests'].has(testName)) {
          totalTests += 1;
          suiteCount++;
        }
      } else {
        totalTests += suite['_tests'].size;
        suiteCount++;
      }
    }

    const pm = new ProgressManager();
    let currentTest = 0;
    let completedSuites = 0;

    // Create root task for overall progress
    const rootId = pm.create('Running Tests', suiteCount);
    pm.update(rootId, 0);

    for (const [name, suite] of this._suites.entries()) {
      if (suiteName && name !== suiteName) continue;

      if (testName) {
        // Run only the specific test in the suite
        const test = suite['_tests'].get(testName);
        if (test) {
          currentTest++;
          // Create suite task as child of root
          const suiteId = pm.create(suite.name, 1, rootId);
          const testId = pm.create(testName, 1, suiteId);
          pm.update(testId, 0, 'starting');
          this.emit('testStart', { suite: suite.name, name: testName, current: currentTest, total: totalTests });

          const start = performance.now();
          try {
            await test(suite);
            pm.complete(testId, 'done');
            const result = {
              suiteName: suite.name,
              testName,
              passed: true,
              duration: performance.now() - start,
            };
            allResults.push(result);
            this.emit('testComplete', result);
          } catch (error) {
            pm.complete(testId, 'failed');
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
          pm.complete(suiteId);
          completedSuites++;
          pm.update(rootId, completedSuites);
        }
        await suite.cleanup();
      } else {
        const results = await this.runSuiteWithProgress(suite, pm, currentTest, totalTests, rootId);
        allResults.push(...results);
        currentTest += results.length;
        completedSuites++;
        pm.update(rootId, completedSuites);
      }
    }

    pm.complete(rootId);
    pm.finish();

    const totalDuration = performance.now() - runStart;
    const summary = this.createSummary(allResults, totalDuration);

    return summary;
  }

  /**
   * Runs a test suite with hierarchical progress tracking.
   * @param suite - The test suite to run
   * @param pm - The progress manager to update
   * @param startingTest - Current test number before running this suite
   * @param totalTests - Total number of tests
   * @param parentId - Optional parent task ID for hierarchy
   * @returns Array of test results
   */
  private async runSuiteWithProgress(
    suite: TestSuite,
    pm: ProgressManager,
    startingTest: number,
    totalTests: number,
    parentId?: TaskId
  ): Promise<TestResult[]> {
    const results: TestResult[] = [];
    let currentTest = startingTest;

    // Create suite-level task as child of parent (or root)
    const testCount = suite['_tests'].size;
    const suiteId = pm.create(suite.name, testCount, parentId);

    for (const [name, test] of suite['_tests'].entries()) {
      currentTest++;

      // Create test task as child of suite
      const testId = pm.create(name, 1, suiteId);
      pm.update(testId, 0, 'starting');
      this.emit('testStart', { suite: suite.name, name, current: currentTest, total: totalTests });

      const start = performance.now();
      try {
        await test(suite);
        pm.complete(testId, 'done');
        const result = {
          suiteName: suite.name,
          testName: name,
          passed: true,
          duration: performance.now() - start,
        };
        results.push(result);
        this.emit('testComplete', result);
      } catch (error) {
        pm.complete(testId, 'failed');
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

    // Complete the suite
    pm.complete(suiteId);

    await suite.cleanup();

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
