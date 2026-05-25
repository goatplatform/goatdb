/**
 * Tests for the CLI compile functionality to verify cross-platform compilation.
 *
 * This test suite verifies that the compile script correctly:
 * - Routes to the appropriate compiler (Deno compile vs Node.js SEA)
 * - Handles unsupported runtimes gracefully
 * - Produces working executables (E2E test)
 */

import { TEST, type TestSuite } from './mod.ts';
import {
  assertEquals,
  assertExists,
  assertThrows,
  assertTrue,
} from './asserts.ts';
import * as path from '../base/path.ts';
import { isBrowser, isDeno, isNode } from '../base/common.ts';
import {
  mkdir,
  pathExists,
  readTextFile,
  writeTextFile,
} from '../base/json-log/file-impl.ts';
import { getEnvVar } from '../base/os.ts';
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
  stopBackgroundCompiler,
} from '../build.ts';

import {
  buildAssets,
  buildCombinedCSS,
  countNewlines,
} from '../cli/build-assets.ts';
import { startDebugServer } from '../cli/debug-server.ts';
import type { StaticAssets } from '../system-assets/system-assets.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { goatEntryPoints } from '../cli/link.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { cli } from '../base/development.ts';
import {
  getGlobalLoggerStreams,
  setGlobalLoggerStreams,
} from '../logging/log.ts';
import type { LogEntry } from '../logging/log.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';

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

function withLogCapture<T>(
  fn: (captured: NormalizedLogEntry<LogEntry>[]) => Promise<T>,
): Promise<T> {
  const captured: NormalizedLogEntry<LogEntry>[] = [];
  const previousStreams = getGlobalLoggerStreams();
  setGlobalLoggerStreams([{
    appendEntry(e: NormalizedLogEntry<LogEntry>): void {
      captured.push(e);
    },
  }]);
  return fn(captured).finally(() => setGlobalLoggerStreams(previousStreams));
}

import {
  DENO_ONLY_FILTER_TEST,
  NODE_ONLY_FILTER_TEST,
} from './test-filter-constants.ts';

