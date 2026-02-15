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

/**
 * Helper function to check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  return await pathExists(filePath);
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
    'should create correct directory structure',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-structure');

      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      // Verify directory structure exists
      assertTrue(
        await pathExists(path.join(testDir, 'client')),
        'client directory should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, 'server')),
        'server directory should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, 'common')),
        'common directory should exist',
      );
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

      // Verify HTML template has basic structure
      const htmlContent = await readTextFile(
        path.join(testDir, 'client/index.html'),
      );
      assertTrue(
        htmlContent?.includes('<!DOCTYPE html>') || false,
        'HTML should have doctype',
      );
      assertTrue(
        htmlContent?.includes('<div id="root">') || false,
        'HTML should have root div',
      );

      // Verify React app template
      const appContent = await readTextFile(
        path.join(testDir, 'client/app.tsx'),
      );
      assertTrue(
        appContent?.includes('export function App') || false,
        'App component should be exported',
      );
      assertTrue(
        appContent?.includes('useDBReady') || false,
        'App should use GoatDB hook',
      );

      // Verify schema template
      const schemaContent = await readTextFile(
        path.join(testDir, 'common/schema.ts'),
      );
      assertTrue(
        schemaContent?.includes('kSchemaMyItem') || false,
        'Schema should define example item',
      );
      assertTrue(
        schemaContent?.includes('registerSchemas') || false,
        'Schema should export registration function',
      );
    },
  );
}
