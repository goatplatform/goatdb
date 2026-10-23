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
import { isBrowser, isNode } from '../base/common.ts';
import {
  pathExists,
  readTextFile,
  writeTextFile,
} from '../base/json-log/file-impl.ts';
import {
  bundleServerForSEA,
  denoExecutableName,
  denoTarget,
  targetFromOSArch,
} from '../cli/compile.ts';
import { stopBackgroundCompiler } from '../build.ts';
import { goatEntryPoints } from '../cli/link.ts';
import type { Plugin } from 'esbuild';
import { getRuntime } from '../base/runtime/index.ts';
import { cli } from '../base/development.ts';
import { assertScaffoldTemplates, denoInfo } from './cli-template-utils.ts';

async function readJsonFile<T>(filePath: string): Promise<T> {
  const text = await readTextFile(filePath);
  assertExists(text, `Expected JSON file at ${filePath}`);
  return JSON.parse(text) as T;
}

/**
 * Fails if the scaffold resolves GoatDB from a registry instead of the checkout.
 * This is the regression guard for the E2E installing the published package.
 */
async function assertLocalGoatDB(
  testDir: string,
  goatdbRoot: string,
): Promise<void> {
  if (getRuntime().id === 'deno') {
    const denoJson = await readJsonFile<{
      imports?: Record<string, string>;
    }>(path.join(testDir, 'deno.json'));
    const goatdbImports = Object.entries(denoJson.imports ?? {}).filter((
      [key],
    ) => key === '@goatdb/goatdb' || key.startsWith('@goatdb/goatdb/'));
    assertTrue(goatdbImports.length > 0, 'Expected GoatDB import mappings');
    for (const [key, value] of goatdbImports) {
      assertTrue(
        value.startsWith('./vendor/goatdb/'),
        `${key} must point at the local checkout, got ${value}`,
      );
      assertTrue(
        !value.startsWith('jsr:@goatdb/goatdb'),
        `${key} must not resolve the published JSR package`,
      );
    }
    assertEquals(
      await Deno.realPath(path.join(testDir, 'vendor/goatdb')),
      await Deno.realPath(goatdbRoot),
      'vendor/goatdb must resolve to the checkout',
    );
    return;
  }

  const projectPkg = await readJsonFile<{
    dependencies?: Record<string, string>;
  }>(path.join(testDir, 'package.json'));
  const dependency = projectPkg.dependencies?.['@goatdb/goatdb'];
  assertExists(dependency, 'Expected @goatdb/goatdb dependency');
  assertTrue(
    dependency.startsWith('file:'),
    `@goatdb/goatdb must use the local file protocol, got ${dependency}`,
  );
  const installedPkg = await readJsonFile<{ version: string }>(
    path.join(testDir, 'node_modules/@goatdb/goatdb/package.json'),
  );
  const checkoutPkg = await readJsonFile<{ version: string }>(
    path.join(goatdbRoot, 'package.json'),
  );
  assertEquals(
    installedPkg.version,
    checkoutPkg.version,
    'Installed GoatDB must be the checkout, not the published package',
  );
}

/**
 * Adds the template-only npm imports that GoatDB does not export. `linkGoatDB`
 * injects the checkout's own import map, so only these two remain external.
 * Specs come from the scaffold's own list, so the E2E resolves the same ranges
 * `init` installs.
 */
async function addDenoTemplateImports(
  testDir: string,
  npmDependencies: Readonly<Record<string, string>>,
): Promise<void> {
  const denoJsonPath = path.join(testDir, 'deno.json');
  const denoJson = await readJsonFile<{
    imports?: Record<string, string>;
  }>(denoJsonPath);
  const imports = denoJson.imports ?? {};
  const reactDomClient = npmDependencies['react-dom/client'];
  const typesReact = npmDependencies['@types/react'];
  assertExists(reactDomClient, 'Missing react-dom/client scaffold spec');
  assertExists(typesReact, 'Missing @types/react scaffold spec');
  imports['react-dom/client'] ??= reactDomClient;
  imports['@types/react'] ??= typesReact;
  denoJson.imports = imports;
  await writeTextFile(denoJsonPath, JSON.stringify(denoJson, null, 2) + '\n');
}

