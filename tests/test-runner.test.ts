import { TEST, TestsRunner } from './mod.ts';
import {
  assertEquals,
  assertLessThan,
  assertThrows,
  assertTrue,
} from './asserts.ts';
import { getRuntime } from '../base/runtime/index.ts';
import {
  finalizeFilteredRuntimeOutcomes,
  isBrowserStructuredNoMatchResult,
} from '../base/runtime-filter.ts';

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
      finalizeFilteredRuntimeOutcomes(
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
      finalizeFilteredRuntimeOutcomes(
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
    async () => {
      await assertThrows(
        async () => {
          finalizeFilteredRuntimeOutcomes(
            [
              { runtime: 'deno', status: 'no-match' },
              { runtime: 'node', status: 'no-match' },
              { runtime: 'browser', status: 'no-match' },
            ],
            'MissingSuite',
          );
        },
        Error,
        'No tests matched --suite="MissingSuite"',
      );
    },
  );

  TEST(
    'TestRunner',
    'aggregate filtered run fails clearly when no selected runtime matches test',
    async () => {
      await assertThrows(
        async () => {
          finalizeFilteredRuntimeOutcomes(
            [
              { runtime: 'deno', status: 'no-match' },
              { runtime: 'node', status: 'no-match' },
              { runtime: 'browser', status: 'no-match' },
            ],
            undefined,
            'missing',
          );
        },
        Error,
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
            name: 'Error',
            message: 'No tests matched --test="missing"',
          },
          completed: true,
          exitCode: 1,
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
          exitCode: 1,
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
        Error,
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
        Error,
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
        Error,
        'No tests matched --suite="Alpha" --test="other"',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts surfaces no-match errors through the Node.js path',
    async () => {
      if (typeof Deno === 'undefined') return;
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          './tests/run.ts',
          '--runtime=node',
          '--suite=MissingSuite',
        ],
        cwd: getRuntime().getCWD(),
        stdout: 'piped',
        stderr: 'piped',
      });
      const { code, stderr } = await cmd.output();
      const stderrText = new TextDecoder().decode(stderr);

      assertTrue(code !== 0, 'CLI Node.js no-match path must exit non-zero');
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
      if (typeof Deno === 'undefined') return;
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          './tests/run.ts',
          '--runtime=node',
          '--test=missing',
        ],
        cwd: getRuntime().getCWD(),
        stdout: 'piped',
        stderr: 'piped',
      });
      const { code, stderr } = await cmd.output();
      const stderrText = new TextDecoder().decode(stderr);

      assertTrue(code !== 0, 'CLI Node.js no-match path must exit non-zero');
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
      if (typeof Deno === 'undefined') return;
      const start = performance.now();
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          './tests/run.ts',
          '--runtime=deno',
          '--suite=MissingSuite',
        ],
        cwd: getRuntime().getCWD(),
        stdout: 'piped',
        stderr: 'piped',
      });
      const { code, stderr } = await cmd.output();
      const elapsedMs = performance.now() - start;
      const stderrText = new TextDecoder().decode(stderr);

      assertTrue(code !== 0, 'CLI no-match path must exit non-zero');
      assertTrue(
        stderrText.includes(
          'Test execution failed: No tests matched --suite="MissingSuite"',
        ),
        'CLI no-match path must surface the exact filter error message',
      );
      assertLessThan(
        elapsedMs,
        15000,
        'CLI no-match path must fail promptly instead of hanging in the worker path',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts surfaces missing --test errors through the Deno worker path',
    async () => {
      if (typeof Deno === 'undefined') return;
      const start = performance.now();
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          './tests/run.ts',
          '--runtime=deno',
          '--test=missing',
        ],
        cwd: getRuntime().getCWD(),
        stdout: 'piped',
        stderr: 'piped',
      });
      const { code, stderr } = await cmd.output();
      const elapsedMs = performance.now() - start;
      const stderrText = new TextDecoder().decode(stderr);

      assertTrue(code !== 0, 'CLI no-match path must exit non-zero');
      assertTrue(
        stderrText.includes(
          'Test execution failed: No tests matched --test="missing"',
        ),
        'CLI no-match path must surface the exact test filter error message',
      );
      assertLessThan(
        elapsedMs,
        15000,
        'CLI no-match path must fail promptly instead of hanging in the worker path',
      );
    },
  );

  TEST(
    'TestRunner',
    'runAcrossPlatforms checks Deno subprocess exit status',
    async (ctx) => {
      if (typeof Deno === 'undefined') return;

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
}
