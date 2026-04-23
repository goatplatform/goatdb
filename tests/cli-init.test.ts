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
import { stopBackgroundCompiler } from '../build.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { buildAssets } from '../cli/build-assets.ts';
import {
  mkdir,
  pathExists,
  readTextFile,
  writeTextFile,
} from '../base/json-log/file-impl.ts';

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
        await pathExists(path.join(testDir, 'client/index.html')),
        'client/index.html should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, 'client/index.css')),
        'client/index.css should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, 'client/index.tsx')),
        'client/index.tsx should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, 'client/app.tsx')),
        'client/app.tsx should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, 'common/schema.ts')),
        'common/schema.ts should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, 'server/debug-server.ts')),
        'server/debug-server.ts should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, 'server/server.ts')),
        'server/server.ts should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, 'server/build.ts')),
        'server/build.ts should exist',
      );
      assertTrue(
        await pathExists(path.join(testDir, '.gitignore')),
        '.gitignore should exist',
      );

      // Verify runtime-specific config files
      if (isDeno()) {
        assertTrue(
          await pathExists(path.join(testDir, 'deno.json')),
          'deno.json should exist for Deno runtime',
        );
      } else if (isNode()) {
        assertTrue(
          await pathExists(path.join(testDir, 'package.json')),
          'package.json should exist for Node runtime',
        );
        assertTrue(
          await pathExists(path.join(testDir, 'tsconfig.json')),
          'tsconfig.json should exist for Node runtime',
        );
        assertTrue(
          await pathExists(path.join(testDir, '.npmrc')),
          '.npmrc should exist for Node runtime',
        );
        assertTrue(
          await pathExists(path.join(testDir, 'server', 'server-sea.ts')),
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
      const customContent = '/* Custom CSS Content */\nbody { color: red; }';
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
        htmlContent?.includes('<!DOCTYPE html>') === true,
        'HTML should have doctype',
      );
      assertTrue(
        htmlContent?.includes('<div id="root">') === true,
        'HTML should have root div',
      );
      assertTrue(
        htmlContent?.includes('<link rel="stylesheet" href="/index.css"') ===
          true,
        'HTML should link /index.css stylesheet',
      );

      // Verify index.tsx imports CSS entry point
      const indexContent = await readTextFile(
        path.join(testDir, 'client/index.tsx'),
      );
      assertTrue(
        indexContent?.includes("import './index.css'") === true,
        'index.tsx should import CSS entry point',
      );

      // Verify React app template
      const appContent = await readTextFile(
        path.join(testDir, 'client/app.tsx'),
      );
      assertTrue(
        appContent?.includes('export function App') === true,
        'App component should be exported',
      );
      assertTrue(
        appContent?.includes('useDBReady') === true,
        'App should use GoatDB hook',
      );

      // Verify schema template
      const schemaContent = await readTextFile(
        path.join(testDir, 'common/schema.ts'),
      );
      assertTrue(
        schemaContent?.includes('kSchemaMyItem') === true,
        'Schema should define example item',
      );
      assertTrue(
        schemaContent?.includes('registerSchemas') === true,
        'Schema should export registration function',
      );
    },
  );

  TEST(
    'CLI-Init',
    'real scaffold entry builds through buildAssets',
    async (ctx: TestSuite) => {
      if (typeof document !== 'undefined') return;

      const testDir = await ctx.tempDir('init-real-scaffold-build');
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      const stubsDir = path.join(testDir, 'test-stubs');
      await mkdir(stubsDir);
      await writeTextFile(
        path.join(stubsDir, 'react.ts'),
        'export default {};\n',
      );
      await writeTextFile(
        path.join(stubsDir, 'react-dom-client.ts'),
        'export function createRoot() { return { render() {} }; }\n',
      );
      await writeTextFile(
        path.join(stubsDir, 'react-jsx-runtime.ts'),
        'export const Fragment = Symbol.for("fragment");\n' +
          'export function jsx(type: unknown, props: unknown) {\n' +
          '  return { type, props };\n' +
          '}\n' +
          'export const jsxs = jsx;\n',
      );
      await writeTextFile(
        path.join(stubsDir, 'goatdb.ts'),
        'export class DataRegistry {\n' +
          '  static default = new DataRegistry();\n' +
          '  registerSchema(_schema: unknown): void {}\n' +
          '}\n',
      );
      await writeTextFile(
        path.join(stubsDir, 'goatdb-react.ts'),
        "export function useDBReady(): 'ready' { return 'ready'; }\n",
      );
      const runtime = isDeno() ? 'deno' : 'node';

      const stubbedImportPaths = {
        react: path.join(stubsDir, 'react.ts'),
        'react-dom/client': path.join(stubsDir, 'react-dom-client.ts'),
        'react/jsx-runtime': path.join(stubsDir, 'react-jsx-runtime.ts'),
        '@goatdb/goatdb': path.join(stubsDir, 'goatdb.ts'),
        '@goatdb/goatdb/react': path.join(stubsDir, 'goatdb-react.ts'),
      };
      // deno-lint-ignore no-explicit-any
      const scaffoldDepsPlugin: any = {
        name: 'scaffold-deps-stub',
        setup(build: any) {
          build.onResolve({ filter: /.*/ }, (args: any) => {
            const stubPath = stubbedImportPaths[
              args.path as keyof typeof stubbedImportPaths
            ];
            return stubPath ? { path: stubPath, namespace: 'file' } : undefined;
          });
        },
      };

      try {
        const assets = await buildAssets(
          undefined,
          [{
            in: path.join(testDir, 'client/index.tsx'),
            out: APP_ENTRY_POINT,
          }],
          {
            buildDir: path.join(testDir, 'build'),
            jsPath: path.join(testDir, 'client/index.tsx'),
            htmlPath: path.join(testDir, 'client/index.html'),
          },
          {
            runtime,
            keepEsbuildAlive: false,
            esbuildPlugins: [scaffoldDepsPlugin],
          },
        );

        assertExists(
          assets['/index.html'],
          'scaffold build must emit /index.html',
        );
        assertExists(assets['/app.js'], 'scaffold build must emit /app.js');
        assertExists(
          assets['/index.css'],
          'scaffold build must emit /index.css',
        );

        const html = new TextDecoder().decode(assets['/index.html'].data);
        const js = new TextDecoder().decode(assets['/app.js'].data);
        const css = new TextDecoder().decode(assets['/index.css'].data);
        assertTrue(
          html.includes('<link rel="stylesheet" href="/index.css"'),
          'built scaffold HTML must reference /index.css',
        );
        assertTrue(
          js.length > 0,
          'built scaffold JS must be non-empty',
        );
        assertTrue(
          css.trim().length > 0,
          'built scaffold CSS must be non-empty',
        );
      } finally {
        await stopBackgroundCompiler();
      }
    },
  );
}
