/**
 * Tests for the CLI compile toolchain and the debug-server lifecycle.
 *
 * This test suite verifies that:
 * - compile() routes to the appropriate compiler (Deno compile vs Node.js SEA)
 * - buildAssets() and createBuildContext() produce correct cross-platform bundles
 * - startDebugServer() lifecycle (startup, rebuild, cleanup, state restoration)
 * - Handles unsupported runtimes gracefully
 * - Produces working executables (E2E test)
 */

import { TEST, type TestSuite } from './mod.ts';
import {
  assertEquals,
  assertExists,
  assertFalse,
  assertThrows,
  assertTrue,
} from './asserts.ts';
import * as path from '../base/path.ts';
import {
  mkdir,
  pathExists,
  readTextFile,
  writeTextFile,
} from '../base/json-log/file-impl.ts';
import { getEnvVar } from '../base/os.ts';
import { sleep } from '../base/time.ts';
import { getGoatConfig } from '../base/config.ts';
import {
  bundleServerForSEA,
  compile,
  denoTarget,
  signExecutable,
  targetFromOSArch,
} from '../cli/compile.ts';
import {
  type BuildPluginLike,
  createBuildContext,
  getCachedImport,
  type ImportCacheState,
  resetImportState,
  stopBackgroundCompiler,
} from '../build.ts';

import {
  buildAssets,
  buildCombinedCSS,
  countNewlines,
} from '../cli/build-assets.ts';
import { startDebugServer } from '../cli/debug-server.ts';
import type { StaticAssets } from '../system-assets/system-assets.ts';
import type { Schema } from '../cfds/base/schema.ts';
import type { Server } from '../net/server/server.ts';
import { createHttpServer } from '../net/server/http-compat.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { goatEntryPoints } from '../cli/link.ts';
import {
  getEffectiveRuntimeId,
  getRuntime,
  withTestCWD,
  withTestOpenBrowser,
  withTestRuntimeId,
} from '../base/runtime/index.ts';
import { cli, type CliOptions } from '../base/development.ts';
import { runAcrossPlatforms } from '../base/multi-runner.ts';
import { createTestDomainConfig } from './merge-test-utils.ts';
import { withLogCapture } from './test-utils.ts';

function runBundledScript(js: string): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  return new Function(
    'globalThis',
    'window',
    'self',
    `${js}\nreturn globalThis;`,
  )(scope, scope, scope) as Record<string, unknown>;
}

function getCssChunkStartLine(prependedCss: string): number {
  return countNewlines(`${prependedCss}\n\n`) + 1;
}

function getMapSources(
  // deno-lint-ignore no-explicit-any
  map: any,
): string[] {
  return map.sources ??
    map.sections?.flatMap((section: { map?: { sources?: string[] } }) =>
      section.map?.sources ?? []
    ) ?? [];
}

function getFirstMappedGeneratedLine(
  // deno-lint-ignore no-explicit-any
  map: any,
): number | undefined {
  if (Array.isArray(map.sections) && map.sections.length > 0) {
    return map.sections[0].offset.line + 1;
  }
  if (Array.isArray(map.sources) && map.sources.length > 0) {
    return 1;
  }
  return undefined;
}

// Minimal local types for esbuild plugin callbacks in tests.
// These are intentional subsets of esbuild's OnResolveArgs/OnResolveResult/
// OnLoadResult. Keep them in sync if esbuild's callback shapes change.
// We avoid importing esbuild types to keep tests cross-runtime compatible.
interface TestResolveArgs {
  path: string;
}

interface TestResolveResult {
  path: string;
  namespace: string;
}

interface TestLoadResult {
  contents: string;
  loader: string;
}

const kPlaceholderAppConfig = {
  buildDir: '/tmp',
  htmlPath: undefined,
  jsPath: '/dev/null',
};

import {
  DENO_ONLY_FILTER_TEST,
  SHARED_SERVER_FILTER_TEST,
} from './test-filter-constants.ts';

const kDebugServerReadyTimeoutMs = 15_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  // Why: Promise.race does not cancel the loser. Attach handlers directly so
  // real failures still surface, while late timeout losers stay observed.
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    void sleep(timeoutMs).then(() => {
      if (settled) return;
      settled = true;
      reject(new Error(timeoutMessage));
    });
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      },
    );
  });
}

/**
 * Tears down a debug server started by startDebugServerUntilReady.
 * Fails loudly if shutdown does not complete so resource leaks stay visible.
 */
async function cleanupDebugServer(
  stopServer: (() => Promise<void>) | undefined,
  runPromise: Promise<void> | undefined,
): Promise<void> {
  // Collect all errors so none mask another:
  //   stop(), runPromise observation, stopBackgroundCompiler.
  const errors: unknown[] = [];
  try {
    try {
      await stopServer?.();
    } catch (err) {
      errors.push(err);
    }
    if (runPromise) {
      try {
        await withTimeout(
          runPromise,
          2_000,
          'Timed out waiting for startDebugServer() to shut down cleanly.',
        );
      } catch (err) {
        errors.push(err);
      }
    }
  } finally {
    try {
      await stopBackgroundCompiler();
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new Error(
      `Cleanup failed with ${errors.length} errors: ${
        errors.map((e) => String(e)).join('; ')
      }`,
    );
  }
}

async function startDebugServerUntilReady(
  options: Parameters<typeof startDebugServer>[0],
): Promise<{
  serverUrl: string;
  runPromise: Promise<void>;
  stopServer: () => Promise<void>;
}> {
  let resolveReady!: (value: {
    serverUrl: string;
    stopServer: () => Promise<void>;
  }) => void;
  let rejectReady!: (reason?: unknown) => void;
  const readyPromise = new Promise<{
    serverUrl: string;
    stopServer: () => Promise<void>;
  }>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const runPromise = startDebugServer({
    ...options,
    openBrowser: options.openBrowser ?? false,
    async onReady(session) {
      await options.onReady?.(session);
      resolveReady({
        serverUrl: session.url,
        stopServer: session.stop,
      });
    },
  });
  // Forward startup rejections that fire before onReady to the readyPromise.
  void runPromise.catch(rejectReady);
  const ready = await withTimeout(
    readyPromise,
    kDebugServerReadyTimeoutMs,
    'Timed out waiting for startDebugServer() to start listening.',
  );
  return {
    serverUrl: ready.serverUrl,
    runPromise,
    stopServer: ready.stopServer,
  };
}

async function waitForAssetText(
  url: string,
  expectedText: string,
  timeoutMs = kDebugServerReadyTimeoutMs,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  let lastStatus: number | undefined;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      lastStatus = response.status;
      lastText = await response.text();
      if (response.ok && lastText.includes(expectedText)) {
        return lastText;
      }
    } catch {
      lastStatus = undefined;
    }
    await sleep(100);
  }
  throw new Error(
    `Timed out waiting for ${url} to contain ${
      JSON.stringify(expectedText)
    }. ` +
      `Last response: ${
        lastStatus === undefined
          ? 'no successful response'
          : `status ${lastStatus}`
      }, ` +
      `body preview: "${lastText.slice(0, 200)}"`,
  );
}

// --- Shared test helpers for cli() timeout behavior ---

function makeTimeoutTest(
  name: string,
  cmd: string,
  timeoutMs: number,
): (ctx: TestSuite) => Promise<void> {
  return async (ctx: TestSuite) => {
    const dir = await ctx.tempDir('cli-timeout');
    const scriptPath = path.join(dir, 'script.js');
    await writeTextFile(scriptPath, 'setInterval(() => {}, 1000)');
    await withLogCapture(async (captured) => {
      const cliArgs: (string | CliOptions)[] = cmd === 'deno'
        ? ['run', scriptPath, { timeout: timeoutMs }]
        : [scriptPath, { timeout: timeoutMs }];
      const cliResult = await cli(cmd, ...cliArgs);
      assertEquals(
        cliResult.exitCode,
        124,
        'timed out cli() must return 124',
      );
      assertTrue(
        cliResult.result.startsWith('Process timed out after'),
        'cli() timeout result must start with "Process timed out after"',
      );
      const warnings = captured.filter((e) => e.severity === 'WARNING');
      assertEquals(
        warnings.length,
        1,
        `${name} cli timeout should emit one warning log`,
      );
      const message = warnings[0].message ?? '';
      assertTrue(
        /^CLI subprocess timed out after \d+ms: /.test(message),
        `${name} cli timeout warning must use the generic timeout prefix`,
      );
      assertTrue(
        !message.includes('(Deno)') && !message.includes('SIGTERM') &&
          !message.includes('SIGKILL') && !message.includes('taskkill'),
        `${name} cli timeout warning must not leak runtime kill details`,
      );
    });
  };
}

function makeNormalTest(
  cmd: string,
): (ctx: TestSuite) => Promise<void> {
  return async (ctx: TestSuite) => {
    const dir = await ctx.tempDir('cli-normal');
    const scriptPath = path.join(dir, 'script.js');
    await writeTextFile(scriptPath, 'console.log("hello")');
    await withLogCapture(async (captured) => {
      const cliArgs: (string | CliOptions)[] = cmd === 'deno'
        ? ['run', scriptPath]
        : [scriptPath];
      const { result, exitCode } = await cli(cmd, ...cliArgs);
      assertEquals(exitCode, 0, 'normal cli() must return exit code 0');
      assertEquals(
        result.trim(),
        'hello',
        'normal cli() must capture stdout',
      );
      assertEquals(
        captured.filter((e) => e.severity === 'WARNING').length,
        0,
        'non-timeout cli() must not emit timeout warnings',
      );
    });
  };
}

function makeOrphanTest(
  cmd: string,
  code: (sentinel: string) => string,
  suffix: string,
): (ctx: TestSuite) => Promise<void> {
  return async (ctx: TestSuite) => {
    const dir = await ctx.tempDir(`cli-timeout-kill-${suffix}`);
    const sentinel = path.join(dir, 'sentinel');
    const scriptPath = path.join(dir, 'script.js');
    await writeTextFile(scriptPath, code(sentinel));
    // Subprocess schedules a file write at 5s — well past the 200ms timeout.
    // The 25x margin (200ms timeout vs 5000ms sentinel write) ensures the
    // direct timed-out subprocess cannot reach its delayed callback before
    // cli() returns, even under CI load.
    const cliArgs: (string | CliOptions)[] = cmd === 'deno'
      ? ['run', scriptPath, { timeout: 200 }]
      : [scriptPath, { timeout: 200 }];
    const { exitCode } = await cli(cmd, ...cliArgs);
    assertEquals(exitCode, 124, 'timeout must produce exit code 124');
    assertFalse(
      await pathExists(sentinel),
      'timeout must prevent the delayed sentinel write before cli() returns',
    );
  };
}

