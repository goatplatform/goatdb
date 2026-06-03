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
import { log } from '../logging/log.ts';
import { PLAYWRIGHT_VERSION } from '../base/playwright-version.ts';
import {
  finalizeFilteredRuntimeOutcomes,
  isBrowserStructuredNoMatchResult,
  type RuntimeFilterOutcome,
} from '../base/runtime-filter.ts';

const kPromptFailureThresholdMs = 15000;
const _detectorState: {
  hasChromium?: Promise<boolean>;
  didWarn: boolean;
} = { didWarn: false };

type PlaywrightChromiumModule = {
  chromium: {
    executablePath(): string;
  };
};

type PlaywrightChromiumDetectionDeps = {
  importPlaywright?: () => Promise<PlaywrightChromiumModule>;
  stat?: (path: string | URL) => Promise<unknown>;
  getEnv?: (name: string) => string | undefined;
  /** Structural dir entry for platform-agnostic DI. */
  readDir?: (
    path: string | URL,
  ) => AsyncIterable<{ isDirectory: boolean; name: string }>;
  logFn?: typeof log;
};

/** Default env resolver used when DI doesn't supply one. */
function fallbackGetEnv(name: string): string | undefined {
  return typeof Deno === 'undefined' ? undefined : Deno.env.get(name);
}

function isWorkerImportFallbackError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  // Match the worker npm-specifier failure by stable signal words rather than
  // one exact upstream sentence.
  return message.includes('npm specifier') &&
    (message.includes('non-analyzable') || message.includes('non analyzable'));
}

async function detectPlaywrightChromium(
  deps: PlaywrightChromiumDetectionDeps = {},
): Promise<boolean> {
  let chromium: PlaywrightChromiumModule['chromium'];
  try {
    // Construct the specifier dynamically so non-Deno bundles never treat
    // Playwright as a required static dependency.
    if (deps.importPlaywright) {
      chromium = (await deps.importPlaywright()).chromium;
    } else {
      const ns = 'npm';
      const specifier = `${ns}:playwright@${PLAYWRIGHT_VERSION}`; // exact pin — see playwright-version.ts
      chromium = (await import(specifier)).chromium;
    }
  } catch (error) {
    // Only the known worker npm-specifier failure should fall back. Other
    // import failures stay explicit rather than being misreported as missing
    // Chromium.
    if (isWorkerImportFallbackError(error)) {
      return checkChromiumViaEnvPath(deps);
    }
    throw error;
  }
  const stat = 'stat' in deps
    ? deps.stat
    : (typeof Deno === 'undefined' ? undefined : Deno.stat);
  if (!stat) return false;
  try {
    await stat(chromium.executablePath());
    return true;
  } catch {
    // Import succeeded but binary is missing or unreadable.
    return false;
  }
}

function getOrCreateChromiumDetectionPromise(
  factory: () => Promise<boolean>,
): Promise<boolean> {
  _detectorState.hasChromium ??= factory();
  return _detectorState.hasChromium;
}

function hasPlaywrightChromium(): Promise<boolean> {
  return getOrCreateChromiumDetectionPromise(() =>
    typeof Deno === 'undefined'
      ? Promise.resolve(false)
      : detectPlaywrightChromium()
  );
}

/**
 * Fallback: detect Playwright Chromium by scanning PLAYWRIGHT_BROWSERS_PATH
 * for a chromium-* cache directory. This only proves that Playwright's browser
 * cache looks populated enough to attempt the browser CLI path.
 */
async function checkChromiumViaEnvPath(
  deps: Pick<PlaywrightChromiumDetectionDeps, 'getEnv' | 'readDir' | 'logFn'> =
    {},
): Promise<boolean> {
  const getEnv = deps.getEnv ?? fallbackGetEnv;
  const readDir = 'readDir' in deps
    ? deps.readDir
    : (typeof Deno === 'undefined' ? undefined : Deno.readDir);
  if (!readDir) return false;
  const browsersPath = getEnv('PLAYWRIGHT_BROWSERS_PATH');
  if (!browsersPath) return false;
  try {
    for await (const entry of readDir(browsersPath)) {
      if (entry.isDirectory && entry.name.startsWith('chromium-')) {
        return true;
      }
    }
    return false;
  } catch (err) {
    (deps.logFn ?? log)({
      severity: 'DEBUG',
      message:
        `checkChromiumViaEnvPath: failed to scan ${browsersPath}: ${err}`,
    });
    return false;
  }
}

