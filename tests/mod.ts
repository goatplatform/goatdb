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
   */
  async run() {
    console.log(`Running suite: ${this.name}`);
    for (const [name, test] of this._tests.entries()) {
      const start = performance.now();
      try {
        await test(this);
        const duration = performance.now() - start;
        console.log(
          `✅ ${this.name}/${name} passed %c(${Math.round(duration)}ms)`,
          'color: gray',
        );
      } catch (error) {
        const duration = performance.now() - start;
        console.log(
          `❌ ${this.name}/${name} failed %c(${Math.round(duration)}ms)`,
          'color: gray',
        );
        console.log(error);
      }
    }
    if (this._tempDir) {
      await (await FileImplGet()).remove(this._tempDir);
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
      this._tempDir = path.join(
        await (await FileImplGet()).getTempDir(),
        'test-' + this.name,
      );
    }
    return subPath ? path.join(this._tempDir, subPath) : this._tempDir;
  }
}

/**
 * Manages and runs test suites.
 * Provides a default instance and methods to create and run test suites.
 */
export class TestsRunner {
  private readonly _suites: Map<string, TestSuite>;

  /** Default instance of TestsRunner */
  static default = new TestsRunner();

  constructor() {
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
   */
  async run(suiteName?: string, testName?: string) {
    for (const [name, suite] of this._suites.entries()) {
      if (suiteName && name !== suiteName) continue;
      if (testName) {
        // Run only the specific test in the suite
        const test = suite['_tests'].get(testName);
        if (test) {
          const start = performance.now();
          try {
            await test(suite);
            const duration = performance.now() - start;
            console.log(
              `✅ ${suite.name}/${testName} passed %c(${
                Math.round(duration)
              }ms)`,
              'color: gray',
            );
          } catch (error) {
            const duration = performance.now() - start;
            console.log(
              `❌ ${suite.name}/${testName} failed %c(${
                Math.round(duration)
              }ms)`,
              'color: gray',
            );
            console.log(error);
          }
        } else {
          console.log(`Test '${testName}' not found in suite '${suite.name}'.`);
        }
        if (suite['_tempDir']) {
          await (await FileImplGet()).remove(suite['_tempDir']);
        }
      } else {
        await suite.run();
      }
    }
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
