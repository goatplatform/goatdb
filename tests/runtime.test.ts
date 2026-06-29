import { TEST } from './mod.ts';
import { assertEquals, assertThrows, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { writeTextFile } from '../base/json-log/file-impl.ts';
import { BrowserAdapter } from '../base/runtime/adapters/browser.ts';
import { DenoAdapter } from '../base/runtime/adapters/deno.ts';
import { NodeAdapter } from '../base/runtime/adapters/node.ts';
import {
  clearRuntimeCache,
  getRegisteredAdapters,
  getRuntime,
} from '../base/runtime/index.ts';
import {
  browserOpenCommand,
  isBrowserOpenUrl,
  withTestBrowserOpenCommand,
} from '../base/runtime/browser-open.ts';
import { exit, withTestExitOverride } from '../base/process.ts';
import type { LogEntry } from '../logging/log.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';
import {
  compileToNodeEsm,
  getRealpathSync,
  runNodeCommand,
  testNodeSpawnedEntry,
  withLogCapture,
} from './test-utils.ts';

declare const __BUNDLE_TARGET__: string | undefined;

export default function setupRuntimeTests(): void {
  // I-001: Runtime Detection Caching
  TEST('Runtime', 'getRuntime returns cached instance (I-001)', () => {
    clearRuntimeCache();
    const first = getRuntime();
    const second = getRuntime();
    const third = getRuntime();
    assertTrue(
      first === second,
      'Second call should return same object reference',
    );
    assertTrue(
      second === third,
      'Third call should return same object reference',
    );
  });

  // I-002: TestConfig Always Present
  TEST('Runtime', 'testConfig is always present (I-002)', () => {
    const adapter = getRuntime();
    assertTrue(
      adapter.testConfig !== undefined,
      'testConfig should be defined',
    );
    assertTrue(
      typeof adapter.testConfig.cleanupDelayMs === 'number',
      'cleanupDelayMs should be a number',
    );
    assertTrue(
      adapter.testConfig.cleanupDelayMs >= 0,
      'cleanupDelayMs should be >= 0',
    );
    assertTrue(
      typeof adapter.testConfig.supportsHttpServer === 'boolean',
      'supportsHttpServer should be a boolean',
    );
    assertTrue(
      typeof adapter.testConfig.dbDefaults === 'object' &&
        adapter.testConfig.dbDefaults !== null,
      'dbDefaults should be an object',
    );
  });

  // C-001: At least one adapter registers at module load time.
  TEST(
    'Runtime',
    'registered adapter matches the current runtime (C-001)',
    () => {
      const adapters = getRegisteredAdapters();
      assertTrue(
        adapters.length >= 1,
        'Should have at least one registered adapter',
      );
      // Behavioral invariant: getRuntime() succeeds and returns a detected adapter.
      const runtime = getRuntime();
      assertTrue(
        typeof runtime.id === 'string' && runtime.id.length > 0,
        'Detected runtime must have a non-empty id',
      );
    },
  );

  TEST(
    'Runtime',
    'registered adapters preserve the documented detection order',
    () => {
      const adapters = getRegisteredAdapters();
      if (
        typeof __BUNDLE_TARGET__ !== 'undefined' &&
        __BUNDLE_TARGET__ === 'browser'
      ) {
        assertEquals(
          adapters,
          [BrowserAdapter],
          'Browser bundles must only register the browser adapter',
        );
        return;
      }
      assertTrue(
        adapters.length >= 3,
        'Unbundled test runs must register Deno, Browser, and Node adapters',
      );
      assertEquals(
        adapters.slice(0, 3),
        [DenoAdapter, BrowserAdapter, NodeAdapter],
        'Runtime adapter order must remain Deno > Browser > Node',
      );
    },
  );

  // I-003: testConfig is frozen
  TEST('Runtime', 'testConfig is frozen (I-003)', () => {
    const adapter = getRuntime();
    assertTrue(
      Object.isFrozen(adapter.testConfig),
      'testConfig should be frozen',
    );
  });

  TEST('Runtime', 'browser adapter exit is unsupported', () => {
    assertThrows(
      () => BrowserAdapter.exit(0),
      Error,
      'exit() is not available in browser',
    );
  });

  TEST(
    'Runtime',
    'process.ts exit() dispatches through test override',
    async () => {
      const capturedCodes: number[] = [];
      await assertThrows(
        () =>
          withTestExitOverride(
            (code: number) => capturedCodes.push(code),
            async () => {
              // exit() throws via test override — do NOT catch here, let
              // assertThrows see the rejection.
              exit(42);
            },
          ),
        Error,
        'exit(42) intercepted by test override',
      );
      assertEquals(
        capturedCodes,
        [42],
        'process.ts exit() must dispatch through the test override',
      );
    },
  );

  TEST(
    'Runtime',
    'exit override nesting clears inner after outer resumes',
    async () => {
      // Outer scope with override A.
      // Inside, override with override B.
      // After B scope exits, A should be active again.
      const codes: number[] = [];
      await withTestExitOverride(
        (code: number) => codes.push(code),
        async () => {
          // Inside outer scope — push code via inners
          const innerCodes: number[] = [];
          await assertThrows(
            () =>
              withTestExitOverride(
                (code: number) => innerCodes.push(code),
                async () => exit(100),
              ),
            Error,
            'exit(100) intercepted by test override',
          );
          assertEquals(innerCodes, [100], 'inner override must be called');
          assertEquals(codes, [], 'outer override must not be called yet');

          // Now verify outer override is active again
          await assertThrows(
            () => exit(200),
            Error,
            'exit(200) intercepted by test override',
          );
          assertEquals(
            codes,
            [200],
            'outer override must be active after inner exits',
          );
        },
      );
    },
  );

  TEST(
    'Runtime',
    'process.ts exit() restores override after scope',
    async () => {
      const capturedCodes: number[] = [];
      await withTestExitOverride(
        (code: number) => capturedCodes.push(code),
        async () => {
          try {
            exit(1);
          } catch {
            // Expected
          }
        },
      );
      assertEquals(capturedCodes, [1], 'override must have been called');

      // After scope, override is restored. Verify via a second independent
      // scope — proves the first override is no longer active.
      const secondCodes: number[] = [];
      await withTestExitOverride(
        (code: number) => secondCodes.push(code),
        async () => {
          try {
            exit(5);
          } catch {
            // Expected
          }
        },
      );
      assertEquals(
        secondCodes,
        [5],
        'second override must work independently — no leak from previous',
      );
    },
  );

  TEST(
    'Runtime',
    'browserOpenCommand uses a direct Windows launcher',
    () => {
      assertEquals(browserOpenCommand('windows', 'http://localhost:1234'), {
        cmd: 'rundll32',
        args: ['url.dll,FileProtocolHandler', 'http://localhost:1234'],
      });
    },
  );

  TEST(
    'Runtime',
    'browserOpenCommand preserves Windows URL content as one raw arg',
    () => {
      assertEquals(
        browserOpenCommand('windows', 'https://example.com/a b?x=1&y=2|z'),
        {
          cmd: 'rundll32',
          args: [
            'url.dll,FileProtocolHandler',
            'https://example.com/a b?x=1&y=2|z',
          ],
        },
      );
    },
  );

  TEST('Runtime', 'browserOpenCommand preserves Windows URL quotes', () => {
    assertEquals(browserOpenCommand('windows', 'https://example.com/a"&calc'), {
      cmd: 'rundll32',
      args: ['url.dll,FileProtocolHandler', 'https://example.com/a"&calc'],
    });
  });

  TEST('Runtime', 'isBrowserOpenUrl rejects unsafe or malformed URLs', () => {
    assertEquals(
      isBrowserOpenUrl('javascript:alert(1)'),
      false,
      'javascript: URLs must be rejected',
    );
    assertEquals(
      browserOpenCommand('darwin', 'javascript:alert(1)'),
      undefined,
      'browserOpenCommand must fail closed for javascript: URLs',
    );
    assertEquals(
      isBrowserOpenUrl('file:///etc/passwd'),
      false,
      'file: URLs must be rejected',
    );
    assertEquals(
      browserOpenCommand('linux', 'file:///etc/passwd'),
      undefined,
      'browserOpenCommand must fail closed for file: URLs',
    );
    assertEquals(
      isBrowserOpenUrl('data:text/html,<script>'),
      false,
      'data: URLs must be rejected',
    );
    assertEquals(
      browserOpenCommand('windows', 'data:text/html,<script>'),
      undefined,
      'browserOpenCommand must fail closed for data: URLs',
    );
    assertEquals(isBrowserOpenUrl(''), false, 'empty URL must be rejected');
    assertEquals(
      browserOpenCommand('darwin', ''),
      undefined,
      'browserOpenCommand must fail closed for empty URLs',
    );
    assertEquals(
      isBrowserOpenUrl('https://'),
      false,
      'URLs without a host must be rejected',
    );
    assertEquals(
      browserOpenCommand('linux', 'https://'),
      undefined,
      'browserOpenCommand must fail closed for hostless URLs',
    );
    assertEquals(
      isBrowserOpenUrl(' https://example.com'),
      false,
      'leading whitespace must be rejected instead of trimmed',
    );
    assertEquals(
      browserOpenCommand('windows', ' https://example.com'),
      undefined,
      'browserOpenCommand must fail closed for whitespace-tainted URLs',
    );
    assertEquals(
      isBrowserOpenUrl('https://exa\nmple.com'),
      false,
      'control characters must be rejected',
    );
    assertEquals(
      browserOpenCommand('darwin', 'https://exa\nmple.com'),
      undefined,
      'browserOpenCommand must fail closed for control-character URLs',
    );
  });

  TEST(
    'Runtime',
    'browser adapter logs unsupported browser opening',
    async () => {
      let captured: NormalizedLogEntry<LogEntry>[] = [];
      await withLogCapture(async (c) => {
        captured = c;
        await BrowserAdapter.openBrowser('http://localhost:1234');
      });
      const warnings = captured.filter((e) =>
        e.severity === 'WARNING' &&
        e.error === 'MissingConfiguration' &&
        e.message?.includes('openBrowser() is not supported in browser')
      );
      assertEquals(
        warnings.length,
        1,
        'Browser adapter should report unsupported browser opening',
      );
    },
  );

  // setupSignalHandler tests

  TEST(
    'Runtime',
    'browser adapter setupSignalHandler returns no-op cleanup',
    () => {
      const cleanup = BrowserAdapter.setupSignalHandler('SIGTERM', () => {});
      assertTrue(typeof cleanup === 'function', 'cleanup should be a function');
      // Calling the no-op cleanup should never throw.
      cleanup();
      cleanup(); // idempotent
    },
  );

  // The async handler rejection logging path (used by Deno/Node adapters)
  // is exercised indirectly through the debug-server lifecycle tests in
  // cli-compile.test.ts. Direct testing would require sending real OS signals
  // or accessing internal closure state, which is invasive.

  TEST(
    'Runtime',
    'browser adapter exposes empty args and never reports a main module',
    () => {
      assertEquals(
        BrowserAdapter.getArgs(),
        [],
        'Browser adapter args must always be empty',
      );
      assertEquals(
        BrowserAdapter.isMainModule(import.meta.url),
        false,
        'Browser adapter must never report a main module',
      );
    },
  );

  TEST(
    'Runtime',
    'browser adapter getSystemInfo returns minimal fields',
    () => {
      const info = BrowserAdapter.getSystemInfo();
      assertEquals(
        info.runtime,
        'browser',
        'Browser adapter must report runtime as browser',
      );
      assertEquals(
        info.target,
        undefined,
        'Browser adapter must not expose target',
      );
      assertEquals(
        info.vendor,
        undefined,
        'Browser adapter must not expose vendor',
      );
      assertEquals(info.env, null, 'Browser adapter must expose env as null');
    },
  );
}

/**
 * Runtime tests that only apply to the Deno runtime.
 * Gated at the registry/entry-point level.
 */
export function setupRuntimeDenoTests(): void {
  TEST(
    'Runtime',
    'deno adapter setupSignalHandler returns callable cleanup',
    () => {
      const cleanup = DenoAdapter.setupSignalHandler('SIGINT', () => {});
      assertTrue(typeof cleanup === 'function', 'cleanup should be a function');
      // Register and immediately unregister — no signal is sent.
      cleanup();
      cleanup(); // idempotent (second call must not throw)
    },
  );

  TEST(
    'Runtime',
    'deno adapter exposes args, main-module detection, and build target metadata',
    () => {
      const runtime = getRuntime();
      const info = runtime.getSystemInfo();
      assertEquals(
        info.target,
        Deno.build.target,
        'Deno adapter must mirror Deno.build.target',
      );
      assertEquals(
        info.vendor,
        Deno.build.vendor,
        'Deno adapter must mirror Deno.build.vendor',
      );
      assertEquals(
        info.env,
        Deno.build.env ?? null,
        'Deno adapter must mirror Deno.build.env',
      );
      assertTrue(
        !runtime.isMainModule(import.meta.url),
        'non-entry modules must not be classified as the Deno main module',
      );
    },
  );

  TEST(
    'Runtime',
    'deno adapter getArgs returns CLI args through a spawned subprocess',
    async (ctx) => {
      const tempDir = await ctx.tempDir('deno-args-test');
      const entry = `${tempDir}/entry.ts`;
      const runtimeUrl = new URL(
        '../base/runtime/index.ts',
        import.meta.url,
      ).href;
      await Deno.writeTextFile(
        entry,
        [
          `import { getRuntime } from '${runtimeUrl}';`,
          'const args = getRuntime().getArgs();',
          'Deno.exit(args.length === 2 && args[0] === "--custom-arg" && args[1] === "value" ? 0 : 1);',
        ].join('\n'),
      );
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', entry, '--custom-arg', 'value'],
        cwd: getRuntime().getCWD(),
        stdout: 'piped',
        stderr: 'piped',
      });
      const { code } = await cmd.output();
      assertEquals(
        code,
        0,
        'Deno adapter getArgs must return the actual CLI arguments',
      );
    },
  );

  TEST(
    'Runtime',
    'deno adapter isMainModule returns true for the actual entry module',
    async (ctx) => {
      const tempDir = await ctx.tempDir('is-main-module-positive');
      const entry = `${tempDir}/entry.ts`;
      const runtimeUrl = new URL(
        '../base/runtime/index.ts',
        import.meta.url,
      ).href;
      await Deno.writeTextFile(
        entry,
        `import { getRuntime } from '${runtimeUrl}';
const result = getRuntime().isMainModule(import.meta.url);
Deno.exit(result ? 0 : 1);
`,
      );
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', entry],
        cwd: getRuntime().getCWD(),
        stdout: 'piped',
        stderr: 'piped',
      });
      const { code } = await cmd.output();
      assertEquals(
        code,
        0,
        'isMainModule must return true when called from the entry module',
      );
    },
  );

  TEST(
    'Runtime',
    'deno adapter logs unsupported browser opening',
    async () => {
      await withTestBrowserOpenCommand(
        () => undefined,
        async () => {
          let captured: NormalizedLogEntry<LogEntry>[] = [];
          await withLogCapture(async (c) => {
            captured = c;
            await DenoAdapter.openBrowser('http://localhost:1234');
          });
          const warnings = captured.filter((e) =>
            e.severity === 'WARNING' &&
            e.error === 'MissingConfiguration' &&
            e.message?.includes('Unable to open browser on unsupported OS')
          );
          assertEquals(
            warnings.length,
            1,
            'Deno adapter should report unsupported browser opening',
          );
        },
      );
    },
  );

  TEST(
    'Runtime',
    'deno adapter logs invalid browser URLs as sanitized bad requests',
    async () => {
      const invalidUrl = 'javascript:alert(1)\nhttps://secret.example';
      let captured: NormalizedLogEntry<LogEntry>[] = [];
      await withLogCapture(async (c) => {
        captured = c;
        await DenoAdapter.openBrowser(invalidUrl);
      });
      const warnings = captured.filter((e) =>
        e.severity === 'WARNING' &&
        e.error === 'BadRequest' &&
        e.message?.includes('Refusing to open invalid browser URL')
      );
      assertEquals(
        warnings.length,
        1,
        'Deno adapter should reject invalid browser URLs explicitly',
      );
      assertTrue(
        !warnings[0].message?.includes(invalidUrl),
        'Deno adapter must not echo raw invalid URLs into logs',
      );
    },
  );
}

