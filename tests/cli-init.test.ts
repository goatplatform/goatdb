/**
 * Tests for the CLI init script to verify cross-platform scaffolding functionality.
 *
 * This test suite verifies that the init script correctly:
 * - Detects the runtime environment (Deno vs Node.js)
 * - Creates appropriate project scaffolds for each platform
 * - Uses correct import extensions for each runtime
 * - Creates proper directory structures
 * - Respects existing files (doesn't overwrite)
 */

import { TEST, type TestSuite } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { isDeno, isNode } from '../base/common.ts';
import {
  getCWD,
  mkdir,
  pathExists,
  readTextFile,
  writeTextFile,
} from '../base/json-log/file-impl.ts';
import { assertScaffoldTemplates, readJson } from './cli-template-utils.ts';

/**
 * Helper function to check if a file exists
 */
async function fileExists(filePath: path.PosixPath): Promise<boolean> {
  return await pathExists(filePath);
}

async function invalidInstallProject(ctx: TestSuite): Promise<string> {
  const testDir = await ctx.tempDir('install-failure');
  const configName = isDeno() ? 'deno.json' : 'package.json';
  // Invalid JSON fails before registry access, with a real manager diagnostic.
  await writeTextFile(path.join(testDir, configName), '{ invalid json');
  return testDir;
}

function assertInstallFailure(message: string): void {
  const command = isDeno() ? 'deno add' : 'npm install';
  const failure = message.match(
    /failed with exit code ([1-9]\d*):\s*([\s\S]+)/,
  );
  assertTrue(message.includes(command), `Missing command: ${message}`);
  assertExists(failure, `Missing numeric nonzero exit or output: ${message}`);
  const diagnostic = failure[2];
  assertTrue(
    isDeno()
      ? /parse|syntax|expected/i.test(diagnostic) &&
        diagnostic.includes('deno.json')
      : diagnostic.includes('EJSONPARSE') &&
        diagnostic.includes('package.json'),
    `Missing package-manager JSON diagnostic: ${diagnostic}`,
  );
}

