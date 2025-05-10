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

export type TestFunc = (ctx: TestSuite) => Promise<void> | void;

export class TestSuite {
  private readonly _tests: Map<string, TestFunc>;
  private _tempDir: string | undefined;

  constructor(readonly name: string) {
    this._tests = new Map();
  }

  add(name: string, test: TestFunc) {
    this._tests.set(name, test);
  }

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

export class TestsRunner {
  private readonly _suites: Map<string, TestSuite>;

  static default = new TestsRunner();

  constructor() {
    this._suites = new Map();
  }

  suite(name: string) {
    let suite = this._suites.get(name);
    if (!suite) {
      suite = new TestSuite(name);
      this._suites.set(name, suite);
    }
    return suite;
  }

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

export function TEST(suite: string, name: string, test: TestFunc) {
  TestsRunner.default.suite(suite).add(name, test);
}