export default function setupCliCompileTests() {
  TEST(
    'CLI-Compile',
    'getCachedImport shares one in-flight import across concurrent callers',
    async () => {
      const state: ImportCacheState<string> = {};
      let importerCalls = 0;
      let resolveImport!: (value: string) => void;
      const importer = () => {
        importerCalls++;
        return new Promise<string>((resolve) => {
          resolveImport = resolve;
        });
      };

      const first = getCachedImport(state, importer);
      const second = getCachedImport(state, importer);
      // Identity check: the observable contract is that concurrent callers get
      // the same promise, not just the same resolved value after the fact.
      assertTrue(
        first === second,
        'concurrent callers must receive the same promise object',
      );

      resolveImport('ok');
      assertEquals(await first, 'ok');
      assertEquals(await second, 'ok');
      assertEquals(importerCalls, 1, 'importer must only be invoked once');
    },
  );

  TEST(
    'CLI-Compile',
    'getCachedImport clears rejected imports so later calls can retry',
    async () => {
      const state: ImportCacheState<string> = {};
      let importerCalls = 0;

      await assertThrows(
        () =>
          getCachedImport(state, async () => {
            importerCalls++;
            throw new Error(`boom-${importerCalls}`);
          }),
        Error,
        'boom-1',
      );
      assertEquals(
        state.promise,
        undefined,
        'failed imports must not poison later retries',
      );

      const value = await getCachedImport(state, async () => {
        importerCalls++;
        return `ok-${importerCalls}`;
      });
      assertEquals(value, 'ok-2');
      assertEquals(importerCalls, 2, 'retry must perform a new import');
    },
  );

  TEST(
    'CLI-Compile',
    'resetImportState clears cache before awaiting the prior import',
    async () => {
      const state: ImportCacheState<string> = {};
      let importerCalls = 0;
      let rejectImport!: (reason?: unknown) => void;

      const first = getCachedImport(state, () => {
        importerCalls++;
        return new Promise<string>((_resolve, reject) => {
          rejectImport = reject;
        });
      });
      const pending = resetImportState(state);
      assertExists(pending, 'resetImportState must return the prior import');
      assertEquals(
        state.promise,
        undefined,
        'resetImportState must clear cache immediately',
      );

      rejectImport(new Error('boom'));
      await assertThrows(() => pending, Error, 'boom');
      await assertThrows(() => first, Error, 'boom');

      const retried = await getCachedImport(state, async () => {
        importerCalls++;
        return 'ok';
      });
      assertEquals(retried, 'ok');
      assertEquals(importerCalls, 2, 'retry must start a fresh import');
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer rejects unsupported runtimes before startup side effects',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-unsupported-runtime');
      const config = getGoatConfig();
      const originalDebug = config.debug;
      let setupCalled = false;

      try {
        await withTestRuntimeId('browser', async () => {
          await assertThrows(
            async () => {
              await startDebugServer({
                buildDir: dir,
                jsPath: path.join(dir, 'entry.ts'),
                path: path.join(dir, 'server-data'),
                setup: () => {
                  setupCalled = true;
                },
              });
            },
            Error,
            'startDebugServer() is only supported in Deno or Node.js.',
          );
          assertFalse(
            setupCalled,
            'startDebugServer must fail before running setup on unsupported runtimes',
          );
          assertEquals(
            config.debug,
            originalDebug,
            'startDebugServer must not leak debug mode on unsupported runtimes',
          );
        });
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'createBuildContext rejects unsupported runtimes before starting esbuild',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-ctx-unsupported-runtime');
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];

      try {
        await withTestRuntimeId('browser', async () => {
          await assertThrows(
            async () => {
              await createBuildContext(entryPoints);
            },
            Error,
            'createBuildContext() is only supported in Deno or Node.js.',
          );
        });
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    SHARED_SERVER_FILTER_TEST,
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-ctx-shared');
      const cssPath = path.join(dir, 'style.css');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(cssPath, ':root { --shared-build-ctx: 1; }');
      await writeTextFile(entryPath, `import './style.css';\nexport {};\n`);
      const entryPoints = [{ in: entryPath, out: APP_ENTRY_POINT }];
      const rebuildCtx = await createBuildContext(entryPoints);
      try {
        const assets = await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: entryPath,
        });
        assertExists(
          assets['/app.js'],
          'Debug build context must emit /app.js on server runtimes',
        );
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes('--shared-build-ctx'),
          'Debug build context must bundle imported CSS on server runtimes',
        );
      } finally {
        rebuildCtx.close();
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer serves bundled JS and CSS with esbuildPlugins on server runtimes',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-shared-assets');
      const cssPath = path.join(dir, 'style.css');
      const entryPath = path.join(dir, 'entry.ts');
      const serverPath = path.join(dir, 'server-data');
      const pluginSentinel = 'debug-server-plugin-sentinel';
      const { domain, setPort } = createTestDomainConfig();
      let setupCalled = false;
      let serverRef: Server<Schema> | undefined;
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;
      const testPlugin: BuildPluginLike = {
        name: 'debug-server-test-plugin',
        setup(build) {
          build.onResolve(
            { filter: /^testplugin:/ },
            (args: TestResolveArgs): TestResolveResult => ({
              path: args.path,
              namespace: 'testplugin',
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: 'testplugin' },
            (): TestLoadResult => ({
              contents: `export const __sentinel__ = ${
                JSON.stringify(pluginSentinel)
              };`,
              loader: 'js',
            }),
          );
        },
      };
      await writeTextFile(cssPath, ':root { --debug-server-css: 1; }');
      await writeTextFile(
        entryPath,
        `import './style.css';\nimport { __sentinel__ } from 'testplugin:sentinel';\nexport const x = __sentinel__;\n`,
      );

      try {
        const session = await startDebugServerUntilReady({
          buildDir: dir,
          jsPath: entryPath,
          path: serverPath,
          orgId: 'test-org',
          port: 0,
          domain,
          esbuildPlugins: [testPlugin],
          setup(server) {
            setupCalled = true;
            serverRef = server;
          },
        });
        stopServer = session.stopServer;
        runPromise = session.runPromise;

        assertTrue(
          setupCalled,
          'startDebugServer must run setup before serving requests',
        );
        assertExists(
          serverRef?.port,
          'debug server must publish the assigned port',
        );
        // setPort must be called after server start; domain resolution must
        // be lazy (per-request) -- see createTestDomainConfig closure semantics.
        setPort(serverRef.port);

        const jsResponse = await fetch(`${session.serverUrl}/app.js`);
        assertTrue(
          jsResponse.ok,
          'startDebugServer must serve /app.js on server runtimes',
        );
        const js = await jsResponse.text();
        assertTrue(
          js.includes(pluginSentinel),
          'startDebugServer must apply esbuildPlugins on server runtimes',
        );

        const cssResponse = await fetch(`${session.serverUrl}/index.css`);
        assertTrue(
          cssResponse.ok,
          'startDebugServer must serve /index.css on server runtimes',
        );
        const css = await cssResponse.text();
        assertTrue(
          css.includes('--debug-server-css'),
          'startDebugServer must serve CSS imported from JS on server runtimes',
        );

        // Verify the server stays healthy beyond initial readiness.
        // Retry briefly to accommodate CI timing variation.
        let followupOk = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await fetch(`${session.serverUrl}/app.js`);
          if (r.ok) {
            followupOk = true;
            break;
          }
          await sleep(50);
        }
        assertTrue(
          followupOk,
          'startDebugServer must stay healthy after initial readiness',
        );
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer onReady can stop startup before browser launch',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-onready-stop');
      const entryPath = path.join(dir, 'entry.ts');
      const runtime = getRuntime() as {
        id: 'deno' | 'node' | 'browser';
      };
      const { domain, setPort } = createTestDomainConfig();
      let openBrowserCalls = 0;
      let sessionUrl = '';

      await writeTextFile(entryPath, 'export const ready = true;\n');
      const configPath = path.join(
        dir,
        runtime.id === 'node' ? 'package.debug.json' : 'deno.debug.json',
      );
      await writeTextFile(
        configPath,
        JSON.stringify({
          name: 'debug-server-onready-stop',
          version: '1.0.0',
        }) +
          '\n',
      );

      try {
        await withTestOpenBrowser(async () => {
          openBrowserCalls += 1;
          throw new Error('openBrowser should be skipped after onReady stop()');
        }, async () => {
          await startDebugServer({
            buildDir: dir,
            jsPath: entryPath,
            path: path.join(dir, 'server-data'),
            port: 0,
            domain,
            ...(runtime.id === 'node'
              ? { packageJson: configPath }
              : { denoJson: configPath }),
            async onReady(session) {
              sessionUrl = session.url;
              assertExists(
                session.server.port,
                'onReady must expose the started server instance',
              );
              setPort(session.server.port);
              await session.stop();
              await session.stop();
            },
          });
          assertTrue(
            sessionUrl.startsWith('http://localhost:'),
            'onReady must expose the final local URL before shutdown',
          );
          assertEquals(
            openBrowserCalls,
            0,
            'startDebugServer must skip browser launch once shutdown has started',
          );
        });
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer opens the browser by default after reporting readiness',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-open-browser-default');
      const entryPath = path.join(dir, 'entry.ts');
      const runtime = getRuntime() as {
        id: 'deno' | 'node' | 'browser';
      };
      const { domain } = createTestDomainConfig();
      let stopServer: (() => Promise<void>) | undefined;
      let openBrowserUrl = '';
      let resolveBrowserOpened!: () => void;
      const browserOpened = new Promise<void>((resolve) => {
        resolveBrowserOpened = resolve;
      });
      let runPromise: Promise<void> | undefined;

      await writeTextFile(entryPath, 'export const ready = true;\n');
      const configPath = path.join(
        dir,
        runtime.id === 'node' ? 'package.debug.json' : 'deno.debug.json',
      );
      await writeTextFile(
        configPath,
        JSON.stringify({
          name: 'debug-server-open-browser-default',
          version: '1.0.0',
        }) + '\n',
      );

      try {
        await withTestOpenBrowser(async (url) => {
          openBrowserUrl = url;
          resolveBrowserOpened();
        }, async () => {
          let resolveReady!: (
            value: { stop: () => Promise<void>; url: string },
          ) => void;
          const readyPromise = new Promise<{
            stop: () => Promise<void>;
            url: string;
          }>((resolve) => {
            resolveReady = resolve;
          });
          runPromise = startDebugServer({
            buildDir: dir,
            jsPath: entryPath,
            path: path.join(dir, 'server-data'),
            port: 0,
            domain,
            ...(runtime.id === 'node'
              ? { packageJson: configPath }
              : { denoJson: configPath }),
            onReady(session) {
              resolveReady({ stop: session.stop, url: session.url });
            },
          });
          const ready = await withTimeout(
            readyPromise,
            kDebugServerReadyTimeoutMs,
            'Timed out waiting for default-browser startDebugServer() readiness.',
          );
          stopServer = ready.stop;
          await withTimeout(
            browserOpened,
            2_000,
            'Timed out waiting for startDebugServer() to open the browser by default.',
          );
          assertEquals(
            openBrowserUrl,
            ready.url,
            'startDebugServer must open the final local URL when openBrowser is omitted',
          );
        });
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer openBrowser false keeps embedded runs headless',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-headless');
      const entryPath = path.join(dir, 'entry.ts');
      const runtime = getRuntime() as {
        id: 'deno' | 'node' | 'browser';
      };
      const { domain } = createTestDomainConfig();
      let openBrowserCalls = 0;
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;

      await writeTextFile(entryPath, 'export const ready = true;\n');
      const configPath = path.join(
        dir,
        runtime.id === 'node' ? 'package.debug.json' : 'deno.debug.json',
      );
      await writeTextFile(
        configPath,
        JSON.stringify({ name: 'debug-server-headless', version: '1.0.0' }) +
          '\n',
      );

      try {
        await withTestOpenBrowser(async () => {
          openBrowserCalls += 1;
        }, async () => {
          const ready = await startDebugServerUntilReady({
            buildDir: dir,
            jsPath: entryPath,
            path: path.join(dir, 'server-data'),
            port: 0,
            domain,
            openBrowser: false,
            ...(runtime.id === 'node'
              ? { packageJson: configPath }
              : { denoJson: configPath }),
          });
          stopServer = ready.stopServer;
          runPromise = ready.runPromise;
          assertTrue(
            ready.serverUrl.startsWith('http://localhost:'),
            'headless startDebugServer must still report its local URL',
          );
          assertEquals(
            openBrowserCalls,
            0,
            'openBrowser false must suppress automatic browser launch',
          );
        });
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer reports the chosen server origin for custom domains',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-custom-origin');
      const entryPath = path.join(dir, 'entry.ts');
      const runtime = getRuntime();
      const customDomain = {
        resolveOrg: (_orgId: string) => 'https://debug.example:0/test-org',
        resolveDomain: (_url: string) => 'test-org',
      };
      let sessionUrl = '';

      await writeTextFile(entryPath, 'export const ready = true;\n');
      const configPath = path.join(
        dir,
        runtime.id === 'node' ? 'package.debug.json' : 'deno.debug.json',
      );
      await writeTextFile(
        configPath,
        JSON.stringify({
          name: 'debug-server-custom-origin',
          version: '1.0.0',
        }) + '\n',
      );

      await startDebugServer({
        buildDir: dir,
        jsPath: entryPath,
        path: path.join(dir, 'server-data'),
        port: 0,
        domain: customDomain,
        openBrowser: false,
        ...(runtime.id === 'node'
          ? { packageJson: configPath }
          : { denoJson: configPath }),
        async onReady(session) {
          sessionUrl = session.url;
          assertExists(
            session.server.port,
            'onReady must expose the started server port for custom domains',
          );
          await session.stop();
        },
      });

      assertTrue(
        /^http:\/\/debug\.example:\d+$/.test(sessionUrl),
        `startDebugServer must expose the chosen server origin without path routing, got ${sessionUrl}`,
      );
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer onReady stop stays clean when watchDir is configured',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-watch-onready-stop');
      const entryPath = path.join(dir, 'entry.ts');
      const runtime = getRuntime() as {
        id: 'deno' | 'node' | 'browser';
      };
      const { domain } = createTestDomainConfig();
      let openBrowserCalls = 0;
      let sessionUrl = '';

      await writeTextFile(entryPath, 'export const ready = true;\n');
      const configPath = path.join(
        dir,
        runtime.id === 'node' ? 'package.debug.json' : 'deno.debug.json',
      );
      await writeTextFile(
        configPath,
        JSON.stringify({
          name: 'debug-server-watch-onready-stop',
          version: '1.0.0',
        }) + '\n',
      );

      try {
        await withTestOpenBrowser(async () => {
          openBrowserCalls += 1;
        }, async () => {
          await startDebugServer({
            buildDir: dir,
            jsPath: entryPath,
            path: path.join(dir, 'server-data'),
            watchDir: dir,
            port: 0,
            domain,
            ...(runtime.id === 'node'
              ? { packageJson: configPath }
              : { denoJson: configPath }),
            async onReady(session) {
              sessionUrl = session.url;
              await session.stop();
            },
          });
          assertTrue(
            sessionUrl.startsWith('http://localhost:'),
            'onReady must still expose the local URL before a watched startup shuts down',
          );
          assertEquals(
            openBrowserCalls,
            0,
            'watchDir startup stopped from onReady must not open the browser',
          );
        });
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer rebuilds watched CSS on server runtimes',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-watch-rebuild');
      const cssPath = path.join(dir, 'style.css');
      const entryPath = path.join(dir, 'entry.ts');
      const { domain, setPort } = createTestDomainConfig();
      let serverRef: Server<Schema> | undefined;
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;

      await writeTextFile(cssPath, ':root { --debug-watch-v1: 1; }');
      await writeTextFile(entryPath, `import './style.css';\nexport {};\n`);

      try {
        const session = await startDebugServerUntilReady({
          buildDir: dir,
          jsPath: entryPath,
          path: path.join(dir, 'server-data'),
          watchDir: dir,
          orgId: 'test-org',
          port: 0,
          domain,
          setup(server) {
            serverRef = server;
          },
        });
        stopServer = session.stopServer;
        runPromise = session.runPromise;
        assertExists(
          serverRef?.port,
          'debug server must publish the assigned port',
        );
        setPort(serverRef.port);

        const cssUrl = `${session.serverUrl}/index.css`;
        const initialCss = await waitForAssetText(cssUrl, '--debug-watch-v1');
        assertTrue(
          initialCss.includes('--debug-watch-v1'),
          'startDebugServer must serve the initial watched CSS asset',
        );

        await writeTextFile(cssPath, ':root { --debug-watch-v2: 1; }');
        const rebuiltCss = await waitForAssetText(cssUrl, '--debug-watch-v2');
        assertTrue(
          rebuiltCss.includes('--debug-watch-v2'),
          'startDebugServer must rebuild watched CSS after file changes',
        );
        assertTrue(
          !rebuiltCss.includes('--debug-watch-v1'),
          'startDebugServer must stop serving stale CSS after rebuild',
        );
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer applies watchFilter and rebuild hooks in order',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-watch-filter-hooks');
      const cssPath = path.join(dir, 'generated.css');
      const entryPath = path.join(dir, 'entry.ts');
      const triggerPath = path.join(dir, 'trigger.txt');
      const ignoredPath = path.join(dir, 'ignored.txt');
      const { domain, setPort } = createTestDomainConfig();
      const hookOrder: string[] = [];
      let buildNumber = 0;
      let serverRef: Server<Schema> | undefined;
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;

      await writeTextFile(entryPath, `import './generated.css';\nexport {};\n`);
      await writeTextFile(triggerPath, 'initial');
      await writeTextFile(ignoredPath, 'initial');

      try {
        const session = await startDebugServerUntilReady({
          buildDir: dir,
          jsPath: entryPath,
          path: path.join(dir, 'server-data'),
          watchDir: dir,
          watchFilter: (p) => p.endsWith('trigger.txt'),
          orgId: 'test-org',
          port: 0,
          domain,
          setup(server) {
            serverRef = server;
          },
          async beforeBuild() {
            buildNumber++;
            hookOrder.push(`before-${buildNumber}`);
            await writeTextFile(
              cssPath,
              `:root { --debug-hook-v${buildNumber}: 1; }`,
            );
          },
          afterBuild() {
            hookOrder.push(`after-${buildNumber}`);
            return Promise.resolve();
          },
        });
        stopServer = session.stopServer;
        runPromise = session.runPromise;
        assertExists(serverRef?.port, 'debug server must publish a port');
        setPort(serverRef.port);

        const cssUrl = `${session.serverUrl}/index.css`;
        await waitForAssetText(cssUrl, '--debug-hook-v1');
        assertEquals(hookOrder, ['before-1', 'after-1']);

        await writeTextFile(ignoredPath, 'ignored change');
        await sleep(700);
        assertEquals(
          hookOrder,
          ['before-1', 'after-1'],
          'custom watchFilter=false changes must not rebuild',
        );

        await writeTextFile(triggerPath, 'rebuild');
        await waitForAssetText(cssUrl, '--debug-hook-v2');
        assertEquals(hookOrder, [
          'before-1',
          'after-1',
          'before-2',
          'after-2',
        ]);
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer default watch filter ignores tmp files',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-default-watch-filter');
      const entryPath = path.join(dir, 'entry.ts');
      const ignoredPath = path.join(dir, 'ignored.tmp');
      const { domain } = createTestDomainConfig();
      let beforeBuildCalls = 0;
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;

      await writeTextFile(entryPath, `export {};\n`);
      await writeTextFile(ignoredPath, 'initial');

      try {
        const session = await startDebugServerUntilReady({
          buildDir: dir,
          jsPath: entryPath,
          path: path.join(dir, 'server-data'),
          watchDir: dir,
          orgId: 'test-org',
          port: 0,
          domain,
          beforeBuild() {
            beforeBuildCalls++;
            return Promise.resolve();
          },
        });
        stopServer = session.stopServer;
        runPromise = session.runPromise;
        assertEquals(beforeBuildCalls, 1, 'initial build must run once');

        await writeTextFile(ignoredPath, 'ignored change');
        await sleep(700);
        assertEquals(
          beforeBuildCalls,
          1,
          'default watch filter must ignore .tmp changes',
        );
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer auto-selects the active runtime config file',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-config-parity');
      const jsPath = './tests/browser-failure-fixture.ts';
      const { domain, setPort } = createTestDomainConfig();
      const runtime = getRuntime();
      let serverRef: Server<Schema> | undefined;
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;
      let observedBuildInfo:
        | {
          appName: string | undefined;
          appVersion: string | undefined;
          debugBuild: boolean | undefined;
        }
        | undefined;

      await writeTextFile(
        path.join(dir, 'deno.json'),
        JSON.stringify({ name: 'debug-deno-app', version: '4.5.6' }) + '\n',
      );
      await writeTextFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'debug-node-app', version: '1.2.3' }) + '\n',
      );

      try {
        await withTestCWD(dir, async () => {
          const session = await startDebugServerUntilReady({
            buildDir: dir,
            jsPath,
            path: path.join(dir, 'server-data'),
            orgId: 'test-org',
            port: 0,
            domain,
            async setup(server) {
              serverRef = server;
              const services = await server.servicesForOrganization(
                'test-org',
              );
              observedBuildInfo = {
                appName: services.buildInfo.appName,
                appVersion: services.buildInfo.appVersion,
                debugBuild: services.buildInfo.debugBuild,
              };
            },
          });
          stopServer = session.stopServer;
          runPromise = session.runPromise;
          assertExists(
            serverRef?.port,
            'debug server must publish the assigned port',
          );
          setPort(serverRef.port);

          assertEquals(
            observedBuildInfo,
            runtime.id === 'node'
              ? {
                appName: 'debug-node-app',
                appVersion: '1.2.3',
                debugBuild: true,
              }
              : {
                appName: 'debug-deno-app',
                appVersion: '4.5.6',
                debugBuild: true,
              },
            'startDebugServer must derive buildInfo from the active runtime config file',
          );
        });
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer preserves file URL jsPath when effective cwd is overridden',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-file-url-js-path');
      const entryPath = path.join(dir, 'entry.ts');
      const jsPath = path.toFileUrl(entryPath).href;
      const { domain } = createTestDomainConfig();
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;

      await writeTextFile(
        entryPath,
        'globalThis.__debugFileUrl = "kept";\nexport {};\n',
      );
      await writeTextFile(
        path.join(dir, 'deno.json'),
        JSON.stringify({ name: 'debug-file-url-deno', version: '1.0.0' }) +
          '\n',
      );
      await writeTextFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'debug-file-url-node', version: '1.0.0' }) +
          '\n',
      );

      try {
        await withTestCWD(dir, async () => {
          const session = await startDebugServerUntilReady({
            buildDir: dir,
            jsPath,
            path: path.join(dir, 'server-data'),
            orgId: 'test-org',
            port: 0,
            domain,
          });
          stopServer = session.stopServer;
          runPromise = session.runPromise;

          const appJs = await waitForAssetText(
            `${session.serverUrl}/app.js`,
            '__debugFileUrl',
          );
          assertTrue(
            appJs.includes('__debugFileUrl'),
            'startDebugServer must bundle file:// jsPath entries without rewriting them as relative paths',
          );
        });
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer resolves relative jsPath against the real runtime cwd when effective cwd is overridden',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-relative-js-path');
      const jsPath = './tests/browser-failure-fixture.ts';
      const { domain } = createTestDomainConfig();
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;

      await writeTextFile(
        path.join(dir, 'deno.json'),
        JSON.stringify({ name: 'debug-relative-deno', version: '1.0.0' }) +
          '\n',
      );
      await writeTextFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'debug-relative-node', version: '1.0.0' }) +
          '\n',
      );

      try {
        await withTestCWD(dir, async () => {
          const session = await startDebugServerUntilReady({
            buildDir: dir,
            jsPath,
            path: path.join(dir, 'server-data'),
            orgId: 'test-org',
            port: 0,
            domain,
          });
          stopServer = session.stopServer;
          runPromise = session.runPromise;

          const appJs = await waitForAssetText(
            `${session.serverUrl}/app.js`,
            'intentional browser failure',
          );
          assertTrue(
            appJs.includes('intentional browser failure'),
            'startDebugServer must resolve relative jsPath values against the real runtime cwd instead of the test override cwd',
          );
        });
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer explicit config options override runtime defaults',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-config-override');
      const jsPath = './tests/browser-failure-fixture.ts';
      const { domain, setPort } = createTestDomainConfig();
      const runtime = getRuntime();
      let serverRef: Server<Schema> | undefined;
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;
      let observedBuildInfo:
        | {
          appName: string | undefined;
          appVersion: string | undefined;
        }
        | undefined;

      const defaultConfigPath = path.join(
        dir,
        runtime.id === 'node' ? 'package.json' : 'deno.json',
      );
      const overrideConfigPath = path.join(
        dir,
        runtime.id === 'node' ? 'package.override.json' : 'deno.override.json',
      );
      await writeTextFile(
        defaultConfigPath,
        JSON.stringify({ name: 'debug-default-app', version: '1.0.0' }) +
          '\n',
      );
      await writeTextFile(
        overrideConfigPath,
        JSON.stringify({ name: 'debug-override-app', version: '9.9.9' }) +
          '\n',
      );

      try {
        await withTestCWD(dir, async () => {
          const session = await startDebugServerUntilReady({
            buildDir: dir,
            jsPath,
            path: path.join(dir, 'server-data'),
            orgId: 'test-org',
            port: 0,
            domain,
            ...(getEffectiveRuntimeId() === 'node'
              ? { packageJson: overrideConfigPath }
              : { denoJson: overrideConfigPath }),
            async setup(server) {
              serverRef = server;
              const services = await server.servicesForOrganization(
                'test-org',
              );
              observedBuildInfo = {
                appName: services.buildInfo.appName,
                appVersion: services.buildInfo.appVersion,
              };
            },
          });
          stopServer = session.stopServer;
          runPromise = session.runPromise;
          assertExists(
            serverRef?.port,
            'debug server must publish the assigned port',
          );
          setPort(serverRef.port);

          assertEquals(
            observedBuildInfo,
            {
              appName: 'debug-override-app',
              appVersion: '9.9.9',
            },
            'startDebugServer must prefer explicit config overrides over runtime defaults',
          );
        });
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer fails clearly when the active runtime config file is missing',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-config-missing');
      const jsPath = './tests/browser-failure-fixture.ts';
      const runtime = getRuntime();
      const config = getGoatConfig();
      const originalDebug = config.debug;
      let setupCalled = false;

      const expectedConfigPath = path.join(
        dir,
        runtime.id === 'node' ? 'package.json' : 'deno.json',
      );
      try {
        await withTestCWD(dir, async () => {
          await assertThrows(
            async () => {
              await startDebugServer({
                buildDir: dir,
                jsPath,
                path: path.join(dir, 'server-data'),
                setup: () => {
                  setupCalled = true;
                },
              });
            },
            Error,
            `Config file not found at "${expectedConfigPath}". Provide ${
              getEffectiveRuntimeId() === 'node' ? 'packageJson' : 'denoJson'
            } or run from a directory containing one.`,
          );
          assertFalse(
            setupCalled,
            'startDebugServer must fail before running user setup when config is missing',
          );
          assertEquals(
            config.debug,
            originalDebug,
            'startDebugServer must not leak debug mode when config discovery fails',
          );
          await assertThrows(
            async () => {
              await startDebugServer({
                buildDir: dir,
                jsPath,
                path: path.join(dir, 'server-data'),
              });
            },
            Error,
            `Config file not found at "${expectedConfigPath}". Provide ${
              getEffectiveRuntimeId() === 'node' ? 'packageJson' : 'denoJson'
            } or run from a directory containing one.`,
          );
        });
      } finally {
        config.debug = originalDebug;
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer restores global state when startup fails before listening',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-startup-state-restore');
      const entryPath = path.join(dir, 'entry.ts');
      const config = getGoatConfig();
      const originalDebug = config.debug;
      const configPath = path.join(
        dir,
        getRuntime().id === 'node' ? 'package.debug.json' : 'deno.debug.json',
      );

      await writeTextFile(entryPath, 'export const ready = true;\n');
      await writeTextFile(
        configPath,
        JSON.stringify({
          name: 'debug-server-startup-state-restore',
          version: '1.0.0',
        }) + '\n',
      );

      try {
        await assertThrows(
          async () => {
            await startDebugServer({
              buildDir: dir,
              jsPath: entryPath,
              path: path.join(dir, 'server-data'),
              port: -1,
              ...(getRuntime().id === 'node'
                ? { packageJson: configPath }
                : { denoJson: configPath }),
            });
          },
          Error,
          'Invalid port number: -1',
        );
        assertEquals(
          config.debug,
          originalDebug,
          'startDebugServer must restore debug mode when startup fails before listening',
        );
        await assertThrows(
          async () => {
            await startDebugServer({
              buildDir: dir,
              jsPath: entryPath,
              path: path.join(dir, 'server-data'),
              port: -1,
              ...(getRuntime().id === 'node'
                ? { packageJson: configPath }
                : { denoJson: configPath }),
            });
          },
          Error,
          'Invalid port number: -1',
        );
      } finally {
        config.debug = originalDebug;
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer cleans up initialized services when listen fails',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-listen-failure');
      const entryPath = path.join(dir, 'entry.ts');
      const config = getGoatConfig();
      const originalDebug = config.debug;
      const configPath = path.join(
        dir,
        getRuntime().id === 'node' ? 'package.debug.json' : 'deno.debug.json',
      );
      const blocker = createHttpServer();
      let initializedServer: Server<Schema> | undefined;

      await writeTextFile(entryPath, 'export const ready = true;\n');
      await writeTextFile(
        configPath,
        JSON.stringify({
          name: 'debug-server-listen-failure',
          version: '1.0.0',
        }) +
          '\n',
      );

      try {
        await blocker.start(
          async () => new Response('busy', { status: 200 }),
          0,
        );
        const blockedPort = blocker.port;
        assertExists(blockedPort, 'blocker server must publish a port');

        let flushCallCount = 0;
        let closeCallCount = 0;
        let thrown: unknown;
        try {
          await withTimeout(
            startDebugServer({
              buildDir: dir,
              jsPath: entryPath,
              path: path.join(dir, 'server-data'),
              orgId: 'test-org',
              port: blockedPort,
              ...(getRuntime().id === 'node'
                ? { packageJson: configPath }
                : { denoJson: configPath }),
              async setup(server) {
                initializedServer = server;
                // Override flush/close to count calls and throw.
                // Throwing proves stop() handles cleanup errors
                // gracefully; counting proves cleanup actually ran.
                const services = await server.servicesForOrganization(
                  'test-org',
                );
                const db = services.db;
                db.flushAll = async () => {
                  flushCallCount++;
                  throw new Error('test-flush-failure');
                };
                db.close = async () => {
                  closeCallCount++;
                  throw new Error('test-close-failure');
                };
              },
            }),
            5_000,
            'Timed out waiting for startDebugServer() to fail after listen error.',
          );
        } catch (err) {
          thrown = err;
        }

        // cleanup() ran stop() which called flushAll and close despite
        // listen failure -- the core invariant.
        assertTrue(
          flushCallCount >= 1,
          `stop() must call flushAll during listen-failure cleanup (got ${flushCallCount})`,
        );
        assertTrue(
          closeCallCount >= 1,
          `stop() must call close during listen-failure cleanup (got ${closeCallCount})`,
        );
        const flushCallsAfterFailure = flushCallCount;
        const closeCallsAfterFailure = closeCallCount;
        await initializedServer?.stop();
        await initializedServer?.stop();
        assertEquals(
          flushCallCount,
          flushCallsAfterFailure,
          'Server.stop() must be a no-op after listen-failure cleanup',
        );
        assertEquals(
          closeCallCount,
          closeCallsAfterFailure,
          'Server.stop() must stay idempotent after listen-failure cleanup',
        );
        // The thrown error is the listen error, not a cleanup error,
        // proving stop() swallows flush/close failures.
        // Check structured error identity (name/code), not message text,
        // which varies by platform ("address already in use" on Unix vs
        // "Only one usage of each socket address…" on Windows under Deno).
        assertTrue(
          thrown instanceof Error && (
            thrown.name === 'AddrInUse' ||
            (thrown as any).code === 'EADDRINUSE'
          ),
          `startDebugServer must reject with listen error, got: ${thrown}`,
        );
        assertEquals(
          config.debug,
          originalDebug,
          'startDebugServer must restore debug mode after listen failure cleanup',
        );
      } finally {
        config.debug = originalDebug;
        blocker.stop();
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer rejects concurrent calls via singleton guard',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-concurrent-guard');
      const entryPath = path.join(dir, 'entry.ts');
      const runtime = getRuntime() as {
        id: 'deno' | 'node' | 'browser';
      };
      const config = getGoatConfig();
      const originalDebug = config.debug;
      const { domain } = createTestDomainConfig();
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;

      await writeTextFile(entryPath, 'export const ready = true;\n');
      const configPath = path.join(
        dir,
        runtime.id === 'node' ? 'package.json' : 'deno.json',
      );
      await writeTextFile(
        configPath,
        JSON.stringify({
          name: 'debug-server-concurrent-guard',
          version: '1.0.0',
        }) + '\n',
      );

      try {
        const session = await startDebugServerUntilReady({
          buildDir: dir,
          jsPath: entryPath,
          path: path.join(dir, 'server-data'),
          port: 0,
          domain,
          openBrowser: false,
          ...(runtime.id === 'node'
            ? { packageJson: configPath }
            : { denoJson: configPath }),
        });
        stopServer = session.stopServer;
        runPromise = session.runPromise;

        // A second concurrent start must fail with the guard message.
        await assertThrows(
          async () => {
            await startDebugServer({
              buildDir: dir,
              jsPath: entryPath,
              path: path.join(dir, 'server-data'),
              port: 0,
              domain,
              ...(runtime.id === 'node'
                ? { packageJson: configPath }
                : { denoJson: configPath }),
            });
          },
          Error,
          'startDebugServer is already running. Only one instance at a time is supported.',
        );

        // The first instance must still be functional and state unaffected.
        assertEquals(
          config.debug,
          true,
          'first debug server must still have debug=true after guard prevents re-entry',
        );
      } finally {
        config.debug = originalDebug;
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer logs WARNING on rebuild failure during watch',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-watch-rebuild-failure');
      const cssPath = path.join(dir, 'style.css');
      const entryPath = path.join(dir, 'entry.ts');
      const { domain, setPort } = createTestDomainConfig();
      let serverRef: Server<Schema> | undefined;
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;

      await writeTextFile(cssPath, ':root { --rebuild-fail-v1: 1; }');
      await writeTextFile(entryPath, `import './style.css';\nexport {};\n`);

      try {
        const session = await startDebugServerUntilReady({
          buildDir: dir,
          jsPath: entryPath,
          path: path.join(dir, 'server-data'),
          watchDir: dir,
          orgId: 'test-org',
          port: 0,
          domain,
          setup(server) {
            serverRef = server;
          },
        });
        stopServer = session.stopServer;
        runPromise = session.runPromise;
        assertExists(
          serverRef?.port,
          'debug server must publish the assigned port',
        );
        setPort(serverRef.port);

        // Verify initial build succeeded.
        const cssUrl = `${session.serverUrl}/index.css`;
        await waitForAssetText(cssUrl, '--rebuild-fail-v1');

        // Write invalid CSS that will cause esbuild to fail.
        // Raw invalid CSS doesn't fail esbuild; introduce a broken import
        // by overwriting the entry point with a reference to a missing module.
        const captured = await withLogCapture(async (logs) => {
          await writeTextFile(
            entryPath,
            `import './style.css';\nimport './nonexistent-module.ts';\nexport {};\n`,
          );
          // Poll for the watcher to detect the change and the rebuild to fail.
          for (let i = 0; i < 50; i++) {
            if (
              logs.some((e) =>
                e.severity === 'WARNING' &&
                typeof e.message === 'string' &&
                e.message.includes('Build failed')
              )
            ) break;
            await sleep(100);
          }
          return logs;
        });

        const warningLogs = captured.filter(
          (e) =>
            e.severity === 'WARNING' &&
            typeof e.message === 'string' &&
            e.message.includes('Build failed'),
        );
        assertTrue(
          warningLogs.length > 0,
          `watch rebuild must log WARNING on build failure, got: ${
            JSON.stringify(captured.map((e) => e.message))
          }`,
        );
      } finally {
        await cleanupDebugServer(stopServer, runPromise);
      }
    },
  );

  TEST(
    'CLI-Compile',
    'startDebugServer cleanup stop releases server and resolves cleanly',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('debug-server-signal-cleanup');
      const entryPath = path.join(dir, 'entry.ts');
      const { domain, setPort } = createTestDomainConfig();
      let serverRef: Server<Schema> | undefined;
      let stopServer: (() => Promise<void>) | undefined;
      let runPromise: Promise<void> | undefined;
      let setupCalled = false;

      await writeTextFile(entryPath, 'export const ready = true;\n');
      const configPath = path.join(
        dir,
        getRuntime().id === 'node' ? 'package.json' : 'deno.json',
      );
      await writeTextFile(
        configPath,
        JSON.stringify({
          name: 'debug-server-signal-cleanup',
          version: '1.0.0',
        }) + '\n',
      );

      try {
        const session = await startDebugServerUntilReady({
          buildDir: dir,
          jsPath: entryPath,
          path: path.join(dir, 'server-data'),
          orgId: 'test-org',
          port: 0,
          domain,
          setup(server) {
            setupCalled = true;
            serverRef = server;
          },
        });
        stopServer = session.stopServer;
        runPromise = session.runPromise;
        assertTrue(setupCalled, 'setup must have been called');
        assertExists(
          serverRef?.port,
          'debug server must publish the assigned port',
        );
        setPort(serverRef.port);

        // The cleanup path that signal handlers invoke is the same stop()
        // function exposed via onReady. Verify it works end-to-end:
        // server serves before stop, resolves cleanly after stop.
        const jsBefore = await fetch(`${session.serverUrl}/app.js`);
        assertTrue(jsBefore.ok, 'server must serve assets before stop');

        // stop() is the same function signal handlers call via cleanup().
        await stopServer();

        // runPromise must resolve (not hang) after stop.
        await withTimeout(
          runPromise,
          2_000,
          'runPromise must resolve after cleanup-style stop()',
        );

        // Verify server is no longer serving.
        let stillServing = false;
        try {
          const r = await fetch(`${session.serverUrl}/app.js`);
          stillServing = r.ok;
        } catch {
          // Expected: connection refused.
        }
        assertFalse(
          stillServing,
          'server must stop serving after cleanup-style stop()',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'compile resolves file:// serverEntry inputs before public validation errors',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('compile-file-url-entry');
      const missingEntry = path.join(dir, 'missing-server.ts');
      const expectedEntry = /^[A-Za-z]:[\\/]/.test(missingEntry)
        ? missingEntry.replaceAll('\\', '/')
        : missingEntry;
      await assertThrows(
        async () => {
          await compile({
            ...kPlaceholderAppConfig,
            buildDir: path.join(dir, 'build'),
            serverEntry: path.toFileUrl(missingEntry).href,
          });
        },
        Error,
        `Server entry not found: ${expectedEntry}`,
      );
    },
  );

  TEST(
    'CLI-Compile',
    'compile resolves UNC file:// serverEntry inputs before public validation errors',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('compile-unc-file-url-entry');
      await assertThrows(
        async () => {
          await compile({
            ...kPlaceholderAppConfig,
            buildDir: path.join(dir, 'build'),
            serverEntry: 'file://server/share/missing-server.ts',
          });
        },
        Error,
        'Server entry not found: //server/share/missing-server.ts',
      );
    },
  );

  TEST(
    'CLI-Compile',
    'compile forwards esbuildPlugins before config validation',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('compile-esbuild-plugins');
      const runtime = getRuntime();
      const serverEntry = path.join(dir, 'server.ts');
      const clientEntry = path.join(dir, 'client.ts');
      const markerPath = path.join(dir, 'plugin-marker.txt');
      const missingConfigPath = path.join(
        dir,
        runtime.id === 'node' ? 'missing-package.json' : 'missing-deno.json',
      );
      await writeTextFile(serverEntry, 'export {};\n');
      await writeTextFile(
        clientEntry,
        `import { __sentinel__ } from 'testplugin:sentinel';\nexport const x = __sentinel__;\n`,
      );
      const plugin: BuildPluginLike = {
        name: 'compile-forwarding-plugin',
        setup(build) {
          build.onStart(async () => {
            await writeTextFile(markerPath, 'seen\n');
          });
          build.onResolve(
            { filter: /^testplugin:/ },
            (args: TestResolveArgs): TestResolveResult => ({
              path: args.path,
              namespace: 'testplugin',
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: 'testplugin' },
            (): TestLoadResult => ({
              contents: 'export const __sentinel__ = "compile-plugin";',
              loader: 'js',
            }),
          );
        },
      };

      try {
        await assertThrows(
          async () => {
            await compile({
              buildDir: path.join(dir, 'build'),
              serverEntry,
              jsPath: clientEntry,
              esbuildPlugins: [plugin],
              ...(runtime.id === 'node'
                ? { packageJson: missingConfigPath }
                : { denoJson: missingConfigPath }),
            });
          },
          Error,
          `Config file not found at "${missingConfigPath}"`,
        );
        assertTrue(
          await pathExists(markerPath),
          'compile() must forward esbuildPlugins into the client bundling path before config validation',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'signExecutable warns and ignores signing on unsupported platforms',
    async (ctx: TestSuite) => {
      const runtime = getRuntime();
      const osName = runtime.getOS();
      if (osName === 'darwin' || osName === 'windows') return;

      const dir = await ctx.tempDir('sign-unsupported-platform');
      const execPath = path.join(dir, 'app');
      await writeTextFile(execPath, 'stub');

      await withLogCapture(async (captured) => {
        await signExecutable(execPath, { windows: { thumbprint: 'abc' } });
        const warning = captured.find((e) =>
          e.severity === 'WARNING' &&
          e.message?.includes(`Code signing is not supported on ${osName}`)
        );
        assertExists(warning, 'unsupported signing should emit a warning');
        assertEquals(
          warning?.error,
          undefined,
          'unsupported-platform warning should not be misclassified as an error code',
        );
      });
    },
  );

  TEST(
    'CLI-Compile',
    'should compute target OS/arch correctly',
    async () => {
      // Test that targetFromOSArch works with explicit values
      assertEquals(
        targetFromOSArch('mac', 'arm64'),
        'mac-arm64',
        'Should return mac-arm64',
      );
      assertEquals(
        targetFromOSArch('linux', 'x64'),
        'linux-x64',
        'Should return linux-x64',
      );
      assertEquals(
        targetFromOSArch('windows', 'x64'),
        'windows-x64',
        'Should return windows-x64',
      );

      // Test auto-detection (should return current platform)
      const detected = targetFromOSArch();
      assertTrue(
        detected.includes('-'),
        `Detected target should have OS-arch format: ${detected}`,
      );
    },
  );

  TEST(
    'CLI-Compile',
    'should reject unsupported denoTarget windows-arm64',
    async () => {
      assertThrows(
        () => denoTarget('windows', 'arm64'),
        'denoTarget should throw for windows-arm64',
      );
    },
  );

  TEST(
    'CLI-Compile',
    'should map denoTarget for all supported platforms',
    async () => {
      assertEquals(denoTarget('mac', 'x64'), 'x86_64-apple-darwin');
      assertEquals(denoTarget('mac', 'arm64'), 'aarch64-apple-darwin');
      assertEquals(denoTarget('linux', 'x64'), 'x86_64-unknown-linux-gnu');
      assertEquals(denoTarget('linux', 'arm64'), 'aarch64-unknown-linux-gnu');
      assertEquals(denoTarget('windows', 'x64'), 'x86_64-pc-windows-msvc');
    },
  );

  TEST(
    'CLI-Compile',
    'goatEntryPoints should match deno.json exports',
    async () => {
      const denoJsonPath = path.join(getRuntime().getCWD(), 'deno.json');
      const content = await readTextFile(denoJsonPath);
      assertExists(content, 'deno.json should be readable');
      const denoJson = JSON.parse(content);
      assertExists(denoJson.exports, 'deno.json should have exports field');
      const exports = denoJson.exports as Record<string, string>;

      // Every goatEntryPoints key should map to a deno.json export
      for (const [suffix, file] of Object.entries(goatEntryPoints)) {
        const exportKey = suffix === '' ? '.' : '.' + suffix;
        assertEquals(
          exports[exportKey],
          './' + file,
          `deno.json export "${exportKey}" should match goatEntryPoints`,
        );
      }

      // Every deno.json export should have a matching goatEntryPoints entry
      for (const [exportKey, exportPath] of Object.entries(exports)) {
        const suffix = exportKey === '.' ? '' : exportKey.slice(1);
        const expected = (exportPath as string).replace('./', '');
        assertEquals(
          (goatEntryPoints as Record<string, string>)[suffix],
          expected,
          `goatEntryPoints should have entry for deno.json export "${exportKey}"`,
        );
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets bundles CSS from imports and cssPath into /index.css',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-css');

      // Entry TS that imports a CSS file
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        `import './bundled.css';\nexport {};\n`,
      );
      await writeTextFile(
        path.join(dir, 'bundled.css'),
        ':root { --goatdb-test-bundled: 1; }',
      );
      // Global CSS file -- should be prepended via cssPath
      await writeTextFile(
        path.join(dir, 'global.css'),
        ':root { --goatdb-test-global: 1; }',
      );

      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      let assets: StaticAssets;
      try {
        assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
            cssPath: path.join(dir, 'global.css'),
          },
          // Node path only -- Deno path requires a deno.json in CWD for @deno/esbuild-plugin and is
          // not covered by the unit suite. The full E2E test (opt-in, see below) exercises it.
          { runtime: 'node', keepEsbuildAlive: false },
        );

        assertExists(
          assets['/index.css'],
          '/index.css must always be present in StaticAssets',
        );
        assertEquals(
          assets['/index.css'].contentType,
          'text/css',
          '/index.css must have content-type text/css',
        );
        const css = new TextDecoder().decode(assets['/index.css'].data);

        assertTrue(
          css.includes('--goatdb-test-global'),
          'cssPath content must appear in /index.css',
        );
        assertTrue(
          css.includes('--goatdb-test-bundled'),
          'bundled CSS from JS import must appear in /index.css',
        );
        assertTrue(
          css.indexOf('--goatdb-test-global') <
            css.indexOf('--goatdb-test-bundled'),
          'cssPath content must be prepended before bundled CSS',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets emits assets referenced from bundled CSS url values',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-css-url');
      const fontText = 'fake-woff2-data';

      await writeTextFile(
        path.join(dir, 'entry.ts'),
        `import './style.css';
export {};
`,
      );
      await writeTextFile(
        path.join(dir, 'style.css'),
        `@font-face {
font-family: GoatTest;
src: url('./goat-font.woff2') format('woff2');
}
`,
      );
      await writeTextFile(path.join(dir, 'goat-font.woff2'), fontText);

      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];

      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );

        const css = new TextDecoder().decode(assets['/index.css'].data);
        const urlMatch = css.match(/url\((['"]?)([^)'"]+\.woff2)\1\)/);
        assertExists(urlMatch, 'CSS must contain a rewritten font asset URL');

        // Find the emitted woff2 asset from the assets map directly
        const fontEntries = Object.entries(assets).filter(([k]) =>
          k.endsWith('.woff2')
        );
        assertExists(fontEntries[0], 'a .woff2 asset must be emitted');
        assertEquals(
          fontEntries.length,
          1,
          'exactly one .woff2 asset must be emitted',
        );
        const [fontAssetKey, fontAsset] = fontEntries[0];

        // Verify the CSS url() contains a reference to the emitted asset path
        const expectedUrl = fontAssetKey.startsWith('/')
          ? fontAssetKey.substring(1)
          : fontAssetKey;
        assertTrue(
          css.includes(expectedUrl),
          'CSS must contain a url() pointing to the emitted font asset',
        );
        assertTrue(
          /^\/assets\/goat-font-[A-Z0-9]+\.woff2$/i.test(fontAssetKey),
          'woff2 asset must preserve esbuild asset naming under /assets/',
        );
        assertEquals(fontAsset.contentType, 'font/woff2');
        assertEquals(new TextDecoder().decode(fontAsset.data), fontText);
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets preserves nested secondary entry output paths',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-nested-entry-css');

      await writeTextFile(
        path.join(dir, 'app.ts'),
        'export {};\n',
      );
      await writeTextFile(
        path.join(dir, 'panel.css'),
        ':root { --nested-panel-css: 1; }',
      );
      await writeTextFile(
        path.join(dir, 'panel.ts'),
        "import './panel.css';\nexport {};\n",
      );

      const entryPoints = [
        { in: path.join(dir, 'app.ts'), out: APP_ENTRY_POINT },
        { in: path.join(dir, 'panel.ts'), out: 'nested/admin/panel' },
      ];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'app.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );

        assertExists(
          assets['/nested/admin/panel.js'],
          'nested secondary entry JS must preserve its output path',
        );
        assertExists(
          assets['/nested/admin/panel.js.map'],
          'nested secondary entry JS map must preserve its output path',
        );
        assertExists(
          assets['/nested/admin/panel.css'],
          'nested secondary entry CSS must preserve its output path',
        );
        assertExists(
          assets['/nested/admin/panel.css.map'],
          'nested secondary entry CSS map must preserve its output path',
        );
        assertTrue(
          assets['/panel.js'] === undefined,
          'nested secondary entry JS must not collapse to basename',
        );
        assertTrue(
          assets['/panel.css'] === undefined,
          'nested secondary entry CSS must not collapse to basename',
        );

        const css = new TextDecoder().decode(
          assets['/nested/admin/panel.css'].data,
        );
        assertTrue(
          css.includes('sourceMappingURL=/nested/admin/panel.css.map'),
          'nested secondary entry CSS must reference its nested source map path',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets emits empty /index.css when no CSS is present',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-no-css');
      await writeTextFile(path.join(dir, 'entry.ts'), 'export {};\n');
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );
        assertExists(
          assets['/index.css'],
          '/index.css must be present even with no CSS',
        );
        assertEquals(
          new TextDecoder().decode(assets['/index.css'].data),
          '',
          '/index.css must be empty string when no CSS is present',
        );
        assertEquals(assets['/index.css'].contentType, 'text/css');
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets emits per-entry CSS instead of merging non-app entry styles into /index.css',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-multi-entry-css');

      await writeTextFile(
        path.join(dir, 'a.css'),
        ':root { --multi-entry-a: 1; }',
      );
      await writeTextFile(
        path.join(dir, 'entry-a.ts'),
        `import './a.css';\nexport {};\n`,
      );
      await writeTextFile(
        path.join(dir, 'b.css'),
        ':root { --multi-entry-b: 1; }',
      );
      await writeTextFile(
        path.join(dir, 'entry-b.ts'),
        `import './b.css';\nexport {};\n`,
      );

      const entryPoints = [
        { in: path.join(dir, 'entry-a.ts'), out: APP_ENTRY_POINT },
        { in: path.join(dir, 'entry-b.ts'), out: 'entry-b' },
      ];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry-a.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );

        assertExists(assets['/index.css'], '/index.css must be present');
        assertExists(assets['/entry-b.css'], '/entry-b.css must be present');
        const appCss = new TextDecoder().decode(assets['/index.css'].data);
        const entryBCss = new TextDecoder().decode(
          assets['/entry-b.css'].data,
        );
        assertTrue(
          appCss.includes('--multi-entry-a'),
          'CSS from entry-a must appear in /index.css',
        );
        assertTrue(
          !appCss.includes('--multi-entry-b'),
          'CSS from secondary entries must not appear in /index.css',
        );
        assertTrue(
          entryBCss.includes('--multi-entry-b'),
          'CSS from entry-b must appear in /entry-b.css',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets emits a separate source map for secondary entry CSS',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-multi-entry-css-map');
      await writeTextFile(
        path.join(dir, 'entry-a.css'),
        ':root { --entry-a-cssmap: 1; }',
      );
      await writeTextFile(
        path.join(dir, 'entry-a.ts'),
        "import './entry-a.css';\nexport {};\n",
      );
      await writeTextFile(
        path.join(dir, 'entry-b.css'),
        ':root { --entry-b-cssmap: 1; }',
      );
      await writeTextFile(
        path.join(dir, 'entry-b.ts'),
        "import './entry-b.css';\nexport {};\n",
      );

      const entryPoints = [
        { in: path.join(dir, 'entry-a.ts'), out: APP_ENTRY_POINT },
        { in: path.join(dir, 'entry-b.ts'), out: 'entry-b' },
      ];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry-a.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );

        assertExists(
          assets['/entry-b.css.map'],
          'secondary entry CSS must emit its own source map',
        );
        const entryBCss = new TextDecoder().decode(
          assets['/entry-b.css'].data,
        );
        assertTrue(
          entryBCss.includes('sourceMappingURL=/entry-b.css.map'),
          'secondary entry CSS must reference its own source map',
        );
        const map = JSON.parse(
          new TextDecoder().decode(assets['/entry-b.css.map'].data),
        );
        const sources: string[] = map.sources ??
          map.sections?.[0]?.map?.sources ??
          [];
        assertTrue(
          sources.some((s: string) => s.includes('entry-b.css')),
          'secondary entry CSS map must reference the original CSS file',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets throws descriptive error when cssPath does not exist',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-bad-css');
      await writeTextFile(path.join(dir, 'entry.ts'), 'export {};\n');
      const badCssPath = path.join(dir, 'nonexistent.css');
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        // Contract: error message must include the problematic path so users can identify what's missing.
        await assertThrows(
          () =>
            buildAssets(
              undefined,
              entryPoints,
              {
                buildDir: dir,
                jsPath: path.join(dir, 'entry.ts'),
                cssPath: badCssPath,
              },
              { runtime: 'node', keepEsbuildAlive: false },
            ),
          Error,
          badCssPath,
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets throws descriptive error when htmlPath does not exist',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-bad-html');
      await writeTextFile(path.join(dir, 'entry.ts'), 'export {};\n');
      const badHtmlPath = path.join(dir, 'nonexistent.html');
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        // Contract: error message must include the problematic path so users can identify what's missing.
        await assertThrows(
          () =>
            buildAssets(
              undefined,
              entryPoints,
              {
                buildDir: dir,
                jsPath: path.join(dir, 'entry.ts'),
                htmlPath: badHtmlPath,
              },
              { runtime: 'node', keepEsbuildAlive: false },
            ),
          Error,
          badHtmlPath,
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets forwards esbuildPlugins to esbuild',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-plugins');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(
        entryPath,
        `import { __sentinel__ } from 'testplugin:sentinel';\nexport const x = __sentinel__;\n`,
      );
      const entryPoints = [{
        in: path.toFileUrl(entryPath).href,
        out: APP_ENTRY_POINT,
      }];
      let seenEntryPoint = '';
      // deno-lint-ignore no-explicit-any
      const testPlugin: any = {
        name: 'test-plugin',
        setup(build: any) {
          build.onStart(() => {
            const initialEntryPoint = build.initialOptions.entryPoints?.[0];
            if (
              initialEntryPoint &&
              typeof initialEntryPoint === 'object' &&
              'in' in initialEntryPoint
            ) {
              seenEntryPoint = initialEntryPoint.in;
            }
          });
          build.onResolve({ filter: /^testplugin:/ }, (args: any) => ({
            path: args.path,
            namespace: 'testplugin',
          }));
          build.onLoad(
            { filter: /.*/, namespace: 'testplugin' },
            () => ({
              contents: 'export const __sentinel__ = "plugin-was-here";',
              loader: 'js',
            }),
          );
        },
      };
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: entryPoints[0].in,
          },
          {
            runtime: 'node',
            keepEsbuildAlive: false,
            esbuildPlugins: [testPlugin],
          },
        );
        const js = new TextDecoder().decode(assets['/app.js'].data);
        assertTrue(
          js.includes('plugin-was-here'),
          'esbuildPlugins must be dispatched through the full resolution chain',
        );
        assertEquals(
          seenEntryPoint,
          entryPath,
          'buildAssets must hand esbuild a native filesystem entry path, not a file URL',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets normalizes Windows file URL entry points before esbuild',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-windows-file-url');
      const windowsFileUrl = 'file:///C:/Users/foo/entry.ts';
      const expectedEntryPath = 'C:/Users/foo/entry.ts';
      let seenEntryPoint = '';
      // deno-lint-ignore no-explicit-any
      const testPlugin: any = {
        name: 'windows-entry-plugin',
        setup(build: any) {
          build.onStart(() => {
            const initialEntryPoint = build.initialOptions.entryPoints?.[0];
            if (
              initialEntryPoint &&
              typeof initialEntryPoint === 'object' &&
              'in' in initialEntryPoint
            ) {
              seenEntryPoint = initialEntryPoint.in;
            }
          });
          // esbuild dispatches onResolve for entry points before any filesystem access,
          // so this plugin intercepts 'C:/Users/foo/entry.ts' (the normalized form of
          // the file:// URL) without the file needing to exist on disk.
          build.onResolve(
            { filter: /^C:\/Users\/foo\/entry\.ts$/ },
            (args: any) => ({
              path: args.path,
              namespace: 'windows-entry',
            }),
          );
          build.onResolve({ filter: /^testplugin:/ }, (args: any) => ({
            path: args.path,
            namespace: 'testplugin',
          }));
          build.onLoad(
            { filter: /.*/, namespace: 'windows-entry' },
            () => ({
              contents:
                `import { __sentinel__ } from 'testplugin:sentinel';\nexport const x = __sentinel__;\n`,
              loader: 'js',
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: 'testplugin' },
            () => ({
              contents:
                'export const __sentinel__ = "windows-plugin-was-here";',
              loader: 'js',
            }),
          );
        },
      };
      try {
        const assets = await buildAssets(
          undefined,
          [{ in: windowsFileUrl, out: APP_ENTRY_POINT }],
          {
            buildDir: dir,
            jsPath: 'C:/Users/foo/entry.ts', // appConfig.jsPath is not read by buildAssets
          },
          {
            runtime: 'node',
            keepEsbuildAlive: false,
            esbuildPlugins: [testPlugin],
          },
        );
        const js = new TextDecoder().decode(assets['/app.js'].data);
        assertTrue(
          js.includes('windows-plugin-was-here'),
          'Windows file URL entries must be normalized before plugin resolution runs',
        );
        assertEquals(
          seenEntryPoint,
          expectedEntryPath,
          'Windows file URL entries must reach esbuild as native filesystem paths',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets does not merge assetsPath CSS into /index.css',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-assets-css');
      await writeTextFile(path.join(dir, 'entry.ts'), 'export {};\n');
      const assetsDir = path.join(dir, 'assets');
      await mkdir(assetsDir);
      const cssSentinel = '--assets-sentinel: 1;';
      await writeTextFile(
        path.join(assetsDir, 'styles.css'),
        `.root { ${cssSentinel} }\n`,
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
            assetsPath: assetsDir,
          },
          { runtime: 'node', keepEsbuildAlive: false },
        );
        assertExists(
          assets['/assets/styles.css'],
          '/assets/styles.css must be served from assetsPath',
        );
        const assetsCss = new TextDecoder().decode(
          assets['/assets/styles.css'].data,
        );
        assertTrue(
          assetsCss.includes(cssSentinel),
          'assetsPath CSS must be served as-is',
        );
        const appCss = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          !appCss.includes(cssSentinel),
          'assetsPath CSS must not be merged into /index.css',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets: esbuildPlugins and cssLoaderPlugin coexist',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-plugins-css');
      const cssSentinel = '--plugin-css-sentinel: 1;';
      await writeTextFile(
        path.join(dir, 'style.css'),
        `.root { ${cssSentinel} }\n`,
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        `import './style.css';\nimport { __sentinel__ } from 'testplugin:sentinel';\nexport const x = __sentinel__;\n`,
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      // deno-lint-ignore no-explicit-any
      const sentinelPlugin: any = {
        name: 'sentinel-plugin',
        setup(build: any) {
          build.onResolve({ filter: /^testplugin:/ }, (args: any) => ({
            path: args.path,
            namespace: 'testplugin',
          }));
          build.onLoad(
            { filter: /.*/, namespace: 'testplugin' },
            () => ({
              contents: 'export const __sentinel__ = "plugin-was-here";',
              loader: 'js',
            }),
          );
        },
      };
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
          },
          {
            runtime: 'node',
            keepEsbuildAlive: false,
            esbuildPlugins: [sentinelPlugin],
          },
        );
        const js = new TextDecoder().decode(assets['/app.js'].data);
        assertTrue(
          js.includes('plugin-was-here'),
          'user esbuildPlugin must produce output in /app.js',
        );
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes(cssSentinel),
          'cssLoaderPlugin must still bundle CSS into /index.css when esbuildPlugins are present',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'esbuildPlugins can rewrite local CSS imports on the production build path',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-local-css-plugin');
      const originalSentinel = '--local-css-original: 1;';
      const rewrittenSentinel = '--local-css-rewritten: 1;';
      const originalCssPath = path.join(dir, 'style.css');
      const rewrittenCssPath = path.join(dir, 'rewritten.css');
      await writeTextFile(
        originalCssPath,
        `:root { ${originalSentinel} }\n`,
      );
      await writeTextFile(
        rewrittenCssPath,
        `:root { ${rewrittenSentinel} }\n`,
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        "import './style.css';\nexport {};\n",
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      // deno-lint-ignore no-explicit-any
      const localCssPlugin: any = {
        name: 'local-css-rewriter',
        setup(build: any) {
          build.onResolve(
            { filter: /^\.\/style\.css$/, namespace: 'file' },
            () => ({ path: rewrittenCssPath, namespace: 'file' }),
          );
        },
      };
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
          },
          {
            runtime: 'node',
            keepEsbuildAlive: false,
            esbuildPlugins: [localCssPlugin],
          },
        );
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes(rewrittenSentinel),
          'user plugin must be able to rewrite local CSS imports before GoatDB CSS fallback runs',
        );
        assertTrue(
          !css.includes(originalSentinel),
          'rewritten local CSS must replace the original import target',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'esbuildPlugins can load CSS before GoatDB fallback',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-css-onload-plugin');
      const originalSentinel = '--css-fallback-original: 1;';
      const pluginSentinel = '--css-plugin-loaded: 1;';
      await writeTextFile(
        path.join(dir, 'style.css'),
        `:root { ${originalSentinel} }\n`,
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        "import './style.css';\nexport {};\n",
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      // deno-lint-ignore no-explicit-any
      const cssLoadPlugin: any = {
        name: 'css-onload-plugin',
        setup(build: any) {
          build.onLoad(
            { filter: /style\.css$/, namespace: 'file' },
            () => ({
              contents: `:root { ${pluginSentinel} }\n`,
              loader: 'css',
            }),
          );
        },
      };
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
          },
          {
            runtime: 'node',
            keepEsbuildAlive: false,
            esbuildPlugins: [cssLoadPlugin],
          },
        );
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes(pluginSentinel),
          'user plugin must load CSS before GoatDB CSS fallback runs',
        );
        assertTrue(
          !css.includes(originalSentinel),
          'plugin-loaded CSS must replace fallback-loaded CSS',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'esbuildPlugins can resolve bare-specifier CSS imports',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-bare-css-plugin');
      const sentinel = '--bare-specifier-resolved: 1;';

      await writeTextFile(
        path.join(dir, 'entry.ts'),
        `import 'my-css';\nexport {};\n`,
      );
      await writeTextFile(
        path.join(dir, 'resolved.css'),
        `:root { ${sentinel} }`,
      );

      // deno-lint-ignore no-explicit-any
      const bareCssPlugin: any = {
        name: 'bare-css-resolver',
        setup(build: any) {
          build.onResolve({ filter: /^my-css$/ }, () => ({
            path: path.join(dir, 'resolved.css'),
            namespace: 'file',
          }));
        },
      };

      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
          },
          {
            runtime: 'node',
            keepEsbuildAlive: false,
            esbuildPlugins: [bareCssPlugin],
          },
        );
        assertExists(assets['/index.css'], '/index.css must be present');
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes(sentinel),
          'bare-specifier CSS resolved by user plugin must land in /index.css',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets with ReBuildContext collects CSS on initial build and after rebuild',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-rebuild-css');
      const cssPath = path.join(dir, 'style.css');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(cssPath, ':root { --rebuild-v1: 1; }');
      await writeTextFile(entryPath, `import './style.css';\nexport {};\n`);
      const entryPoints = [{ in: entryPath, out: APP_ENTRY_POINT }];

      const rebuildCtx = await createBuildContext(entryPoints);
      try {
        // Initial build via ReBuildContext
        const assets1 = await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: entryPath,
        });
        const css1 = new TextDecoder().decode(assets1['/index.css'].data);
        assertTrue(
          css1.includes('--rebuild-v1'),
          'CSS must appear on initial ReBuildContext build',
        );

        // Mutate CSS and rebuild
        await writeTextFile(cssPath, ':root { --rebuild-v2: 1; }');
        const assets2 = await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: entryPath,
        });
        const css2 = new TextDecoder().decode(assets2['/index.css'].data);
        assertTrue(
          css2.includes('--rebuild-v2'),
          'Updated CSS must appear after rebuild',
        );
        assertTrue(
          !css2.includes('--rebuild-v1'),
          'Stale CSS must not appear after rebuild',
        );
      } finally {
        rebuildCtx.close();
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'createBuildContext (debug-server wiring) normalizes file:// URL entry points to native paths',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-ctx-file-url-entry');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(entryPath, 'export {};\n');
      const entryPoints = [{
        in: path.toFileUrl(entryPath).href,
        out: APP_ENTRY_POINT,
      }];
      const rebuildCtx = await createBuildContext(entryPoints);
      try {
        const assets = await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: entryPath,
        });
        assertExists(
          assets['/app.js'],
          '/app.js must be produced from a file:// URL entry point',
        );
      } finally {
        rebuildCtx.close();
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'createBuildContext forwards extraPlugins into the build (debug server wiring)',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-ctx-plugins');
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        `import { __sentinel__ } from 'testplugin:sentinel';\nexport const x = __sentinel__;\n`,
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      const testPlugin: BuildPluginLike = {
        name: 'test-plugin',
        setup(build) {
          build.onResolve(
            { filter: /^testplugin:/ },
            (args: TestResolveArgs): TestResolveResult => ({
              path: args.path,
              namespace: 'testplugin',
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: 'testplugin' },
            (): TestLoadResult => ({
              contents: 'export const __sentinel__ = "ctx-plugin-was-here";',
              loader: 'js',
            }),
          );
        },
      };
      const rebuildCtx = await createBuildContext(entryPoints, [testPlugin]);
      try {
        const assets = await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: path.join(dir, 'entry.ts'),
        });
        const js = new TextDecoder().decode(assets['/app.js'].data);
        assertTrue(
          js.includes('ctx-plugin-was-here'),
          'extraPlugins passed to createBuildContext must be applied during buildAssets',
        );
      } finally {
        rebuildCtx.close();
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'createBuildContext extraPlugins can rewrite local CSS imports',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-ctx-local-css-plugin');
      const originalSentinel = '--ctx-local-css-original: 1;';
      const rewrittenSentinel = '--ctx-local-css-rewritten: 1;';
      const rewrittenCssPath = path.join(dir, 'rewritten.css');
      await writeTextFile(
        path.join(dir, 'style.css'),
        `:root { ${originalSentinel} }\n`,
      );
      await writeTextFile(
        rewrittenCssPath,
        `:root { ${rewrittenSentinel} }\n`,
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        "import './style.css';\nexport {};\n",
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      const localCssPlugin: BuildPluginLike = {
        name: 'ctx-local-css-rewriter',
        setup(build) {
          build.onResolve(
            { filter: /^\.\/style\.css$/, namespace: 'file' },
            (): TestResolveResult => ({
              path: rewrittenCssPath,
              namespace: 'file',
            }),
          );
        },
      };
      const rebuildCtx = await createBuildContext(entryPoints, [
        localCssPlugin,
      ]);
      try {
        const assets = await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: path.join(dir, 'entry.ts'),
        });
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes(rewrittenSentinel),
          'debug build context must let user plugins rewrite local CSS imports',
        );
        assertTrue(
          !css.includes(originalSentinel),
          'debug build context must not fall back to the original local CSS file after rewrite',
        );
      } finally {
        rebuildCtx.close();
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets throws when esbuildPlugins provided with ReBuildContext',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-ctx-plugin-error');
      await writeTextFile(path.join(dir, 'entry.ts'), 'export {};\n');
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      const rebuildCtx = await createBuildContext(entryPoints);

      try {
        await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: path.join(dir, 'entry.ts'),
        }, { esbuildPlugins: [{ name: 'sentinel', setup() {} }] });
        throw new Error('Expected buildAssets to throw');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assertTrue(
          msg.includes(
            'esbuildPlugins cannot be provided together with a pre-built ReBuildContext',
          ),
          `Expected plugin-with-context error, got: ${msg}`,
        );
      } finally {
        rebuildCtx.close();
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'cssLoaderPlugin resolves CSS @import chains via resolveDir',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('css-import-chain');
      // b.css is the leaf -- contains the sentinel
      await writeTextFile(
        path.join(dir, 'b.css'),
        ':root { --chain-sentinel: 1; }',
      );
      // a.css @imports b.css -- tests resolveDir resolution
      await writeTextFile(
        path.join(dir, 'a.css'),
        "@import './b.css';\n",
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        "import './a.css';\nexport {};\n",
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes('--chain-sentinel'),
          'CSS @import chains must be resolved and bundled into /index.css',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'cssLoaderPlugin preserves CSS Modules exports on the node build path',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('css-modules-node-path');
      await writeTextFile(
        path.join(dir, 'style.module.css'),
        '.foo { color: red; }\n',
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        "import styles from './style.module.css';\nglobalThis.__goatCssModuleClassName = styles.foo;\nexport {};\n",
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );
        const js = new TextDecoder().decode(assets['/app.js'].data);
        const css = new TextDecoder().decode(assets['/index.css'].data);
        const className = runBundledScript(js).__goatCssModuleClassName;
        assertExists(
          className,
          'CSS Modules JS output must export a class name for foo',
        );
        assertTrue(
          typeof className === 'string',
          'CSS Modules export for foo must be a string',
        );
        const exportedClassName = className as string;
        assertTrue(
          exportedClassName.length > 0,
          'CSS Modules export for foo must not be empty',
        );
        assertTrue(
          css.includes(`.${exportedClassName}`),
          'Bundled CSS must include the exported CSS Modules class name',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets with ReBuildContext preserves CSS Modules exports after rebuild',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('css-modules-rebuild-path');
      const cssPath = path.join(dir, 'style.module.css');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(cssPath, '.foo { color: red; }\n');
      await writeTextFile(
        entryPath,
        "import styles from './style.module.css';\nglobalThis.__goatCssModuleClassName = styles.foo;\nexport {};\n",
      );
      const entryPoints = [{ in: entryPath, out: APP_ENTRY_POINT }];
      const rebuildCtx = await createBuildContext(entryPoints);
      try {
        const assets1 = await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: entryPath,
        });
        const js1 = new TextDecoder().decode(assets1['/app.js'].data);
        const css1 = new TextDecoder().decode(assets1['/index.css'].data);
        const className1 = runBundledScript(js1).__goatCssModuleClassName;
        assertExists(
          className1,
          'Initial CSS Modules build must export a class name for foo',
        );
        assertTrue(
          typeof className1 === 'string',
          'Initial CSS Modules export for foo must be a string',
        );
        const exportedClassName1 = className1 as string;
        assertTrue(
          css1.includes(`.${exportedClassName1}`),
          'Initial bundled CSS must include the exported CSS Modules class name',
        );
        assertTrue(
          css1.includes('color: red'),
          'Initial bundled CSS must include the first CSS Modules content',
        );

        await writeTextFile(cssPath, '.foo { color: blue; }\n');
        const assets2 = await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: entryPath,
        });
        const js2 = new TextDecoder().decode(assets2['/app.js'].data);
        const css2 = new TextDecoder().decode(assets2['/index.css'].data);
        const className2 = runBundledScript(js2).__goatCssModuleClassName;
        assertExists(
          className2,
          'Rebuilt CSS Modules output must export a class name for foo',
        );
        assertTrue(
          typeof className2 === 'string',
          'Rebuilt CSS Modules export for foo must be a string',
        );
        const exportedClassName2 = className2 as string;
        assertTrue(
          css2.includes(`.${exportedClassName2}`),
          'Rebuilt bundled CSS must include the exported CSS Modules class name',
        );
        assertTrue(
          css2.includes('color: blue'),
          'Rebuilt CSS must include the updated CSS Modules content',
        );
        assertTrue(
          !css2.includes('color: red'),
          'Rebuilt CSS must not include stale CSS Modules content',
        );
      } finally {
        rebuildCtx.close();
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets with ReBuildContext prepends cssPath into /index.css',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-rebuild-csspath');
      const globalCssPath = path.join(dir, 'global.css');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(globalCssPath, ':root { --global-sentinel: 1; }');
      await writeTextFile(entryPath, 'export {};');
      const entryPoints = [{ in: entryPath, out: APP_ENTRY_POINT }];
      const rebuildCtx = await createBuildContext(entryPoints);
      try {
        const assets = await buildAssets(rebuildCtx, entryPoints, {
          buildDir: dir,
          jsPath: entryPath,
          cssPath: globalCssPath,
        });
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes('--global-sentinel'),
          'cssPath must be included in /index.css when using ReBuildContext',
        );
      } finally {
        rebuildCtx.close();
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets emits /index.css.map with correct sourceMappingURL reference',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-sourcemap-url');
      await writeTextFile(
        path.join(dir, 'style.css'),
        ':root { --strip-test: 1; }',
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        "import './style.css';\nexport {};\n",
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes('sourceMappingURL=/index.css.map'),
          '/index.css must reference /index.css.map as its source map',
        );
        assertExists(
          assets['/index.css.map'],
          '/index.css.map must be served when CSS is bundled',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets /index.css.map is valid source map referencing original CSS files',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-cssmap-valid');
      await writeTextFile(
        path.join(dir, 'style.css'),
        ':root { --cssmap-sentinel: 1; }',
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        "import './style.css';\nexport {};\n",
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );
        assertExists(assets['/index.css.map'], '/index.css.map must exist');
        const mapJson = new TextDecoder().decode(
          assets['/index.css.map'].data,
        );
        // deno-lint-ignore no-explicit-any
        const map = JSON.parse(mapJson) as any;
        assertEquals(map.version, 3, 'source map version must be 3');
        const sources = getMapSources(map);
        assertTrue(
          Array.isArray(sources) &&
            sources.some((s: string) => s.includes('style.css')),
          'source map must reference the original style.css file',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets with cssPath and bundled CSS preserves source mapping to bundled CSS',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-cssmap-sections');
      const globalCssContent = ':root { --global-cssmap-sentinel: 1; }\n';
      await writeTextFile(
        path.join(dir, 'global.css'),
        globalCssContent,
      );
      await writeTextFile(
        path.join(dir, 'bundled.css'),
        ':root { --bundled-cssmap-sentinel: 2; }',
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        "import './bundled.css';\nexport {};\n",
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
            cssPath: path.join(dir, 'global.css'),
          },
          { runtime: 'node', keepEsbuildAlive: false },
        );
        assertExists(assets['/index.css.map'], '/index.css.map must exist');
        const cssText = new TextDecoder().decode(assets['/index.css'].data);
        const mapJson = new TextDecoder().decode(
          assets['/index.css.map'].data,
        );
        // deno-lint-ignore no-explicit-any
        const map = JSON.parse(mapJson) as any;
        assertTrue(
          cssText.includes('--global-cssmap-sentinel'),
          '/index.css must include the prepended cssPath content',
        );
        assertTrue(
          cssText.includes('--bundled-cssmap-sentinel'),
          '/index.css must include the bundled CSS content',
        );
        assertTrue(
          cssText.indexOf('--global-cssmap-sentinel') <
            cssText.indexOf('--bundled-cssmap-sentinel'),
          'prepended cssPath content must appear before bundled CSS',
        );
        assertTrue(
          cssText.includes('sourceMappingURL=/index.css.map'),
          '/index.css must reference /index.css.map when a CSS map is emitted',
        );
        const sources = getMapSources(map);
        assertTrue(
          sources.some((s: string) => s.includes('bundled.css')),
          'source map must reference the bundled CSS source file',
        );
        assertTrue(
          !sources.some((s: string) => s.includes('global.css')),
          'prepended cssPath content must remain unmapped',
        );
        const firstMappedLine = getFirstMappedGeneratedLine(map);
        assertExists(
          firstMappedLine,
          'source map must expose a mapped generated line',
        );
        assertEquals(
          firstMappedLine,
          getCssChunkStartLine(globalCssContent),
          'first mapped generated line must start at the bundled CSS chunk boundary',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets emits no /index.css.map when there is no CSS',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-no-cssmap');
      await writeTextFile(path.join(dir, 'entry.ts'), 'export {};\n');
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry.ts') },
          { runtime: 'node', keepEsbuildAlive: false },
        );
        assertTrue(
          assets['/index.css.map'] === undefined,
          '/index.css.map must not be emitted when there is no CSS',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets with cssPath only emits no /index.css.map and no sourceMappingURL',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-cssonly-no-map');
      await writeTextFile(
        path.join(dir, 'vendor.css'),
        ':root { --cssonly-sentinel: 1; }\n',
      );
      // Entry point imports no CSS -- only cssPath is set
      await writeTextFile(path.join(dir, 'entry.ts'), 'export {};\n');
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
            cssPath: path.join(dir, 'vendor.css'),
          },
          { runtime: 'node', keepEsbuildAlive: false },
        );
        assertTrue(
          assets['/index.css.map'] === undefined,
          '/index.css.map must not be emitted when only cssPath (unmapped) is present',
        );
        const cssText = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          cssText.includes('--cssonly-sentinel'),
          '/index.css must contain cssPath content',
        );
        assertTrue(
          !cssText.includes('sourceMappingURL'),
          '/index.css must not contain sourceMappingURL when no map is generated',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets with Node runtime collects CSS and sourceMappingURL on rebuild',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-node-rebuild-css');
      const cssFile = path.join(dir, 'style.css');
      const entryFile = path.join(dir, 'entry.ts');
      await writeTextFile(cssFile, ':root { --node-rebuild-v1: 1; }');
      await writeTextFile(entryFile, `import './style.css';\nexport {};\n`);
      const entryPoints = [{ in: entryFile, out: APP_ENTRY_POINT }];
      const appConfig = { buildDir: dir, jsPath: entryFile };
      try {
        // First build
        const assets1 = await buildAssets(
          undefined,
          entryPoints,
          appConfig,
          { runtime: 'node', keepEsbuildAlive: false },
        );
        const css1 = new TextDecoder().decode(assets1['/index.css'].data);
        assertTrue(
          css1.includes('--node-rebuild-v1'),
          'CSS v1 must appear on first build',
        );
        assertTrue(
          css1.includes('sourceMappingURL=/index.css.map'),
          '/index.css must reference /index.css.map on first build',
        );
        assertExists(
          assets1['/index.css.map'],
          '/index.css.map must exist on first build',
        );

        // Mutate CSS and rebuild
        await writeTextFile(cssFile, ':root { --node-rebuild-v2: 1; }');
        const assets2 = await buildAssets(
          undefined,
          entryPoints,
          appConfig,
          { runtime: 'node', keepEsbuildAlive: false },
        );
        const css2 = new TextDecoder().decode(assets2['/index.css'].data);
        assertTrue(
          css2.includes('--node-rebuild-v2'),
          'CSS v2 must appear after rebuild',
        );
        assertTrue(
          !css2.includes('--node-rebuild-v1'),
          'Stale CSS must not appear after rebuild',
        );
        assertExists(
          assets2['/index.css.map'],
          '/index.css.map must exist after rebuild',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  // Heavy E2E test -- resource-intensive, recommended to run in isolation
  // This test is expensive as it:
  // 1. Bootstraps a full project
  // 2. Installs dependencies
  // 3. Compiles to binary
  // 4. Starts the server
  // 5. Verifies HTTP responses
  //
  // To run: deno task test --test="should compile executable"
  TEST(
    'CLI-Compile',
    'should compile executable',
    async (ctx: TestSuite) => {
      if (!getEnvVar('GOATDB_E2E')) {
        console.log('Skipping E2E compile test (set GOATDB_E2E=1 to enable)');
        return;
      }

      const runtime = getRuntime();

      // This is a heavy E2E test - mark it as such
      console.log('Running E2E compile test (this may take a while)...');

      const testDir = await ctx.tempDir('compile-e2e');

      // 1. Bootstrap a project
      console.log('Bootstrapping project...');
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: false, // Need deps for compilation
      });

      // Verify project was created
      assertTrue(
        await pathExists(path.join(testDir, 'client/index.tsx')),
        'Project should be bootstrapped',
      );

      // 2. Link to local GoatDB sources instead of published package
      // This ensures we test against the current codebase, not the published version
      console.log('Linking to local GoatDB sources...');
      const linkModule = await import('../cli/link.ts');

      // Get path to GoatDB repo root
      // In bundled Node.js, import.meta.url points to bundled code, not original source.
      // Use the runtime's CWD which should be the goatdb repo root during tests.
      const goatdbRoot = runtime.getCWD();

      await linkModule.linkGoatDB(goatdbRoot, testDir);

      // For Node.js, reinstall to update node_modules with local link
      if (runtime.id === 'node') {
        console.log('Reinstalling dependencies with local link...');
        const installResult = await cli('npm', 'install', { cwd: testDir });
        if (installResult.exitCode !== 0) {
          throw new Error(`npm install failed: ${installResult.result}`);
        }
      }

      // 3. Compile the project
      console.log('Compiling project...');
      const { compile } = await import('../cli/compile.ts');

      // Determine server entry based on runtime
      const serverEntry = runtime.id === 'node'
        ? path.join(testDir, 'server/server-sea.ts')
        : path.join(testDir, 'server/server.ts');

      await compile({
        buildDir: path.join(testDir, 'build'),
        serverEntry,
        jsPath: path.join(testDir, 'client/index.tsx'),
        htmlPath: path.join(testDir, 'client/index.html'),
        outputName: 'test-app',
        // Use deno.json or package.json based on runtime
        ...(runtime.id === 'deno'
          ? { denoJson: path.join(testDir, 'deno.json') }
          : { packageJson: path.join(testDir, 'package.json') }),
      });

      // 4. Verify binary exists
      const osName = runtime.getOS();

      let binaryName: string;
      if (runtime.id === 'deno') {
        binaryName = `test-app-${targetFromOSArch()}`;
      } else {
        binaryName = osName === 'windows' ? 'test-app.exe' : 'test-app';
      }

      const binaryPath = path.join(testDir, 'build', binaryName);
      assertTrue(
        await pathExists(binaryPath),
        `Binary should exist at ${binaryPath}`,
      );

      console.log(`Binary compiled successfully: ${binaryPath}`);

      // 5. Verify binary is executable (basic sanity check)
      const { result: helpOutput, exitCode } = await cli(
        binaryPath,
        '--help',
        { timeout: 30_000 },
      );
      assertTrue(
        exitCode === 0,
        `Binary --help failed with exit code ${exitCode}`,
      );
      assertTrue(
        helpOutput.includes('--help') || helpOutput.includes('Options'),
        'Binary should respond to --help',
      );
      console.log(
        'E2E compile test passed: Binary compiles and is executable',
      );
    },
  );

  TEST(
    'CLI-Compile',
    'buildCombinedCSS handles multi-chunk source maps correctly',
    () => {
      // Single chunk with map -> direct map, not sections format
      const single = buildCombinedCSS(
        [{
          content: '.a{color:red}',
          map: '{"version":3,"sources":["a.css"]}',
        }],
        '/index.css.map',
      );
      assertEquals(
        single.css,
        '.a{color:red}\n/*# sourceMappingURL=/index.css.map */',
      );
      assertEquals(single.cssMap, '{"version":3,"sources":["a.css"]}');

      // Two chunks, both mapped -> sections format with correct offsets
      const two = buildCombinedCSS(
        [
          {
            content: '.a{color:red}',
            map: '{"version":3,"sources":["a.css"]}',
          },
          {
            content: '.b{color:blue}\n.b2{color:green}',
            map: '{"version":3,"sources":["b.css"]}',
          },
        ],
        '/index.css.map',
      );
      // deno-lint-ignore no-explicit-any
      const sections = JSON.parse(two.cssMap!) as any;
      assertEquals(sections.version, 3);
      assertEquals(sections.sections.length, 2);
      assertEquals(sections.sections[0].offset, { line: 0, column: 0 });
      assertEquals(sections.sections[1].offset, { line: 2, column: 0 });

      // Two chunks, first unmapped (cssPath), second mapped -> sections with only second
      const mixed = buildCombinedCSS(
        [
          { content: '/* reset */' },
          {
            content: '.a{color:red}',
            map: '{"version":3,"sources":["a.css"]}',
          },
        ],
        '/index.css.map',
      );
      // deno-lint-ignore no-explicit-any
      const mixedSections = JSON.parse(mixed.cssMap!) as any;
      assertEquals(mixedSections.sections.length, 1);
      assertEquals(mixedSections.sections[0].offset, { line: 2, column: 0 });

      // Trailing newline in an unmapped chunk must still advance offsets by the
      // chunk's real newline count plus the inserted '\n\n' separator.
      const mixedWithTrailingNewline = buildCombinedCSS(
        [
          { content: '/* reset */\n' },
          {
            content: '.a{color:red}',
            map: '{"version":3,"sources":["a.css"]}',
          },
        ],
        '/index.css.map',
      );
      // deno-lint-ignore no-explicit-any
      const trailingSections = JSON.parse(
        mixedWithTrailingNewline.cssMap!,
      ) as any;
      assertEquals(trailingSections.sections.length, 1);
      assertEquals(trailingSections.sections[0].offset, {
        line: 3,
        column: 0,
      });

      // No mapped chunks -> no cssMap
      const none = buildCombinedCSS(
        [{ content: '/* reset */' }, { content: '/* vendor */' }],
        '/index.css.map',
      );
      assertEquals(none.cssMap, undefined);
    },
  );

  TEST('CLI-Compile', 'buildCombinedCSS handles empty chunks array', () => {
    const result = buildCombinedCSS([], '/index.css.map');
    assertEquals(result.css, '');
    assertEquals(result.cssMap, undefined);
  });

  const kPluginValidationCases: {
    name: string;
    plugins: BuildPluginLike[];
    expectedMsg: string;
  }[] = [
    {
      name: 'reserved plugin name',
      plugins: [{ name: 'node-stub', setup: () => {} }],
      expectedMsg: 'node-stub',
    },
    {
      name: 'plugin missing setup',
      plugins: [
        { name: 'bad-plugin', setup: undefined },
      ] as unknown as BuildPluginLike[],
      expectedMsg: 'bad-plugin',
    },
    {
      name: 'duplicate plugin names',
      plugins: [
        { name: 'custom', setup: () => {} },
        { name: 'custom', setup: () => {} },
      ],
      expectedMsg: 'custom',
    },
    {
      name: 'empty plugin name',
      plugins: [{ name: '', setup: () => {} }],
      expectedMsg: 'invalid name',
    },
    {
      name: 'non-string plugin name',
      plugins: [
        { name: 123, setup: () => {} },
      ] as unknown as BuildPluginLike[],
      expectedMsg: 'invalid name',
    },
    {
      name: 'reserved goatdb-css-loader plugin name',
      plugins: [{ name: 'goatdb-css-loader', setup: () => {} }],
      expectedMsg: 'goatdb-css-loader',
    },
    {
      name: 'reserved adapter-stub plugin name',
      plugins: [{ name: 'adapter-stub', setup: () => {} }],
      expectedMsg: 'adapter-stub',
    },
  ];

  for (const tc of kPluginValidationCases) {
    TEST(
      'CLI-Compile',
      `buildAssets throws for ${tc.name}`,
      async () => {
        try {
          await assertThrows(
            async () =>
              buildAssets(
                undefined,
                [{ in: '/fake.ts', out: 'fake' }],
                kPlaceholderAppConfig,
                {
                  runtime: 'node',
                  esbuildPlugins: tc.plugins,
                },
              ),
            Error,
            tc.expectedMsg,
          );
        } finally {
          await stopBackgroundCompiler();
        }
      },
    );
  }

  TEST(
    'CLI-Compile',
    'buildAssets accepts valid plugins',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-valid-plugin');
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        `import { __sentinel__ } from 'testplugin:sentinel';\nexport const x = __sentinel__;\n`,
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      const validPlugin: BuildPluginLike = {
        name: 'valid-test-plugin',
        setup(build) {
          build.onResolve(
            { filter: /^testplugin:/ },
            (args: TestResolveArgs): TestResolveResult => ({
              path: args.path,
              namespace: 'testplugin',
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: 'testplugin' },
            (): TestLoadResult => ({
              contents: 'export const __sentinel__ = "valid-plugin-ok";',
              loader: 'js',
            }),
          );
        },
      };
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
          },
          {
            runtime: 'node',
            keepEsbuildAlive: false,
            esbuildPlugins: [validPlugin],
          },
        );
        const js = new TextDecoder().decode(assets['/app.js'].data);
        assertTrue(
          js.includes('valid-plugin-ok'),
          'valid plugin should be accepted and executed',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets preserves user plugin ordering',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-plugins-order');
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        `import { x } from 'ordering-test:foo';\nexport const result = x;\n`,
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      const firstPlugin: BuildPluginLike = {
        name: 'first-plugin',
        setup(build) {
          build.onResolve(
            { filter: /^ordering-test:/ },
            (args: TestResolveArgs): TestResolveResult => ({
              path: args.path,
              namespace: 'ordering-test',
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: 'ordering-test' },
            (): TestLoadResult => ({
              contents: 'export const x = "first-plugin-won";',
              loader: 'js',
            }),
          );
        },
      };
      const secondPlugin: BuildPluginLike = {
        name: 'second-plugin',
        setup(build) {
          build.onResolve(
            { filter: /^ordering-test:/ },
            (args: TestResolveArgs): TestResolveResult => ({
              path: args.path,
              namespace: 'ordering-test',
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: 'ordering-test' },
            (): TestLoadResult => ({
              contents: 'export const x = "second-plugin-won";',
              loader: 'js',
            }),
          );
        },
      };
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
          },
          {
            runtime: 'node',
            keepEsbuildAlive: false,
            esbuildPlugins: [firstPlugin, secondPlugin],
          },
        );
        const js = new TextDecoder().decode(assets['/app.js'].data);
        assertTrue(
          js.includes('first-plugin-won'),
          'first plugin should win because it is earlier in the stack',
        );
        assertTrue(
          !js.includes('second-plugin-won'),
          'second plugin should not win when first plugin handles the import',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets includes node-stub plugin for node runtime',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-node-stub');
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        `import crypto from 'node:crypto';\nexport const x = crypto;\n`,
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];
      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
          },
          {
            runtime: 'node',
            keepEsbuildAlive: false,
          },
        );
        const js = new TextDecoder().decode(assets['/app.js'].data);
        assertTrue(
          js.includes('node:crypto'),
          'node-stub should polyfill node:crypto for browser bundle',
        );
        assertTrue(
          js.includes('webcrypto'),
          'node-stub should export webcrypto for node:crypto',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );
}

