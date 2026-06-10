import { EXIT_CODE_NO_MATCH, NoMatchError } from '../base/test-runner-error.ts';
import { TEST, TestsRunner } from './mod.ts';
import {
  BROWSER_FAILURE_FILTER_TEST,
  DENO_ONLY_FILTER_TEST,
  SHARED_SERVER_FILTER_TEST,
} from './test-filter-constants.ts';
import {
  assertEquals,
  assertLessThan,
  assertThrows,
  assertTrue,
} from './asserts.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { PLAYWRIGHT_VERSION } from '../base/playwright-version.ts';
import {
  isBrowserStructuredNoMatchResult,
  type RuntimeFilterOutcome,
  validateFilteredRuntimeOutcomes,
} from '../base/runtime-filter.ts';

const kPromptFailureThresholdMs = 15000;

async function runDenoCommandWithTimeout(args: string[]): Promise<{
  code: number;
  stdoutText: string;
  stderrText: string;
  elapsedMs: number;
}> {
  const abort = new AbortController();
  const start = performance.now();
  const timeoutId = setTimeout(
    () => abort.abort(),
    kPromptFailureThresholdMs,
  );
  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      args,
      cwd: getRuntime().getCWD(),
      stdout: 'piped',
      stderr: 'piped',
      signal: abort.signal,
    });
    const { code, stdout, stderr } = await cmd.output();
    return {
      code,
      stdoutText: new TextDecoder().decode(stdout),
      stderrText: new TextDecoder().decode(stderr),
      elapsedMs: performance.now() - start,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export default function setupTestRunnerTests(): void {
  TEST(
    'TestRunner',
    'run with exact --test name runs only matching registered tests',
    async () => {
      const runner = new TestsRunner();
      const executed: string[] = [];

      runner.suite('Alpha').add('target', () => {
        executed.push('Alpha/target');
      });
      runner.suite('Alpha').add('other', () => {
        executed.push('Alpha/other');
      });
      runner.suite('Beta').add('target', () => {
        executed.push('Beta/target');
      });

      const summary = await runner.run(undefined, 'target');

      assertEquals(summary.totalTests, 2);
      assertEquals(summary.passed, 2);
      assertEquals(summary.failed, 0);
      assertEquals(executed, ['Alpha/target', 'Beta/target']);
    },
  );

  TEST(
    'TestRunner',
    'aggregate filtered run tolerates browser runtime no-match when server runtimes matched',
    () => {
      validateFilteredRuntimeOutcomes(
        [
          { runtime: 'deno', status: 'matched' },
          { runtime: 'node', status: 'matched' },
          { runtime: 'browser', status: 'no-match' },
        ],
        undefined,
        'buildAssets forwards esbuildPlugins to esbuild',
      );
    },
  );

  TEST(
    'TestRunner',
    'aggregate filtered run tolerates server runtime no-match when browser matched',
    () => {
      validateFilteredRuntimeOutcomes(
        [
          { runtime: 'deno', status: 'no-match' },
          { runtime: 'node', status: 'no-match' },
          { runtime: 'browser', status: 'matched' },
        ],
        undefined,
        'real scaffold entry builds through buildAssets',
      );
    },
  );

  TEST(
    'TestRunner',
    'aggregate filtered run fails clearly when no selected runtime matches suite',
    () => {
      assertThrows(
        () => {
          validateFilteredRuntimeOutcomes(
            [
              { runtime: 'deno', status: 'no-match' },
              { runtime: 'node', status: 'no-match' },
              { runtime: 'browser', status: 'no-match' },
            ],
            'MissingSuite',
          );
        },
        NoMatchError,
        'No tests matched --suite="MissingSuite"',
      );
    },
  );

  TEST(
    'TestRunner',
    'aggregate filtered run fails clearly when no selected runtime matches test',
    () => {
      assertThrows(
        () => {
          validateFilteredRuntimeOutcomes(
            [
              { runtime: 'deno', status: 'no-match' },
              { runtime: 'node', status: 'no-match' },
              { runtime: 'browser', status: 'no-match' },
            ],
            undefined,
            'missing',
          );
        },
        NoMatchError,
        'No tests matched --test="missing"',
      );
    },
  );

  TEST(
    'TestRunner',
    'browser no-match payload is classified separately from successful browser summaries',
    () => {
      assertTrue(
        isBrowserStructuredNoMatchResult({
          status: 'no-match',
          totalTests: 0,
          passed: 0,
          failed: 0,
          duration: 0,
          results: [],
          error: {
            name: 'NoMatchError',
            message: 'No tests matched --test="missing"',
          },
          completed: true,
          exitCode: EXIT_CODE_NO_MATCH,
        }),
        'structured browser no-match payload must be detectable by the orchestrator',
      );
      assertTrue(
        !isBrowserStructuredNoMatchResult({
          totalTests: 1,
          passed: 1,
          failed: 0,
          duration: 1,
          results: [],
        }),
        'normal browser summaries must not be classified as no-match payloads',
      );
      assertTrue(
        !isBrowserStructuredNoMatchResult({ status: 'no-match' }),
        'bare status no-match values are malformed browser results',
      );
      assertTrue(
        !isBrowserStructuredNoMatchResult({
          status: 'no-match',
          totalTests: 0,
          passed: 0,
          failed: 0,
          duration: 0,
          results: [],
          completed: true,
          exitCode: EXIT_CODE_NO_MATCH,
        }),
        'browser no-match payloads must include the structured error details',
      );
    },
  );

  TEST(
    'TestRunner',
    'run with nonexistent --test name fails clearly',
    async () => {
      const runner = new TestsRunner();
      runner.suite('Alpha').add('target', () => {});

      await assertThrows(
        async () => {
          await runner.run(undefined, 'missing');
        },
        NoMatchError,
        'No tests matched --test="missing"',
      );
    },
  );

  TEST(
    'TestRunner',
    'run with nonexistent --suite name fails clearly',
    async () => {
      const runner = new TestsRunner();
      runner.suite('Alpha').add('target', () => {});

      await assertThrows(
        async () => {
          await runner.run('MissingSuite');
        },
        NoMatchError,
        'No tests matched --suite="MissingSuite"',
      );
    },
  );

  TEST(
    'TestRunner',
    'run with combined --suite and --test mismatch fails clearly',
    async () => {
      const runner = new TestsRunner();
      runner.suite('Alpha').add('target', () => {});
      runner.suite('Beta').add('other', () => {});

      await assertThrows(
        async () => {
          await runner.run('Alpha', 'other');
        },
        NoMatchError,
        'No tests matched --suite="Alpha" --test="other"',
      );
    },
  );

  TEST(
    'TestRunner',
    'validateFilteredRuntimeOutcomes is a no-op without filters',
    () => {
      const outcomes: RuntimeFilterOutcome[] = [{
        runtime: 'deno',
        status: 'no-match',
      }];
      const before = structuredClone(outcomes);
      validateFilteredRuntimeOutcomes(outcomes);
      assertEquals(outcomes, before);
    },
  );

  TEST(
    'TestRunner',
    'validateFilteredRuntimeOutcomes is a no-op with empty outcomes',
    () => {
      const outcomes: RuntimeFilterOutcome[] = [];
      const before = structuredClone(outcomes);
      validateFilteredRuntimeOutcomes(outcomes, 'MissingSuite');
      assertEquals(outcomes, before);
    },
  );

  TEST(
    'TestRunner',
    'validateFilteredRuntimeOutcomes treats unknown runtime id as no-match',
    () => {
      // The validator keys off `outcome.status`, not the runtime id, so an
      // unknown runtime ('bun') reporting `no-match` is aggregated the same
      // way as 'deno' or 'node' reporting no-match. The whole-outcomes
      // are-no-match path must still throw NoMatchError when at least one
      // filter was provided.
      assertThrows(
        () => {
          validateFilteredRuntimeOutcomes(
            [
              { runtime: 'deno', status: 'no-match' },
              { runtime: 'node', status: 'no-match' },
              { runtime: 'bun', status: 'no-match' },
            ],
            'MissingSuite',
          );
        },
        NoMatchError,
        'No tests matched',
      );
    },
  );

  TEST(
    'TestRunner',
    'isBrowserStructuredNoMatchResult rejects totalTests > 0 with status no-match',
    () => {
      assertTrue(
        !isBrowserStructuredNoMatchResult({
          status: 'no-match',
          totalTests: 1,
          passed: 0,
          failed: 0,
          duration: 0,
          results: [],
          error: {
            name: 'NoMatchError',
            message: 'No tests matched',
          },
          completed: true,
          exitCode: EXIT_CODE_NO_MATCH,
        }),
        'no-match status with totalTests > 0 is malformed',
      );
    },
  );

  TEST(
    'TestRunner',
    'isBrowserStructuredNoMatchResult accepts valid no-match result',
    () => {
      assertTrue(
        isBrowserStructuredNoMatchResult({
          status: 'no-match',
          totalTests: 0,
          passed: 0,
          failed: 0,
          duration: 0,
          results: [],
          error: {
            name: 'NoMatchError',
            message: 'No tests matched --test="missing"',
          },
          completed: true,
          exitCode: EXIT_CODE_NO_MATCH,
        }),
        'valid browser no-match payload must be detectable',
      );
    },
  );

  TEST(
    'TestRunner',
    'isBrowserStructuredNoMatchResult rejects no-match payloads with non-no-match exit codes',
    () => {
      const payload = {
        status: 'no-match',
        totalTests: 0,
        passed: 0,
        failed: 0,
        duration: 0,
        results: [],
        error: {
          name: 'NoMatchError',
          message: 'No tests matched --test="missing"',
        },
        completed: true,
      };

      assertTrue(
        !isBrowserStructuredNoMatchResult({ ...payload, exitCode: 0 }),
        'successful browser exits are not no-match results',
      );
      assertTrue(
        !isBrowserStructuredNoMatchResult({ ...payload, exitCode: 1 }),
        'generic browser failures are not no-match results',
      );
    },
  );

  TEST(
    'TestRunner',
    'NoMatchError has correct name and message',
    () => {
      const err = new NoMatchError('MySuite', 'myTest');
      assertEquals(err.name, 'NoMatchError');
      assertTrue(err.message.includes('--suite="MySuite"'));
      assertTrue(err.message.includes('--test="myTest"'));
    },
  );

  TEST(
    'TestRunner',
    'NoMatchError with suite only includes suite flag',
    () => {
      const err = new NoMatchError('MySuite', undefined);
      assertEquals(err.name, 'NoMatchError');
      assertTrue(err.message.includes('--suite="MySuite"'));
      assertTrue(!err.message.includes('--test='));
    },
  );

  TEST(
    'TestRunner',
    'NoMatchError with test only includes test flag',
    () => {
      const err = new NoMatchError(undefined, 'myTest');
      assertEquals(err.name, 'NoMatchError');
      assertTrue(!err.message.includes('--suite='));
      assertTrue(err.message.includes('--test="myTest"'));
    },
  );

  TEST(
    'TestRunner',
    'NoMatchError rejects construction without filters',
    () => {
      let error: unknown;
      try {
        new NoMatchError();
      } catch (thrown) {
        error = thrown;
      }
      assertTrue(error instanceof Error);
      assertEquals(
        (error as Error).message,
        'NoMatchError requires at least one of suiteName or testName',
      );
    },
  );
}

export function setupTestRunnerDenoTests(): void {
  TEST(
    'TestRunner',
    'browser CLI coverage registers only when GOATDB_REQUIRE_PLAYWRIGHT is true',
    async () => {
      const code = `
        const { countMatchingTests } = await import('./tests/test-registry.ts');
        const count = await countMatchingTests(
          'TestRunner',
          'tests/run.ts browser failures exit non-zero',
        );
        console.log(count);
      `;
      const withoutPlaywright = await runDenoCommandWithTimeout([
        'eval',
        '--ext=ts',
        `Deno.env.delete('GOATDB_REQUIRE_PLAYWRIGHT');\n${code}`,
      ]);
      assertEquals(withoutPlaywright.code, 0, withoutPlaywright.stderrText);
      assertEquals(
        withoutPlaywright.stdoutText.trim(),
        '0',
        'browser CLI coverage should stay unregistered without GOATDB_REQUIRE_PLAYWRIGHT',
      );

      const withPlaywright = await runDenoCommandWithTimeout([
        'eval',
        '--ext=ts',
        `Deno.env.set('GOATDB_REQUIRE_PLAYWRIGHT', 'true');\n${code}`,
      ]);
      assertEquals(withPlaywright.code, 0, withPlaywright.stderrText);
      assertTrue(
        Number(withPlaywright.stdoutText.trim()) > 0,
        'browser CLI coverage should register when GOATDB_REQUIRE_PLAYWRIGHT=true',
      );
    },
  );

  TEST(
    'TestRunner',
    'promise caching prevents duplicate concurrent registration',
    async () => {
      const code = `
        import {
          countMatchingTests,
          getRegistrationCallCount,
          registerAllTests,
        } from './tests/test-registry.ts';

        const [, lateSuiteCount] = await Promise.all([
          registerAllTests(),
          countMatchingTests('cluster-latency'),
        ]);
        if (lateSuiteCount === 0) {
          throw new Error('late suite was not visible after concurrent registration');
        }
        if (getRegistrationCallCount() !== 1) {
          throw new Error('registerAllTestsImpl ran more than once');
        }
      `;
      const { code: exitCode, stderrText } = await runDenoCommandWithTimeout([
        'eval',
        '--ext=ts',
        code,
      ]);

      assertEquals(exitCode, 0, stderrText);
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts aggregate filters tolerate a Deno-only server match',
    async () => {
      const { code, stdoutText, stderrText } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=deno,node',
        `--test=${DENO_ONLY_FILTER_TEST}`,
      ]);

      assertEquals(code, 0, stderrText);
      assertTrue(
        stdoutText.includes('=== 🦖 Deno: all passed ==='),
        'aggregate run must execute the Deno runtime that owns the filtered test',
      );
      assertTrue(
        stdoutText.includes('Node.js: no matching tests in this runtime'),
        'aggregate run must tolerate Node.js no-match for a Deno-only test',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts aggregate filters execute shared server tests on Deno and Node',
    async () => {
      const { code, stdoutText, stderrText } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=deno,node',
        `--test=${SHARED_SERVER_FILTER_TEST}`,
      ]);

      assertEquals(code, 0, stderrText);
      assertTrue(
        stdoutText.includes('=== 🦖 Deno: all passed ==='),
        'aggregate run must report Deno success when the shared server test passes',
      );
      assertTrue(
        stdoutText.includes('=== ⚡️ Node.js: all passed ==='),
        'aggregate run must report Node.js success when the shared server test passes',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts surfaces no-match errors through the Node.js path',
    async () => {
      const { code, stderrText } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=node',
        '--suite=MissingSuite',
      ]);

      assertEquals(
        code,
        EXIT_CODE_NO_MATCH,
        'CLI Node.js no-match path must exit with EXIT_CODE_NO_MATCH',
      );
      assertTrue(
        stderrText.includes(
          'Test execution failed: No tests matched --suite="MissingSuite"',
        ),
        'CLI Node.js no-match path must surface the exact filter error message',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts surfaces missing --test errors through the Node.js path',
    async () => {
      const { code, stderrText } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=node',
        '--test=missing',
      ]);

      assertEquals(
        code,
        EXIT_CODE_NO_MATCH,
        'CLI Node.js no-match path must exit with EXIT_CODE_NO_MATCH',
      );
      assertTrue(
        stderrText.includes(
          'Test execution failed: No tests matched --test="missing"',
        ),
        'CLI Node.js no-match path must surface the exact test filter error message',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts surfaces no-match errors through the Deno worker path',
    async () => {
      const { code, stderrText, elapsedMs } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=deno',
        '--suite=MissingSuite',
      ]);

      assertEquals(
        code,
        EXIT_CODE_NO_MATCH,
        'CLI no-match path must exit with EXIT_CODE_NO_MATCH',
      );
      assertTrue(
        stderrText.includes(
          'Test execution failed: No tests matched --suite="MissingSuite"',
        ),
        'CLI no-match path must surface the exact filter error message',
      );
      assertLessThan(
        elapsedMs,
        kPromptFailureThresholdMs,
        'CLI no-match path must fail promptly instead of hanging in the worker path',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts surfaces missing --test errors through the Deno worker path',
    async () => {
      const { code, stderrText, elapsedMs } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=deno',
        '--test=missing',
      ]);

      assertEquals(
        code,
        EXIT_CODE_NO_MATCH,
        'CLI no-match path must exit with EXIT_CODE_NO_MATCH',
      );
      assertTrue(
        stderrText.includes(
          'Test execution failed: No tests matched --test="missing"',
        ),
        'CLI no-match path must surface the exact test filter error message',
      );
      assertLessThan(
        elapsedMs,
        kPromptFailureThresholdMs,
        'CLI no-match path must fail promptly instead of hanging in the worker path',
      );
    },
  );

  TEST(
    'TestRunner',
    'runAcrossPlatforms checks Deno subprocess exit status',
    async (ctx) => {
      const tempDir = await ctx.tempDir('deno-subprocess-status');
      const failingEntry = `${tempDir}/failing-entry.ts`;
      await Deno.writeTextFile(failingEntry, 'Deno.exit(7);\n');

      const code = `
        import { runAcrossPlatforms } from './base/multi-runner.ts';
        try {
          await runAcrossPlatforms({
            entryPointServer: ${JSON.stringify(failingEntry)},
            entryPointBrowser: ${JSON.stringify(failingEntry)},
            runtimes: ['deno'],
            mode: 'benchmark',
          });
        } catch (error) {
          console.error((error as Error).message);
          Deno.exit(1);
        }
        Deno.exit(0);
      `;
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['eval', '--ext=ts', code],
        cwd: getRuntime().getCWD(),
        stdout: 'piped',
        stderr: 'piped',
      });
      const { code: exitCode, stderr } = await cmd.output();
      const stderrText = new TextDecoder().decode(stderr);

      assertTrue(exitCode !== 0, 'Deno subprocess failures must fail the run');
      assertTrue(
        stderrText.includes('Deno execution failed with exit code 7'),
        'Deno subprocess failures must report the child exit code',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts deduplicates repeated runtimes in --runtime CSV',
    async () => {
      const { code, stderrText } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=deno,deno',
        `--test=${DENO_ONLY_FILTER_TEST}`,
      ]);
      assertEquals(code, 0, stderrText);
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts rejects --runtime CSV containing an invalid runtime name',
    async () => {
      const { code, stderrText } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=deno,invalid',
      ]);
      assertEquals(code, 1, 'invalid runtime name must exit with code 1');
      assertTrue(
        stderrText.includes('Invalid value for --runtime:'),
        'error message must identify the invalid --runtime value',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts rejects --runtime CSV containing an empty component',
    async () => {
      const { code, stderrText } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=deno,,node',
      ]);
      assertEquals(code, 1, 'empty runtime component must exit with code 1');
      assertTrue(
        stderrText.includes('Invalid value for --runtime:'),
        'error message must identify the invalid --runtime value',
      );
    },
  );
}

