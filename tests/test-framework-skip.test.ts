/**
 * Test-framework contract for skipped tests.
 *
 * WHY: a test that cannot run must not look like a pass. A silent early return
 * hides lost coverage, so the framework classifies three outcomes and can fail
 * the run when a skip appears (`--fail-on-skip` / `GOATDB_FAIL_ON_SKIP`).
 * These tests pin that contract through the public runner API.
 */
import {
  failureCount,
  skipTest,
  summaryExitCode,
  TEST,
  TestsRunner,
  TestSuite,
  type TestSummary,
} from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { getEnvVar } from '../base/os.ts';
import {
  assertBrowserDisplay,
  assertCliDisplay,
} from './test-framework-display.ts';

/** Sets the skip gate for the current runtime. */
function setFailOnSkip(value: string | undefined): void {
  const runtime = getRuntime().id;
  if (runtime === 'deno') {
    if (value === undefined) Deno.env.delete('GOATDB_FAIL_ON_SKIP');
    else Deno.env.set('GOATDB_FAIL_ON_SKIP', value);
    return;
  }
  if (runtime === 'node') {
    if (value === undefined) delete globalThis.process.env.GOATDB_FAIL_ON_SKIP;
    else globalThis.process.env.GOATDB_FAIL_ON_SKIP = value;
    return;
  }
  // The browser receives GOATDB_* vars through the injected config global.
  const config = (globalThis as {
    GoatDBConfig?: Record<string, string | undefined>;
  }).GoatDBConfig ?? {};
  config.fail_on_skip = value;
  (globalThis as { GoatDBConfig?: unknown }).GoatDBConfig = config;
}

/** Runs a local suite with one test of each outcome. */
async function runMixedSuite(): Promise<{
  skipped: boolean;
  skippedPassed: boolean;
  failedCount: number;
}> {
  // A local suite keeps the outcomes out of the global registry.
  const suite = new TestSuite('SkipContract');
  suite.add('passes', () => {});
  suite.add('skips', () => skipTest('fixture unavailable'));
  suite.add('fails', () => {
    throw new Error('boom');
  });
  const results = await suite.run();
  const byName = (name: string) => results.find((r) => r.testName === name)!;
  assertEquals(byName('passes').passed, true, 'a plain test must pass');
  assertEquals(
    byName('passes').skipped,
    false,
    'a passing test is not skipped',
  );
  const skipped = byName('skips');
  assertEquals(skipped.skipped, true, 'the sentinel must mark a skip');
  assertEquals(
    skipped.passed,
    false,
    'a skip must never count as a pass',
  );
  assertTrue(
    skipped.error?.message.includes('fixture unavailable') ?? false,
    'the skip reason must survive',
  );
  return {
    skipped: skipped.skipped,
    skippedPassed: skipped.passed,
    failedCount: results.filter((r) => !r.passed && !r.skipped).length,
  };
}

/** A summary with one pass and one skip; used for exit-code semantics. */
function skipOnlySummary(): TestSummary {
  return {
    totalTests: 2,
    passed: 1,
    skipped: 1,
    failed: 0,
    duration: 1,
    results: [
      {
        suiteName: 'SkipContract',
        testName: 'passes',
        passed: true,
        skipped: false,
        duration: 1,
      },
      {
        suiteName: 'SkipContract',
        testName: 'skips',
        passed: false,
        skipped: true,
        duration: 0,
        error: new Error('fixture unavailable'),
      },
    ],
  };
}