export default function setupCliCompileTests() {
  if (getRuntime().id === 'node') {
    TEST(
      'CLI-Compile',
      NODE_ONLY_FILTER_TEST,
      async () => {
        await assertThrows(
          async () => {
            await createBuildContext([{
              in: '/tmp/entry.ts',
              out: APP_ENTRY_POINT,
            }]);
          },
          Error,
          'createBuildContext() is only supported in Deno',
        );
      },
    );
  }

  if (getRuntime().id === 'node') {
    TEST(
      'CLI-Compile',
      'startDebugServer fails clearly on Node.js',
      async () => {
        let setupCalled = false;
        await assertThrows(
          async () => {
            await startDebugServer({
              buildDir: './build',
              jsPath: './client/index.tsx',
              path: './server-data',
              setup: () => {
                setupCalled = true;
              },
            } as never);
          },
          Error,
          'startDebugServer() is only supported in Deno',
        );
        assertTrue(
          !setupCalled,
          'startDebugServer must fail before running user setup on Node.js',
        );
      },
    );
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (isNode()) {
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
                  windows: {
                    certFile: certPath,
                    certPassword: 'secret',
                  },
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (isNode()) {
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
  }

  if (isNode()) {
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

        // bundleServerForSEA uses esbuild's background service; stop it after the
        // test so the process can exit cleanly.
        try {
          await bundleServerForSEA(entryPath, outPath);
        } finally {
          await stopBackgroundCompiler();
        }

        const content = await readTextFile(outPath);
        assertExists(content, 'output file should be readable');
        const text = content!;
        assertTrue(text.length > 0, 'output file must not be empty');
        // esbuild's bundle mode (bundle: true) wraps all exports into a CJS module
        // via `module.exports = __toCommonJS(entry_exports)`. This pattern is absent
        // from ESM output and confirms the bundle is CJS, not ESM.
        assertTrue(
          text.includes('module.exports'),
          'CJS output must assign module.exports',
        );
      },
    );
  }

  if (!isBrowser()) {
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
        // Global CSS file — should be prepended via cssPath
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
            // Node path only — Deno path requires a deno.json in CWD for @deno/esbuild-plugin and is
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
  }

  if (isDeno()) {
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
          // Source map must also be emitted for the deno path
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
          // Verify the map actually references the original source file.
          // Single-chunk path returns an esbuild map directly (no sections wrapper).
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (isDeno()) {
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
  }

  if (isDeno()) {
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
  }

  if (isDeno()) {
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
        // deno-lint-ignore no-explicit-any
        const testPlugin: any = {
          name: 'test-plugin',
          setup(build: any) {
            build.onResolve({ filter: /^testplugin:/ }, (args: any) => ({
              path: args.path,
              namespace: 'testplugin',
            }));
            build.onLoad({ filter: /.*/, namespace: 'testplugin' }, () => ({
              contents: 'export const __sentinel__ = "ctx-plugin-was-here";',
              loader: 'js',
            }));
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
  }

  if (isDeno()) {
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
        // deno-lint-ignore no-explicit-any
        const localCssPlugin: any = {
          name: 'ctx-local-css-rewriter',
          setup(build: any) {
            build.onResolve(
              { filter: /^\.\/style\.css$/, namespace: 'file' },
              () => ({ path: rewrittenCssPath, namespace: 'file' }),
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
  }

  if (isDeno()) {
    TEST(
      'CLI-Compile',
      'buildAssets ignores BuildAssetsOptions.esbuildPlugins when ReBuildContext is provided',
      async (ctx: TestSuite) => {
        const dir = await ctx.tempDir('build-assets-ctx-plugin-ignored');
        await writeTextFile(path.join(dir, 'entry.ts'), 'export {};\n');
        const entryPoints = [{
          in: path.join(dir, 'entry.ts'),
          out: APP_ENTRY_POINT,
        }];
        const rebuildCtx = await createBuildContext(entryPoints);

        let pluginSetupCalled = false;
        // deno-lint-ignore no-explicit-any
        const sentinelPlugin: any = {
          name: 'sentinel',
          setup() {
            pluginSetupCalled = true;
          },
        };

        try {
          await buildAssets(rebuildCtx, entryPoints, {
            buildDir: dir,
            jsPath: path.join(dir, 'entry.ts'),
          }, { esbuildPlugins: [sentinelPlugin] });
          assertTrue(
            !pluginSetupCalled,
            'esbuildPlugins must not be applied when a ReBuildContext is passed',
          );
        } finally {
          rebuildCtx.close();
          await stopBackgroundCompiler();
        }
      },
    );
  }

  if (!isBrowser()) {
    TEST(
      'CLI-Compile',
      'cssLoaderPlugin resolves CSS @import chains via resolveDir',
      async (ctx: TestSuite) => {
        const dir = await ctx.tempDir('css-import-chain');
        // b.css is the leaf — contains the sentinel
        await writeTextFile(
          path.join(dir, 'b.css'),
          ':root { --chain-sentinel: 1; }',
        );
        // a.css @imports b.css — tests resolveDir resolution
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
  }

  if (!isBrowser()) {
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
  }

  if (isDeno()) {
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
  }

  if (isDeno()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
    TEST(
      'CLI-Compile',
      'buildAssets with cssPath only emits no /index.css.map and no sourceMappingURL',
      async (ctx: TestSuite) => {
        const dir = await ctx.tempDir('build-assets-cssonly-no-map');
        await writeTextFile(
          path.join(dir, 'vendor.css'),
          ':root { --cssonly-sentinel: 1; }\n',
        );
        // Entry point imports no CSS — only cssPath is set
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
  }

  if (!isBrowser()) {
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
  }

  // Heavy E2E test — resource-intensive, recommended to run in isolation
  // This test is expensive as it:
  // 1. Bootstraps a full project
  // 2. Installs dependencies
  // 3. Compiles to binary
  // 4. Starts the server
  // 5. Verifies HTTP responses
  //
  // To run: deno task test --test="should compile executable"
  if (!isBrowser()) {
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
  }

  TEST(
    'CLI-Compile',
    'buildCombinedCSS handles multi-chunk source maps correctly',
    () => {
      // Single chunk with map → direct map, not sections format
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

      // Two chunks, both mapped → sections format with correct offsets
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

      // Two chunks, first unmapped (cssPath), second mapped → sections with only second
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

      // No mapped chunks → no cssMap
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

  if (!isBrowser()) {
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
  }

  if (isNode()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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
  }

  if (!isBrowser()) {
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

  if (isDeno()) {
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
        assertExists(
          result.outputFiles,
          'compilation must produce output files',
        );
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
  }
}
