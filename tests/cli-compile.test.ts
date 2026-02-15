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
import { isBrowser } from '../base/common.ts';
import { pathExists } from '../base/json-log/file-impl.ts';
import { denoTarget, targetFromOSArch } from '../cli/compile.ts';
import { goatEntryPoints } from '../cli/link.ts';
import { readTextFile } from '../base/json-log/file-impl.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { cli } from '../base/development.ts';
import { getEnvVar } from '../base/os.ts';

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

      // Skip in CI for Node.js - postject is not available
      const runtime = getRuntime();
      if (runtime.id === 'node' && getEnvVar('CI')) {
        console.log(
          'Skipping Node.js E2E compile test in CI (postject not available)',
        );
        return;
      }

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
        cssPath: path.join(testDir, 'client/index.css'),
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