async function assertStrictNodeSkipCli(): Promise<void> {
  const result = await new Deno.Command('deno', {
    args: [
      'task',
      'test',
      '--runtime=node',
      '--suite=TestFramework',
      '--fail-on-skip',
    ],
    signal: AbortSignal.timeout(30_000),
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const output = new TextDecoder().decode(result.stdout) +
    new TextDecoder().decode(result.stderr);
  assertTrue(output.includes('Skipped: 1'), output);
  assertEquals(result.code, 1, `Node strict skip gate:\n${output}`);
}

export default function setupTestFrameworkSkip(): void {
  TEST(
    'RunnerFailureReporting',
    'strict Node skip gate survives contract tests',
    async () => {
      if (getRuntime().id !== 'deno') skipTest('spawns the deno test CLI');
      // Browser automation runs in its own CI job; this suite needs only Node.
      await assertStrictNodeSkipCli();
    },
  );
  TEST(
    'TestFramework',
    'a skip is reported separately from a pass and a failure',
    async () => {
      if (getRuntime().id === 'browser') await assertBrowserDisplay();
      const outcome = await runMixedSuite();
      assertEquals(outcome.skipped, true);
      assertEquals(outcome.skippedPassed, false);
      assertEquals(
        outcome.failedCount,
        1,
        'the skip must not be counted as a failure',
      );
    },
  );

  TEST(
    'TestFramework',
    'printSummary lists skips without counting them as failures',
    () => {
      const lines: string[] = [];
      const original = console.log;
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      };
      try {
        TestsRunner.printSummary(skipOnlySummary());
      } finally {
        console.log = original;
      }
      const text = lines.join('\n');
      assertTrue(text.includes('Skipped: 1'), `missing skip count:\n${text}`);
      assertTrue(
        !text.includes('Failed:'),
        `a skip must not print a failure count:\n${text}`,
      );
    },
  );

  TEST(
    'TestFramework',
    'fail-on-skip turns skips into a non-zero exit code',
    () => {
      const summary = skipOnlySummary();
      const previous = getEnvVar('GOATDB_FAIL_ON_SKIP');
      try {
        setFailOnSkip(undefined);
        assertEquals(summaryExitCode(summary), 0, 'skips pass by default');
        assertEquals(failureCount(summary), 0, 'no failure by default');

        for (const truthy of ['1', 'true']) {
          setFailOnSkip(truthy);
          assertEquals(
            summaryExitCode(summary),
            1,
            `GOATDB_FAIL_ON_SKIP=${truthy} must fail the run`,
          );
          assertEquals(
            failureCount(summary),
            1,
            'the skip counts as a failure',
          );
        }

        setFailOnSkip('0');
        assertEquals(
          summaryExitCode(summary),
          0,
          'a false value must not fail',
        );
      } finally {
        // Contract checks must not disable the caller's CI gate.
        setFailOnSkip(previous);
      }
    },
  );

  TEST(
    'TestFramework',
    'the test CLI exits non-zero on a skip only with --fail-on-skip',
    async () => {
      if (getRuntime().id !== 'deno') {
        skipTest('spawns the deno test CLI');
      }
      await assertCliDisplay();
      // A Node-only test skips when the Deno entry runs it. Pin the real exit
      // code and the printed summary, not just the in-process helpers.
      const env: Record<string, string> = {
        ...Deno.env.toObject(),
        GOATDB_SUITE: 'CLI-BuildAssets',
        GOATDB_TEST: 'debug build spec wires Node runtime, plugins, and minify',
      };
      delete env.GOATDB_FAIL_ON_SKIP;
      const run = async (failOnSkip: boolean) => {
        const result = await new Deno.Command('deno', {
          args: [
            'run',
            '-A',
            'tests/run.ts',
            '--runtime=deno',
            `--suite=${env.GOATDB_SUITE}`,
            `--test=${env.GOATDB_TEST}`,
            ...(failOnSkip ? ['--fail-on-skip'] : []),
          ],
          env: failOnSkip ? { ...env, GOATDB_FAIL_ON_SKIP: '1' } : env,
          stdout: 'piped',
          stderr: 'piped',
        }).output();
        return {
          code: result.code,
          stdout: new TextDecoder().decode(result.stdout),
          stderr: new TextDecoder().decode(result.stderr),
        };
      };

      const tolerated = await run(false);
      assertEquals(
        tolerated.code,
        0,
        `a skip must not fail the run by default:\n${tolerated.stdout}${tolerated.stderr}`,
      );
      assertTrue(!tolerated.stdout.includes('[FAIL]'), tolerated.stdout);
      assertTrue(tolerated.stdout.includes('[SKIP]'), tolerated.stdout);
      assertTrue(
        tolerated.stdout.includes('Skipped: 1'),
        `the summary must print the skip:\n${tolerated.stdout}`,
      );

      const strict = await run(true);
      assertTrue(!strict.stdout.includes('[FAIL]'), strict.stdout);
      assertTrue(strict.stdout.includes('[SKIP]'), strict.stdout);
      assertEquals(
        strict.code,
        1,
        `--fail-on-skip must fail the run:\n${strict.stdout}${strict.stderr}`,
      );
    },
  );
}