export default function setupCliCompileTests() {
  TEST(
    'CLI-Compile',
    'should compute target OS/arch correctly',
    async () => {
      // Skip in browser
      if (isBrowser()) return;

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
      if (isBrowser()) return;
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
      if (isBrowser()) return;
      assertEquals(denoTarget('mac', 'x64'), 'x86_64-apple-darwin');
      assertEquals(denoTarget('mac', 'arm64'), 'aarch64-apple-darwin');
      assertEquals(denoTarget('linux', 'x64'), 'x86_64-unknown-linux-gnu');
      assertEquals(denoTarget('linux', 'arm64'), 'aarch64-unknown-linux-gnu');
      assertEquals(denoTarget('windows', 'x64'), 'x86_64-pc-windows-msvc');
    },
  );

  TEST(
    'CLI-Compile',
    'denoExecutableName appends .exe only for Windows targets',
    () => {
      if (isBrowser()) return;
      // Deno appends `.exe` based on the TARGET OS, not the host, so this
      // cross-platform check guards the path for cross-compiled Windows
      // binaries without running a Windows host.
      assertEquals(denoExecutableName('app', 'mac-arm64'), 'app-mac-arm64');
      assertEquals(denoExecutableName('app', 'linux-x64'), 'app-linux-x64');
      assertEquals(
        denoExecutableName('app', 'windows-x64'),
        'app-windows-x64.exe',
      );
    },
  );

  TEST(
    'CLI-Compile',
    'goatEntryPoints should match deno.json exports',
    async () => {
      if (isBrowser()) return;
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
    'bundleServerForSEA produces valid CJS',
    async (ctx) => {
      if (!isNode()) return;

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

  // Heavy E2E test — resource-intensive, recommended to run in isolation
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
      // Skip in browser - compilation not supported
      if (isBrowser()) {
        console.log('Skipping E2E compile test in browser');
        return;
      }

      const runtime = getRuntime();

      // This is a heavy E2E test - mark it as such
      console.log('Running E2E compile test (this may take a while)...');

      const testDir = await ctx.tempDir('compile-e2e');

      // 1. Bootstrap without touching the registry. The generated project
      // must resolve GoatDB from this checkout, never from the published
      // package; otherwise the E2E proves nothing about the current code.
      console.log('Bootstrapping project...');
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      // Verify project was created
      assertTrue(
        await pathExists(path.join(testDir, 'client/index.tsx')),
        'Project should be bootstrapped',
      );

      // Templates are copied before linking. Linking patches config and
      // .gitignore, so assert the scaffold effect first.
      await assertScaffoldTemplates(
        testDir,
        runtime.id === 'deno' ? 'deno' : 'node',
        runtime.getCWD(),
      );

      // 2. Link the checkout before installing anything, so installation can
      // only observe the local source.
      console.log('Linking to local GoatDB sources...');
      const linkModule = await import('../cli/link.ts');

      // In bundled Node.js, import.meta.url points to bundled code, not original source.
      // Use the runtime's CWD which should be the goatdb repo root during tests.
      const goatdbRoot = runtime.getCWD();
      await linkModule.linkGoatDB(goatdbRoot, testDir);

      if (runtime.id === 'deno') {
        await addDenoTemplateImports(
          testDir,
          initModule.kDenoTemplateNpmDependencies,
        );
      } else {
        console.log(
          'Installing template dependencies against the local link...',
        );
        const installResult = await cli('npm', 'install', {
          cwd: testDir,
          timeout: 180_000,
        });
        if (installResult.exitCode !== 0) {
          throw new Error(
            `npm install failed with exit code ${installResult.exitCode}:\n${installResult.result}`,
          );
        }
      }

      await assertLocalGoatDB(testDir, goatdbRoot);

      // Resolve the real graph, not only the config that describes it.
      if (runtime.id === 'deno') {
        const info = await denoInfo(testDir, 'client/index.tsx');
        // WHY normalize separators: `deno info` reports native paths, so a
        // POSIX-only containment check silently misses Windows.
        const inVendor = (local: string | undefined) =>
          (local ?? '').replaceAll('\\', '/').includes('/vendor/goatdb/');
        assertTrue(
          info.modules.some((module) => inVendor(module.local)),
          'Generated graph must resolve GoatDB from vendor/goatdb',
        );
        assertTrue(
          !info.modules.some((module) =>
            module.specifier.includes('jsr:@goatdb/goatdb')
          ),
          'Generated graph must not resolve the published JSR package',
        );
      }

      // 3. Compile the project
      console.log('Compiling project...');
      const { compile } = await import('../cli/compile.ts');

      // Determine server entry based on runtime
      const serverEntry = runtime.id === 'node'
        ? path.join(testDir, 'server/server-sea.ts')
        : path.join(testDir, 'server/server.ts');

      let pluginBuilds = 0;
      const buildPlugin: Plugin = {
        name: 'compile-e2e-plugin',
        setup(build) {
          build.onEnd((result) => {
            assertEquals(result.errors.length, 0, 'Plugin build must succeed');
            pluginBuilds++;
          });
        },
      };
      const binaryPath = await compile({
        buildDir: path.join(testDir, 'build'),
        serverEntry,
        jsPath: path.join(testDir, 'client/index.tsx'),
        htmlPath: path.join(testDir, 'client/index.html'),
        cssPath: path.join(testDir, 'client/index.css'),
        outputName: 'test-app',
        esbuildPlugins: [buildPlugin],
        // Use deno.json or package.json based on runtime
        ...(runtime.id === 'deno'
          ? { denoJson: path.join(testDir, 'deno.json') }
          : { packageJson: path.join(testDir, 'package.json') }),
      });

      assertEquals(pluginBuilds, 1, 'Compile must invoke configured plugin');

      // 4. Verify binary exists. `compile` returns the compiler's real output
      // path (including `.exe` for Windows targets), so the test never
      // re-derives the platform-specific name.
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
