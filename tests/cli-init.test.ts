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
import { getRuntime } from '../base/runtime/index.ts';
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
      const rid = getRuntime().id;
      const runtime = rid === 'deno'
        ? 'deno'
        : rid === 'node'
        ? 'node'
        : 'browser';
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
      if (getRuntime().id === 'deno') {
        assertTrue(
          await pathExists(path.join(testDir, 'deno.json')),
          'deno.json should exist for Deno runtime',
        );
      } else if (getRuntime().id === 'node') {
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

      if (indexContent && getRuntime().id === 'deno') {
        // Deno should use .tsx/.ts extensions
        assertTrue(
          indexContent.includes("from './app.tsx'"),
          'Deno should use .tsx extension',
        );
        assertTrue(
          indexContent.includes("from '../common/schema.ts'"),
          'Deno should use .ts extension',
        );
      } else if (indexContent && getRuntime().id === 'node') {
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
}

export function setupCliInitNodeTests(): void {
  TEST(
    'CLI-Init',
    'node scaffold keeps SEA templates self-contained and explicit about exits',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-node-sea-template');
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      const seaContent = await readTextFile(
        path.join(testDir, 'server/server-sea.ts'),
      );
      const buildContent = await readTextFile(
        path.join(testDir, 'server/build.ts'),
      );

      // Count signal-handler registrations — must be exactly 2 (SIGTERM, SIGINT).
      const sigHandlerCount =
        (seaContent?.match(/runtime\.setupSignalHandler\(/g) ?? []).length;
      assertEquals(
        sigHandlerCount,
        2,
        'SEA template must register both SIGTERM and SIGINT',
      );

      // Encoding must be a string literal, not a BufferEncoding union.
      assertTrue(
        /encoding:\s*['"][^'"]+['"]/.test(seaContent ?? ''),
        'SEA template must use a string-literal encoding, not BufferEncoding',
      );

      // Fatal exit sites must be `return runtime.exit(N)` so the type-checker
      // verifies the `never` return type — bare `runtime.exit(N)` is allowed
      // only on the success path of `main()`.
      const fatalExitCount =
        (seaContent?.match(/return runtime\.exit\([01]\)/g) ?? []).length;
      assertTrue(
        fatalExitCount >= 2,
        'SEA template must make fatal exits explicit for type-checking',
      );

      // setTimeout returns a Timeout with .unref() in Node, but the SEA bundle
      // may be transpiled to a context that lacks the typed unref. Optional
      // chaining keeps it valid either way.
      assertTrue(
        (seaContent ?? '').includes('forceExit.unref?.()'),
        'SEA template must tolerate runtimes without typed unref()',
      );

      // Build script must target the SEA server entry.
      assertTrue(
        /serverEntry:\s*['"]server\/server-sea\.ts['"]/.test(
          buildContent ?? '',
        ),
        'build template must target the SEA server entry',
      );

      // Build script must route fatal exits through the runtime adapter.
      assertTrue(
        /getRuntime\(\)\.exit\(1\)/.test(buildContent ?? ''),
        'build template must exit non-zero on build failure',
      );
    },
  );

  TEST(
    'CLI-Init',
    'node scaffold non-SEA server template uses runtime adapter shutdown wiring',
    async (ctx: TestSuite) => {
      const testDir = await ctx.tempDir('init-node-server-template');
      const initModule = await import('../cli/init.ts');
      await initModule.bootstrapProject({
        targetDir: testDir,
        skipDependencies: true,
      });

      const serverContent = await readTextFile(
        path.join(testDir, 'server/server.ts'),
      );

      assertEquals(
        (serverContent?.match(/runtime\.setupSignalHandler\(/g) ?? []).length,
        2,
        'non-SEA server template must register both SIGTERM and SIGINT through the runtime adapter',
      );
      assertTrue(
        (serverContent ?? '').includes(
          "console.log('\\nRuntime:', getRuntime().getSystemInfo())",
        ),
        'non-SEA server template must print runtime info via the runtime adapter',
      );
      assertTrue(
        (serverContent ?? '').includes('getRuntime().exit(0)'),
        'non-SEA server template must exit info mode through the runtime adapter',
      );
      assertTrue(
        (serverContent ?? '').includes(
          'const forceExit = setTimeout(() => runtime.exit(1), 5000);',
        ),
        'non-SEA server template must force-exit shutdown through the runtime adapter',
      );
      assertTrue(
        (serverContent ?? '').includes(
          'server.stop().then(() => runtime.exit(0)).catch((e) => {',
        ),
        'non-SEA server template must route graceful shutdown exit through the runtime adapter',
      );
      assertTrue(
        !(serverContent ?? '').includes('process.on('),
        'non-SEA server template must avoid direct process signal wiring',
      );
    },
  );
}

/**
 * Server-only test: builds the scaffolded project through buildAssets.
 * Gated by `if (getRuntime().id !== 'browser')` in test-registry.ts.
 */
export function setupCliInitBuildTests(): void {
  TEST(
    'CLI-Init',
    'real scaffold entry builds through buildAssets',
    async (ctx: TestSuite) => {
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
      const rid = getRuntime().id;
      const runtime = rid === 'deno' ? 'deno' : 'node';

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