function resetPlaywrightChromiumDetectionStateForTests(): void {
  _detectorState.hasChromium = undefined;
  _detectorState.didWarn = false;
}

function getMissingPlaywrightWarningMessage(): string {
  return `Playwright Chromium not found; browser CLI coverage tests skipped (run: deno run -A npm:playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium)`;
}

type ShouldRunBrowserCliCoverageDeps = {
  hasChromium?: () => Promise<boolean>;
  getEnv?: (name: string) => string | undefined;
  logFn?: typeof log;
  /** Mutable box for the one-shot warning flag. Defaults to global _detectorState. */
  warnState?: { didWarn: boolean };
};

async function shouldRunBrowserCliCoverage(
  deps: ShouldRunBrowserCliCoverageDeps = {},
): Promise<boolean> {
  const { hasChromium, getEnv, logFn, warnState } = deps;
  const hasCr = await (hasChromium?.() ?? hasPlaywrightChromium());
  if (!hasCr) {
    const requirePlaywright = (getEnv ?? fallbackGetEnv)(
      'GOATDB_REQUIRE_PLAYWRIGHT',
    ) === 'true';
    if (requirePlaywright) {
      throw new Error(
        'CI requires Playwright Chromium for browser CLI coverage tests',
      );
    }
    const warn = warnState ?? _detectorState;
    if (!warn.didWarn) {
      (logFn ?? log)({
        severity: 'WARNING',
        message: getMissingPlaywrightWarningMessage(),
      });
      warn.didWarn = true;
    }
  }
  return hasCr;
}

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
    'promise caching prevents duplicate concurrent registration',
    async () => {
      if (typeof Deno === 'undefined') return;
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
    'Chromium env-path fallback returns false when PLAYWRIGHT_BROWSERS_PATH is unset',
    async () => {
      assertTrue(
        !await checkChromiumViaEnvPath({
          getEnv: () => undefined,
        }),
        'env-path fallback must report unavailable when the browser cache path is unset',
      );
    },
  );

  TEST(
    'TestRunner',
    'Chromium env-path fallback handles empty PLAYWRIGHT_BROWSERS_PATH',
    async () => {
      assertTrue(
        !await checkChromiumViaEnvPath({
          getEnv: () => '',
        }),
        'env-path fallback must handle empty browser cache path gracefully',
      );
    },
  );

  TEST(
    'TestRunner',
    'Chromium detection promise is created once across repeated calls',
    async () => {
      resetPlaywrightChromiumDetectionStateForTests();
      try {
        let factoryCalls = 0;
        const p1 = getOrCreateChromiumDetectionPromise(async () => {
          ++factoryCalls;
          return true;
        });
        const p2 = getOrCreateChromiumDetectionPromise(async () => {
          ++factoryCalls;
          return false;
        });
        assertTrue(
          p1 === p2,
          'repeated callers must share the same detection promise',
        );
        assertEquals(await p1, true);
        assertEquals(factoryCalls, 1);
      } finally {
        resetPlaywrightChromiumDetectionStateForTests();
      }
    },
  );

  TEST(
    'TestRunner',
    'Chromium env-path fallback detects chromium browser directories',
    async () => {
      assertTrue(
        await checkChromiumViaEnvPath({
          getEnv: () => '/playwright',
          readDir: async function* () {
            yield { isDirectory: true, name: 'firefox-1234' };
            yield { isDirectory: true, name: 'chromium-1148' };
          },
        }),
        'env-path fallback must detect Playwright Chromium cache directories',
      );
    },
  );

  TEST(
    'TestRunner',
    'Chromium env-path fallback ignores non-chromium entries and unreadable directories',
    async () => {
      assertTrue(
        !await checkChromiumViaEnvPath({
          getEnv: () => '/playwright',
          readDir: async function* () {
            yield { isDirectory: true, name: 'firefox-1234' };
            yield { isDirectory: false, name: 'chromium' };
          },
        }),
        'env-path fallback must not report Chromium for unrelated cache entries',
      );
      assertTrue(
        !await checkChromiumViaEnvPath({
          getEnv: () => '/playwright',
          readDir: () => {
            throw new Error('unreadable');
          },
        }),
        'env-path fallback must degrade to unavailable when the cache directory cannot be read',
      );
    },
  );

  TEST(
    'TestRunner',
    'Playwright worker fallback only runs for the known worker npm-specifier failure',
    async () => {
      let didReadFallbackDir = false;
      assertTrue(
        await detectPlaywrightChromium({
          importPlaywright: async () => {
            throw new TypeError(
              'Worker failed to resolve non analyzable npm specifier',
            );
          },
          getEnv: () => '/playwright',
          readDir: async function* () {
            didReadFallbackDir = true;
            yield { isDirectory: true, name: 'chromium-1148' };
          },
        }),
        'worker import failures must use the env-path fallback',
      );
      assertTrue(
        didReadFallbackDir,
        'worker fallback must scan PLAYWRIGHT_BROWSERS_PATH',
      );

      didReadFallbackDir = false;
      await assertThrows(
        async () => {
          await detectPlaywrightChromium({
            importPlaywright: async () => {
              throw new TypeError('wrong module shape');
            },
            getEnv: () => '/playwright',
            readDir: async function* () {
              didReadFallbackDir = true;
              yield { isDirectory: true, name: 'chromium-1148' };
            },
          });
        },
        TypeError,
        'wrong module shape',
      );
      assertTrue(
        !didReadFallbackDir,
        'unrelated TypeErrors must not scan PLAYWRIGHT_BROWSERS_PATH',
      );

      await assertThrows(
        async () => {
          await detectPlaywrightChromium({
            importPlaywright: async () => {
              throw new Error('broken Playwright install');
            },
            getEnv: () => '/playwright',
            readDir: async function* () {
              didReadFallbackDir = true;
              yield { isDirectory: true, name: 'chromium-1148' };
            },
          });
        },
        Error,
        'broken Playwright install',
      );
      assertTrue(
        !didReadFallbackDir,
        'non-worker failures must not scan PLAYWRIGHT_BROWSERS_PATH',
      );
    },
  );

  TEST(
    'TestRunner',
    'detectPlaywrightChromium returns false when worker fallback has no browser path',
    async () => {
      assertTrue(
        !await detectPlaywrightChromium({
          importPlaywright: async () => {
            throw new TypeError(
              'Worker failed to resolve non analyzable npm specifier',
            );
          },
          getEnv: () => undefined,
        }),
        'worker fallback must report unavailable without PLAYWRIGHT_BROWSERS_PATH',
      );
    },
  );

  TEST(
    'TestRunner',
    'detectPlaywrightChromium returns false when worker fallback cannot read the browser path',
    async () => {
      assertTrue(
        !await detectPlaywrightChromium({
          importPlaywright: async () => {
            throw new TypeError(
              'Worker failed to resolve non analyzable npm specifier',
            );
          },
          getEnv: () => '/playwright',
          readDir: undefined,
        }),
        'worker fallback must report unavailable when readDir is unavailable',
      );
    },
  );

  TEST(
    'TestRunner',
    'detectPlaywrightChromium returns false when stat is unavailable after successful import',
    async () => {
      assertTrue(
        !await detectPlaywrightChromium({
          importPlaywright: async () => ({
            chromium: { executablePath: () => '/mock/chromium' },
          }),
          stat: undefined,
        }),
        'must report unavailable when Playwright import succeeds but stat is unavailable',
      );
    },
  );

  TEST(
    'TestRunner',
    'detectPlaywrightChromium returns true when import and stat succeed',
    async () => {
      assertTrue(
        await detectPlaywrightChromium({
          importPlaywright: async () => ({
            chromium: { executablePath: () => '/mock/chromium' },
          }),
          stat: async () => {},
        }),
        'must report available when Playwright import and binary stat both succeed',
      );
    },
  );

  TEST(
    'TestRunner',
    'detectPlaywrightChromium returns false when binary stat fails after successful import',
    async () => {
      assertTrue(
        !await detectPlaywrightChromium({
          importPlaywright: async () => ({
            chromium: { executablePath: () => '/mock/chromium' },
          }),
          stat: async () => {
            throw new Error('binary not found');
          },
        }),
        'must report unavailable when Playwright import succeeds but binary stat fails',
      );
    },
  );

  TEST(
    'TestRunner',
    'browser CLI coverage preflight throws in CI and warns once locally',
    async () => {
      resetPlaywrightChromiumDetectionStateForTests();
      try {
        let caughtError: unknown;
        try {
          await shouldRunBrowserCliCoverage({
            hasChromium: async () => false,
            getEnv: (name) =>
              name === 'GOATDB_REQUIRE_PLAYWRIGHT' ? 'true' : undefined,
          });
        } catch (error) {
          caughtError = error;
        }
        assertTrue(
          caughtError instanceof Error,
          'CI preflight must throw when Chromium is unavailable',
        );
        assertEquals(
          (caughtError as Error).message,
          'CI requires Playwright Chromium for browser CLI coverage tests',
        );

        resetPlaywrightChromiumDetectionStateForTests();
        const logEntries: Parameters<typeof log>[0][] = [];
        assertTrue(
          !await shouldRunBrowserCliCoverage({
            hasChromium: async () => false,
            getEnv: () => undefined,
            logFn: (entry) => {
              logEntries.push(entry);
            },
          }),
          'local preflight must skip browser coverage when Chromium is unavailable',
        );
        assertTrue(
          !await shouldRunBrowserCliCoverage({
            hasChromium: async () => false,
            getEnv: () => undefined,
            logFn: (entry) => {
              logEntries.push(entry);
            },
          }),
          'local preflight must stay false across repeated checks',
        );
        assertEquals(logEntries.length, 1);
        assertEquals(logEntries[0]?.severity, 'WARNING');

        assertEquals(
          logEntries[0]?.message,
          getMissingPlaywrightWarningMessage(),
        );

        logEntries.length = 0;
        assertTrue(
          await shouldRunBrowserCliCoverage({
            hasChromium: async () => true,
            getEnv: (name) =>
              name === 'GOATDB_REQUIRE_PLAYWRIGHT' ? 'true' : undefined,
            logFn: (entry) => {
              logEntries.push(entry);
            },
          }),
          'preflight must run browser coverage when Chromium is available',
        );
        assertEquals(logEntries.length, 0);
      } finally {
        resetPlaywrightChromiumDetectionStateForTests();
      }
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
    () => {
      assertThrows(
        () => {
          finalizeFilteredRuntimeOutcomes(
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
        NoMatchError,
        'No tests matched --test="missing"',
      );
    },
  );

  TEST(
    'TestRunner',
    'tests/run.ts aggregate filters tolerate a Deno-only server match',
    async () => {
      if (typeof Deno === 'undefined') return;
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
      if (typeof Deno === 'undefined') return;
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
    'tests/run.ts aggregate filters tolerate browser runtime no-match when Deno matched',
    async () => {
      if (!await shouldRunBrowserCliCoverage()) return;
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
    'tests/run.ts surfaces no-match errors through the Node.js path',
    async () => {
      if (typeof Deno === 'undefined') return;
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
      if (typeof Deno === 'undefined') return;
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
      if (typeof Deno === 'undefined') return;
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
      if (typeof Deno === 'undefined') return;
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
    'tests/run.ts surfaces no-match errors through the browser path',
    async () => {
      if (!await shouldRunBrowserCliCoverage()) return;
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
      if (!await shouldRunBrowserCliCoverage()) return;
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

  TEST(
    'TestRunner',
    'tests/run.ts browser failures exit non-zero',
    async () => {
      if (!await shouldRunBrowserCliCoverage()) return;
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

  TEST(
    'TestRunner',
    'finalizeFilteredRuntimeOutcomes is a no-op without filters',
    () => {
      const outcomes: RuntimeFilterOutcome[] = [{
        runtime: 'deno',
        status: 'no-match',
      }];
      const before = structuredClone(outcomes);
      finalizeFilteredRuntimeOutcomes(outcomes);
      assertEquals(outcomes, before);
    },
  );

  TEST(
    'TestRunner',
    'finalizeFilteredRuntimeOutcomes is a no-op with empty outcomes',
    () => {
      const outcomes: RuntimeFilterOutcome[] = [];
      const before = structuredClone(outcomes);
      finalizeFilteredRuntimeOutcomes(outcomes, 'MissingSuite');
      assertEquals(outcomes, before);
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
    'tests/run.ts deduplicates repeated runtimes in --runtime CSV',
    async () => {
      if (typeof Deno === 'undefined') return;
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
      if (typeof Deno === 'undefined') return;
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
      if (typeof Deno === 'undefined') return;
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
          'key: playwright-${{ runner.os }}-${{ hashFiles(\'base/playwright-version.ts\') }}',
        ),
        'workflow cache key must hash base/playwright-version.ts',
      );
      assertTrue(
        workflow.includes(
          'restore-keys: |\n            playwright-${{ runner.os }}-',
        ),
        'workflow restore-keys block must include the version-agnostic Playwright prefix',
      );
      assertTrue(
        workflow.includes(
          `run: deno run -A npm:playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium`,
        ),
        'workflow install command must use PLAYWRIGHT_VERSION',
      );
    },
  );
}