export function setupTestRunnerBrowserCliTests(): void {
  TEST(
    'TestRunner',
    'tests/run.ts aggregate filters tolerate browser runtime no-match when Deno matched',
    async () => {
      const { code, stdoutText, stderrText } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=deno,browser',
        `--test=${DENO_ONLY_FILTER_TEST}`,
      ]);

      assertEquals(code, 0, stderrText);
      assertTrue(
        stdoutText.includes('=== 🦖 Deno: all passed ==='),
        'aggregate run must execute the Deno runtime that owns the filtered test',
      );
      assertTrue(
        stdoutText.includes('Browser: no matching tests in this runtime'),
        'aggregate run must tolerate Browser no-match for a Deno-only test',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts surfaces no-match errors through the browser path',
    async () => {
      const { code, stderrText, elapsedMs } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=browser',
        '--suite=MissingSuite',
      ]);

      assertEquals(
        code,
        EXIT_CODE_NO_MATCH,
        'CLI browser no-match path must exit with EXIT_CODE_NO_MATCH',
      );
      assertTrue(
        stderrText.includes(
          'Test execution failed: No tests matched --suite="MissingSuite"',
        ),
        'CLI browser no-match path must surface the exact filter error message',
      );
      assertLessThan(
        elapsedMs,
        kPromptFailureThresholdMs,
        'CLI browser no-match path must fail promptly',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts surfaces missing --test errors through the browser path',
    async () => {
      const { code, stderrText, elapsedMs } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=browser',
        '--test=missing',
      ]);

      assertEquals(
        code,
        EXIT_CODE_NO_MATCH,
        'CLI browser missing --test path must exit with EXIT_CODE_NO_MATCH',
      );
      assertTrue(
        stderrText.includes(
          'Test execution failed: No tests matched --test="missing"',
        ),
        'CLI browser missing --test path must surface the exact filter error message',
      );
      assertLessThan(
        elapsedMs,
        kPromptFailureThresholdMs,
        'CLI browser missing --test path must fail promptly',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts browser failures exit non-zero',
    async () => {
      const { code, stderrText, elapsedMs } = await runDenoCommandWithTimeout([
        'run',
        '-A',
        './tests/run.ts',
        '--runtime=browser',
        `--test=${BROWSER_FAILURE_FILTER_TEST}`,
      ]);

      assertEquals(code, 1, stderrText);
      assertTrue(
        stderrText.includes(
          'Test execution failed: Browser tests failed: 1 failed',
        ),
        'CLI browser failure path must surface failed test count',
      );
      assertLessThan(
        elapsedMs,
        kPromptFailureThresholdMs,
        'CLI browser failure path must fail promptly',
      );
    },
  );
}