export default function setupCliInitTests() {
  TEST(
    'CLI-Init',
    'should detect runtime correctly',
    async (ctx: TestSuite) => {
      // Test runtime detection
      const runtime = isDeno() ? 'deno' : isNode() ? 'node' : 'browser';
      assertTrue(
        runtime === 'deno' || runtime === 'node',
        `Expected deno or node, got ${runtime}`,
      );
    },
  );

  TEST(
    'CLI-Init',
    'should copy template files for current runtime',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-scaffold');

      // Import and run the init script with target directory (skip deps for fast tests)
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      // Verify core files exist
      assertTrue(
        await fileExists(path.join(testDir, 'client/index.html')),
        'client/index.html should exist',
      );
      assertTrue(
        await fileExists(path.join(testDir, 'client/index.css')),
        'client/index.css should exist',
      );
      assertTrue(
        await fileExists(path.join(testDir, 'client/index.tsx')),
        'client/index.tsx should exist',
      );
      assertTrue(
        await fileExists(path.join(testDir, 'client/app.tsx')),
        'client/app.tsx should exist',
      );
      assertTrue(
        await fileExists(path.join(testDir, 'common/schema.ts')),
        'common/schema.ts should exist',
      );
      assertTrue(
        await fileExists(path.join(testDir, 'server/debug-server.ts')),
        'server/debug-server.ts should exist',
      );
      assertTrue(
        await fileExists(path.join(testDir, 'server/server.ts')),
        'server/server.ts should exist',
      );
      assertTrue(
        await fileExists(path.join(testDir, 'server/build.ts')),
        'server/build.ts should exist',
      );
      assertTrue(
        await fileExists(path.join(testDir, '.gitignore')),
        '.gitignore should exist',
      );

      // Verify runtime-specific config files
      if (isDeno()) {
        assertTrue(
          await fileExists(path.join(testDir, 'deno.json')),
          'deno.json should exist for Deno runtime',
        );
      } else if (isNode()) {
        assertTrue(
          await fileExists(path.join(testDir, 'package.json')),
          'package.json should exist for Node runtime',
        );
        assertTrue(
          await fileExists(path.join(testDir, 'tsconfig.json')),
          'tsconfig.json should exist for Node runtime',
        );
        assertTrue(
          await fileExists(path.join(testDir, '.npmrc')),
          '.npmrc should exist for Node runtime',
        );
        assertTrue(
          await fileExists(path.join(testDir, 'server', 'server-sea.ts')),
          'server/server-sea.ts should exist for Node runtime',
        );
      }
    },
  );

  TEST(
    'CLI-Init',
    'generated files match runtime templates byte-for-byte',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-template-bytes');
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });
      await assertScaffoldTemplates(
        testDir,
        isDeno() ? 'deno' : 'node',
        await getCWD(),
      );
    },
  );

  TEST(
    'CLI-Init',
    'generated config preserves the template contract',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-config-contract');
      const root = await getCWD();
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      if (isDeno()) {
        const actual = await readJson<Record<string, unknown>>(
          path.join(testDir, 'deno.json'),
        );
        const template = await readJson<Record<string, unknown>>(
          path.join(root, 'cli/templates/deno/deno.json'),
        );
        assertExists(actual, 'Generated deno.json missing');
        assertExists(template, 'Deno template missing');
        assertEquals(actual.tasks, template.tasks, 'deno.json tasks drift');
        assertEquals(
          actual.compilerOptions,
          template.compilerOptions,
          'deno.json compilerOptions drift',
        );
        assertEquals(actual.version, template.version);
      } else {
        const actual = await readJson<{
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          engines?: Record<string, string>;
          type?: string;
        }>(path.join(testDir, 'package.json'));
        const template = await readJson<{
          dependencies?: Record<string, string>;
        }>(path.join(root, 'cli/templates/node/package.json'));
        assertExists(actual, 'Generated package.json missing');
        assertExists(template, 'Node template missing');
        assertEquals(
          actual.dependencies,
          template.dependencies,
          'package.json dependencies drift',
        );
        assertEquals(
          template.dependencies?.react,
          template.dependencies?.['react-dom'],
          'react and react-dom ranges must match',
        );
        assertEquals(actual.type, 'module');
        assertEquals(actual.engines?.node, '>=24.0.0');
        assertEquals(actual.devDependencies?.['@types/node'], '^24.0.0');
      }
    },
  );

  TEST(
    'CLI-Init',
    'should use correct import extensions',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-imports');

      // Run init script (skip deps for fast tests)
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      // Read client/index.tsx to check imports
      const indexContent = await readTextFile(
        path.join(testDir, 'client/index.tsx'),
      );

      if (indexContent && isDeno()) {
        // Deno should use .tsx/.ts extensions
        assertTrue(
          indexContent.includes("from './app.tsx'"),
          'Deno should use .tsx extension',
        );
        assertTrue(
          indexContent.includes("from '../common/schema.ts'"),
          'Deno should use .ts extension',
        );
      } else if (indexContent && isNode()) {
        // Node.js should use .js extensions
        assertTrue(
          indexContent.includes("from './app.js'"),
          'Node.js should use .js extension',
        );
        assertTrue(
          indexContent.includes("from '../common/schema.js'"),
          'Node.js should use .js extension',
        );
      } else {
        assertTrue(false, 'Failed to read index.tsx file');
      }
    },
  );

  TEST(
    'CLI-Init',
    'should align shutdown force-exit with the drain budget',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-shutdown');

      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      const serverFiles = isDeno()
        ? ['server/server.ts']
        : ['server/server.ts', 'server/server-sea.ts'];
      for (const file of serverFiles) {
        const text = await readTextFile(path.join(testDir, file));
        assertExists(text, `${file} should exist`);
        assertTrue(
          text.includes('DEFAULT_STOP_TIMEOUT_MS'),
          `${file} must use the drain budget`,
        );
        assertTrue(
          !text.includes('5000'),
          `${file} must not hardcode a 5s force exit`,
        );
      }
    },
  );

  TEST(
    'CLI-Init',
    'should not overwrite existing files',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-no-overwrite');
      // Create existing file with custom content
      await mkdir(path.join(testDir, 'client'));
      const customContent = '/* Custom CSS Content */\\nbody { color: red; }';
      await writeTextFile(
        path.join(testDir, 'client/index.css'),
        customContent,
      );

      // Run init script (skip deps for fast tests)
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      // Verify file was not overwritten
      const content = await readTextFile(
        path.join(testDir, 'client/index.css'),
      );
      assertEquals(
        content || '',
        customContent,
        'Existing file should not be overwritten',
      );
    },
  );

  TEST(
    'CLI-Init',
    'should create valid template content',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-content');
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      const expectations = [
        ['client/index.html', '<div id="root">'],
        ['client/app.tsx', 'useDBReady'],
        ['common/schema.ts', 'registerSchemas'],
      ] as const;
      for (const [file, marker] of expectations) {
        const content = await readTextFile(path.join(testDir, file));
        assertTrue(
          content?.includes(marker) || false,
          `${file} must contain ${marker}`,
        );
      }
    },
  );

  TEST(
    'CLI-Init',
    'dependency install failures are explicit',
    async (ctx: TestSuite) => {
      const testDir = await invalidInstallProject(ctx);

      const initModule = await import('../cli/init.ts');
      let error: unknown;
      try {
        await initModule.bootstrapProject({ targetDir: testDir });
      } catch (caught) {
        error = caught;
      }

      assertInstallFailure(
        error instanceof Error ? error.message : String(error),
      );
    },
  );
}