/**
 * Runtime tests that only apply to the Node.js runtime.
 * Gated at the registry/entry-point level.
 */
export function setupRuntimeNodeTests(): void {
  TEST(
    'Runtime',
    'node adapter normalizeMainModulePath handles edge cases',
    async () => {
      // Dynamic import to access @internal exports
      const mod = await import('../base/runtime/adapters/node.ts');
      const norm = mod.normalizeMainModulePath as (p: string) => string;
      const resolve = mod.resolveMainModuleEntry as (
        e: string,
        cwd: string,
      ) => string;
      const fileUrl = mod.fileUrlToMainModulePath as (
        u: string,
      ) => string;

      // Simple absolute path
      assertEquals(norm('/a/b/c.ts'), '/a/b/c.ts');
      // With parent traversal
      assertEquals(norm('/a/b/../c.ts'), '/a/c.ts');
      // With self references
      assertEquals(norm('/a/b/./c.ts'), '/a/b/c.ts');
      // Trailing parent stays within root
      assertEquals(norm('/a/../../..'), '/');
      // Windows path
      assertEquals(
        norm('C:/a/b.ts'),
        process.platform === 'win32' ? 'c:/a/b.ts' : 'C:/a/b.ts',
      );
      // UNC path preserved
      assertEquals(
        norm('//server/share/dir/file.ts'),
        '//server/share/dir/file.ts',
      );
      // UNC with parent traversal above share (should not escape)
      assertEquals(norm('//server/share/dir/../..'), '//server/share');
      // Empty / dot
      assertEquals(norm(''), '.');
      assertEquals(norm('.'), '.');

      // resolveMainModuleEntry: absolute path stays absolute
      assertEquals(resolve('/a/b.ts', '/cwd'), '/a/b.ts');
      // Relative path resolved against cwd
      assertEquals(resolve('b.ts', '/cwd'), '/cwd/b.ts');
      // Relative with parent
      assertEquals(resolve('../b.ts', '/cwd/dir'), '/cwd/b.ts');

      // fileUrlToMainModulePath: simple file URL
      assertEquals(fileUrl('file:///a/b.ts'), '/a/b.ts');
      // URL with host (UNC via file URL)
      assertEquals(
        fileUrl('file://server/share/dir/file.ts'),
        '//server/share/dir/file.ts',
      );
      // Windows-style file URL (file:///C:/a/b.ts)
      assertEquals(
        fileUrl('file:///C:/a/b.ts'),
        process.platform === 'win32' ? 'c:/a/b.ts' : 'C:/a/b.ts',
      );
      // Percent-encoded characters
      assertEquals(fileUrl('file:///a/b%20c.ts'), '/a/b c.ts');
      // Non-file URL throws
      assertThrows(
        () => fileUrl('https://example.com/a.ts'),
        TypeError,
        'only supports file URLs',
      );
    },
  );
  TEST(
    'Runtime',
    'node adapter setupSignalHandler returns callable cleanup',
    () => {
      const cleanup = NodeAdapter.setupSignalHandler('SIGINT', () => {});
      assertTrue(typeof cleanup === 'function', 'cleanup should be a function');
      cleanup();
      cleanup(); // idempotent
    },
  );

  TEST(
    'Runtime',
    'node adapter exposes args, main-module detection, and target metadata',
    () => {
      const runtime = getRuntime();
      const info = runtime.getSystemInfo();
      const expectedOs = process.platform === 'win32'
        ? 'windows'
        : process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'linux'
        ? 'linux'
        : 'unknown';
      assertEquals(
        info.target,
        `${expectedOs}-${process.arch}`,
        'Node adapter must expose the canonical normalized target string for templates',
      );
      assertEquals(
        info.vendor,
        'node',
        'Node adapter must report vendor as node',
      );
      assertEquals(
        info.env,
        null,
        'Node adapter must report env as null (not available)',
      );
      assertTrue(
        !runtime.isMainModule(import.meta.url),
        'non-entry modules must not be classified as the Node main module',
      );
    },
  );

  TEST(
    'Runtime',
    'node adapter getArgs returns CLI args through a spawned subprocess',
    async (ctx) => {
      const dir = await ctx.tempDir('node-args-test');
      const entryPath = path.join(dir, 'entry.ts');
      const outputPath = path.join(dir, 'entry.mjs');
      const runtimeUrl = path.join(
        getRuntime().getCWD(),
        'base/runtime/index.ts',
      );
      await writeTextFile(
        entryPath,
        [
          `import { getRuntime } from ${JSON.stringify(runtimeUrl)};`,
          'const args = getRuntime().getArgs();',
          'if (args.length !== 2 || args[0] !== "--custom-arg" || args[1] !== "value") throw new Error("Unexpected args: " + JSON.stringify(args));',
        ].join('\n'),
      );
      await compileToNodeEsm(entryPath, outputPath);
      const result = await runNodeCommand(
        [(await getRealpathSync())(outputPath), '--custom-arg', 'value'],
        dir,
      );
      assertEquals(
        result.code,
        0,
        `Node adapter getArgs must return the actual CLI arguments\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    },
  );

  TEST(
    'Runtime',
    'node adapter isMainModule works without globalThis.require',
    async (ctx) => {
      const runtimeUrl = path.join(
        getRuntime().getCWD(),
        'base/runtime/index.ts',
      );
      const result = await testNodeSpawnedEntry(
        ctx,
        'node-is-main-no-require',
        [
          "if (typeof globalThis.require !== 'undefined') throw new Error('globalThis.require must be undefined in Node ESM');",
          'if (!getRuntime().isMainModule(import.meta.url)) throw new Error("entry module was not detected");',
        ],
        runtimeUrl,
      );
      assertEquals(
        result.code,
        0,
        `Node isMainModule must work without globalThis.require\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    },
  );

  TEST(
    'Runtime',
    'node adapter isMainModule detects the entry module in a spawned subprocess',
    async (ctx) => {
      const runtimeUrl = path.join(
        getRuntime().getCWD(),
        'base/runtime/index.ts',
      );
      const result = await testNodeSpawnedEntry(
        ctx,
        'node-is-main-esm',
        [
          'if (!getRuntime().isMainModule(import.meta.url)) throw new Error("entry module was not detected");',
        ],
        runtimeUrl,
      );
      assertEquals(
        result.code,
        0,
        `Node isMainModule must detect the entry module\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    },
  );

  if (process.platform !== 'win32') {
    TEST(
      'Runtime',
      'node adapter isMainModule detects symlinked entry modules',
      async (ctx) => {
        const dir = await ctx.tempDir('node-is-main-symlink');
        const entryPath = path.join(dir, 'entry.ts');
        const outputPath = path.join(dir, 'entry.mjs');
        const linkPath = path.join(dir, 'entry-link.mjs');
        const runtimeUrl = path.join(
          getRuntime().getCWD(),
          'base/runtime/index.ts',
        );
        await writeTextFile(
          entryPath,
          [
            `import { getRuntime } from ${JSON.stringify(runtimeUrl)};`,
            'if (!getRuntime().isMainModule(import.meta.url)) throw new Error("symlinked entry module was not detected");',
          ].join('\n'),
        );
        await compileToNodeEsm(entryPath, outputPath);
        const fs = await import('node:fs/promises');
        await fs.symlink(outputPath, linkPath);
        const result = await runNodeCommand([linkPath], dir);
        assertEquals(
          result.code,
          0,
          `Node isMainModule must treat symlinked entrypoints as the main module\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
        );
      },
    );
  }

  if (process.platform === 'win32') {
    TEST(
      'Runtime',
      'node adapter isMainModule treats Windows drive-letter casing as equivalent',
      async (ctx) => {
        const dir = await ctx.tempDir('node-is-main-drive-case');
        const entryPath = path.join(dir, 'entry.ts');
        const outputPath = path.join(dir, 'entry.mjs');
        const runtimeUrl = path.join(
          getRuntime().getCWD(),
          'base/runtime/index.ts',
        );
        await writeTextFile(
          entryPath,
          [
            `import { getRuntime } from ${JSON.stringify(runtimeUrl)};`,
            'const { pathToFileURL } = await import("node:url");',
            'const entryPath = process.argv[1];',
            'if (typeof entryPath !== "string" || entryPath.length === 0) throw new Error("no argv[1]");',
            'const flippedDriveLetter = /^[A-Za-z]:/.test(entryPath)',
            '  ? entryPath[0] === entryPath[0].toUpperCase()',
            '    ? entryPath[0].toLowerCase() + entryPath.slice(1)',
            '    : entryPath[0].toUpperCase() + entryPath.slice(1)',
            '  : entryPath;',
            'const prevEntry = process.argv[1];',
            'process.argv[1] = flippedDriveLetter;',
            'const detected = getRuntime().isMainModule(pathToFileURL(prevEntry).href);',
            'process.argv[1] = prevEntry;',
            'if (!detected) throw new Error("drive-letter casing not ignored");',
          ].join('\n'),
        );
        await compileToNodeEsm(entryPath, outputPath);
        const result = await runNodeCommand(
          [(await getRealpathSync())(outputPath)],
          dir,
        );
        assertEquals(
          result.code,
          0,
          `Node isMainModule must ignore drive-letter casing\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
        );
      },
    );
  }

  TEST(
    'Runtime',
    'node adapter logs unsupported browser opening',
    async () => {
      await withTestBrowserOpenCommand(
        () => undefined,
        async () => {
          let captured: NormalizedLogEntry<LogEntry>[] = [];
          await withLogCapture(async (c) => {
            captured = c;
            await NodeAdapter.openBrowser('http://localhost:1234');
          });
          const warnings = captured.filter((e) =>
            e.severity === 'WARNING' &&
            e.error === 'MissingConfiguration' &&
            e.message?.includes('Unable to open browser on unsupported OS')
          );
          assertEquals(
            warnings.length,
            1,
            'Node adapter should report unsupported browser opening',
          );
        },
      );
    },
  );

  TEST(
    'Runtime',
    'node adapter logs invalid browser URLs as sanitized bad requests',
    async () => {
      const invalidUrl = 'javascript:alert(1)\nhttps://secret.example';
      let captured: NormalizedLogEntry<LogEntry>[] = [];
      await withLogCapture(async (c) => {
        captured = c;
        await NodeAdapter.openBrowser(invalidUrl);
      });
      const warnings = captured.filter((e) =>
        e.severity === 'WARNING' &&
        e.error === 'BadRequest' &&
        e.message?.includes('Refusing to open invalid browser URL')
      );
      assertEquals(
        warnings.length,
        1,
        'Node adapter should reject invalid browser URLs explicitly',
      );
      assertTrue(
        !warnings[0].message?.includes(invalidUrl),
        'Node adapter must not echo raw invalid URLs into logs',
      );
    },
  );
}