/**
 * Node.js-only CLI compile tests.
 * Gated at test-registry.ts level.
 */
export function setupCliCompileNodeTests(): void {
  TEST(
    'CLI-Compile',
    'signExecutable warns about certPassword visibility before signtool failure',
    async (ctx: TestSuite) => {
      const runtime = getRuntime() as { getOS: () => string };
      const originalGetOS = runtime.getOS;
      const dir = await ctx.tempDir('sign-windows-cert-password');
      const execPath = path.join(dir, 'app.exe');
      const certPath = path.join(dir, 'cert.pfx');
      await writeTextFile(execPath, 'stub');
      await writeTextFile(certPath, 'stub');

      try {
        runtime.getOS = () => 'windows';
        await withLogCapture(async (captured) => {
          await assertThrows(
            async () => {
              await signExecutable(execPath, {
                windows: { certFile: certPath, certPassword: 'secret' },
              });
            },
            Error,
            'Code signing failed:',
          );
          const warning = captured.find((e) =>
            e.severity === 'WARNING' &&
            e.message?.includes('certPassword is passed as a CLI argument')
          );
          assertExists(warning, 'certPassword usage should emit a warning');
          assertEquals(
            warning?.error,
            undefined,
            'certPassword warning should not be misclassified as missing configuration',
          );
        });
      } finally {
        runtime.getOS = originalGetOS;
      }
    },
  );

  TEST(
    'CLI-Compile',
    'bundleServerForSEA accepts file:// URL entry points',
    async (ctx) => {
      const dir = await ctx.tempDir('bundle-sea-file-url');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(entryPath, 'export const value = 42;\n');
      const outPath = path.join(dir, 'bundle.cjs');

      try {
        await bundleServerForSEA(path.toFileUrl(entryPath).href, outPath);
      } finally {
        await stopBackgroundCompiler();
      }

      assertTrue(await pathExists(outPath), 'output file must be written');
      const content = await readTextFile(outPath);
      assertExists(content, 'output file should be readable');
      assertTrue(
        content!.includes('module.exports'),
        'file:// entry points must still produce CJS output',
      );
    },
  );

  TEST(
    'CLI-Compile',
    'bundleServerForSEA produces valid CJS',
    async (ctx) => {
      const dir = await ctx.tempDir('bundle-sea');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(
        entryPath,
        'export function main(): number { return 42; }',
      );
      const outPath = path.join(dir, 'bundle.cjs');

      try {
        await bundleServerForSEA(entryPath, outPath);
      } finally {
        await stopBackgroundCompiler();
      }

      const content = await readTextFile(outPath);
      assertExists(content, 'output file should be readable');
      const text = content!;
      assertTrue(text.length > 0, 'output file must not be empty');
      assertTrue(
        text.includes('module.exports'),
        'CJS output must assign module.exports',
      );
    },
  );

  TEST(
    'CLI-Compile',
    'buildAssets enforces Deno runtime for deno target',
    async () => {
      try {
        await assertThrows(
          async () =>
            buildAssets(
              undefined,
              [{ in: '/fake.ts', out: 'fake' }],
              kPlaceholderAppConfig,
              { runtime: 'deno' },
            ),
          Error,
          'cannot build Deno-target bundle',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  // Node cli tests
  TEST(
    'CLI-Compile',
    'cli returns timeout result and warning log in Node runtime',
    makeTimeoutTest('Node', 'node', 500),
  );

  TEST(
    'CLI-Compile',
    'cli returns normal output and exit code on non-timeout execution',
    makeNormalTest('node'),
  );

  TEST(
    'CLI-Compile',
    'cli timeout prevents delayed side effects before returning',
    makeOrphanTest(
      'node',
      (s) =>
        `setTimeout(() => require('fs').writeFileSync(${
          JSON.stringify(s)
        }, 'x'), 5000)`,
      'node',
    ),
  );

  TEST(
    'CLI-Compile',
    'cli returns timeout result when Node spawns a Deno subprocess',
    makeTimeoutTest('CrossRuntime', 'deno', 500),
  );
}

/**
 * Deno-only CLI compile tests.
 * Gated at test-registry.ts level.
 */
export function setupCliCompileDenoTests(): void {
  TEST(
    'CLI-Compile',
    DENO_ONLY_FILTER_TEST,
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('build-assets-deno-css');
      await writeTextFile(
        path.join(dir, 'style.css'),
        ':root { --deno-css-test: 1; }',
      );
      await writeTextFile(
        path.join(dir, 'entry.ts'),
        "import './style.css';\nexport {};",
      );
      const entryPoints = [{
        in: path.join(dir, 'entry.ts'),
        out: APP_ENTRY_POINT,
      }];

      try {
        const assets = await buildAssets(
          undefined,
          entryPoints,
          { buildDir: dir, jsPath: path.join(dir, 'entry.ts') },
          { runtime: 'deno', keepEsbuildAlive: false },
        );
        assertExists(
          assets['/index.css'],
          '/index.css must be present for deno runtime',
        );
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          css.includes('--deno-css-test'),
          'CSS from import must land in /index.css on deno path',
        );
        assertExists(
          assets['/index.css.map'],
          '/index.css.map must be present on deno path',
        );
        const cssMapStr = new TextDecoder().decode(
          assets['/index.css.map'].data,
        );
        const cssMap = JSON.parse(cssMapStr);
        assertEquals(
          cssMap.version,
          3,
          '/index.css.map must be a valid v3 source map',
        );
        const sources: string[] = cssMap.sources ??
          cssMap.sections?.[0]?.map?.sources ?? [];
        assertTrue(
          sources.length > 0,
          '/index.css.map must contain at least one source entry',
        );
        assertTrue(
          sources.some((s: string) => s.includes('style.css')),
          '/index.css.map must reference the original style.css source file',
        );
        const cssText = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          cssText.includes('sourceMappingURL=/index.css.map'),
          '/index.css must reference /index.css.map',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );

  TEST(
    'CLI-Compile',
    'compileForNodeWithEsbuild accepts file:// entries, resolves JSR imports, and runs in Node.js',
    async (ctx: TestSuite) => {
      const { compileForNodeWithEsbuild, nodeRun } = await import(
        '../base/node-runner.ts'
      );
      const dir = await ctx.tempDir('node-esbuild-plugin');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(
        entryPath,
        `import { assertEquals } from "jsr:@std/assert";\nexport { assertEquals };`,
      );
      const result = await compileForNodeWithEsbuild(
        path.toFileUrl(entryPath).href,
        'output',
      );
      assertEquals(
        result.errors.length,
        0,
        'Node.js compilation with @deno/esbuild-plugin must produce no errors',
      );
      assertExists(result.outputFiles, 'compilation must produce output files');
      assertTrue(
        result.outputFiles!.length > 0,
        'compilation must produce at least one output file',
      );
      const nodeResult = await nodeRun(result);
      assertTrue(
        nodeResult.success,
        `compiled bundle must execute successfully in Node.js: ${nodeResult.stderrText}`,
      );
    },
  );

  TEST(
    'CLI-Compile',
    'runAcrossPlatforms surfaces Node.js stderr details on failure',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('node-runner-surface-stderr');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(
        entryPath,
        "throw new Error('node-runner-sentinel');\n",
      );

      await assertThrows(
        async () => {
          await runAcrossPlatforms({
            entryPointServer: entryPath,
            entryPointBrowser: entryPath,
            runtimes: ['node'],
          });
        },
        Error,
        'node-runner-sentinel',
      );
    },
  );

  TEST(
    'CLI-Compile',
    'nodeRun returns timeout failure after child teardown settles',
    async (ctx: TestSuite) => {
      const { compileForNodeWithEsbuild, nodeRun } = await import(
        '../base/node-runner.ts'
      );
      const dir = await ctx.tempDir('node-runner-timeout');
      const entryPath = path.join(dir, 'entry.ts');
      await writeTextFile(entryPath, 'setInterval(() => {}, 1000);\n');
      const result = await compileForNodeWithEsbuild(entryPath, 'output');
      const originalSetTimeout = globalThis.setTimeout;
      try {
        globalThis.setTimeout = ((handler, timeout, ...args) =>
          originalSetTimeout(
            handler,
            typeof timeout === 'number' && timeout > 100 ? 20 : timeout,
            ...args,
          )) as typeof setTimeout;
        const nodeResult = await nodeRun(result);
        assertFalse(nodeResult.success, 'timed out node run must fail');
        assertEquals(
          nodeResult.exitCode,
          -1,
          'timeout returns wrapper failure',
        );
        assertTrue(
          nodeResult.stderrText.includes('Timed out after 300000ms'),
          `timeout error should be surfaced, got: ${nodeResult.stderrText}`,
        );
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    },
  );

  // Deno cli tests
  TEST(
    'CLI-Compile',
    'cli returns timeout result and warning log in Deno runtime',
    makeTimeoutTest('Deno', 'deno', 2000),
  );

  TEST(
    'CLI-Compile',
    'cli rethrows Deno spawn failures that are not timeouts',
    async (_ctx: TestSuite) => {
      await withLogCapture(async (captured) => {
        await assertThrows(
          async () => {
            await cli('goatdb-definitely-missing-cli-command');
          },
          Error,
        );
        assertEquals(
          captured.filter((e) => e.severity === 'WARNING').length,
          0,
          'non-timeout Deno cli() failures must not emit timeout warnings',
        );
      });
    },
  );

  TEST(
    'CLI-Compile',
    'cli returns normal output and exit code on non-timeout execution',
    makeNormalTest('deno'),
  );

  TEST(
    'CLI-Compile',
    'cli timeout prevents delayed side effects before returning',
    makeOrphanTest(
      'deno',
      (s) =>
        `setTimeout(() => Deno.writeTextFileSync(${
          JSON.stringify(s)
        }, 'x'), 5000)`,
      'deno',
    ),
  );
}