/**
 * Registers only the Playwright version pinning CI workflow sync test.
 * Registered under `if (isDeno())` in test-registry.ts to avoid polling in Node.js.
 */
export function setupPlaywrightPinningTests(): void {
  TEST(
    'TestRunner',
    'CI workflow Playwright pin stays in sync with runtime pin',
    async () => {
      const workflow = await Deno.readTextFile('.github/workflows/test.yml');
      assertTrue(
        workflow.includes(
          "key: playwright-${{ runner.os }}-${{ hashFiles('base/playwright-version.ts') }}",
        ),
        'workflow cache key must hash base/playwright-version.ts',
      );
      assertTrue(
        /restore-keys:[\s\S]*playwright-\$\{\{[\s\S]*runner\.os[\s\S]*\}\}-/
          .test(workflow),
        'workflow restore-keys block must include the version-agnostic Playwright prefix',
      );
      assertTrue(
        workflow.includes(
          `run: deno run -A npm:playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium`,
        ),
        'workflow install command must use PLAYWRIGHT_VERSION',
      );
      for (
        const checkedPath of [
          'mod.ts',
          'cli/debug-server.ts',
          'cli/compile.ts',
          'cli/init.ts',
          'base/file-watcher.ts',
        ]
      ) {
        assertTrue(
          workflow.includes(`deno check ${checkedPath}`),
          `workflow static analysis step must include deno check ${checkedPath}`,
        );
      }
    },
  );
}
