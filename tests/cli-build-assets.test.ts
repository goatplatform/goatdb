import { isBrowser, isDeno, isNode } from '../base/common.ts';
import { readTextFile, writeTextFile } from '../base/json-log/file-impl.ts';
import * as path from '../base/path.ts';
import { createBuildContext, stopBackgroundCompiler } from '../build.ts';
import { appEntryPoints, buildAssets } from '../cli/build-assets.ts';
import type { AppConfig } from '../cli/app-config.ts';
import { debugClientBundleSpec } from '../cli/debug-server.ts';
import type { StaticAssets } from '../system-assets/system-assets.ts';
import type { Plugin } from 'esbuild';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import { TEST, type TestFunc, type TestSuite } from './mod.ts';

const kSuite = 'CLI-BuildAssets';

type Fixture = { dir: string; config: AppConfig };

function serverTest(test: (ctx: TestSuite) => Promise<void>): TestFunc {
  return (ctx) => isBrowser() ? undefined : test(ctx);
}

function denoTest(test: (ctx: TestSuite) => Promise<void>): TestFunc {
  return (ctx) => isDeno() ? test(ctx) : undefined;
}

function nodeTest(test: (ctx: TestSuite) => Promise<void>): TestFunc {
  return (ctx) => isNode() ? test(ctx) : undefined;
}

async function fixture(
  ctx: TestSuite,
  name: string,
  entrySource = 'export default 1;',
): Promise<Fixture> {
  const dir = await ctx.tempDir(name);
  const jsPath = path.join(dir, 'entry.ts');
  await writeTextFile(jsPath, entrySource);
  return { dir, config: { buildDir: dir, jsPath } };
}

async function addFile(
  value: Fixture,
  name: string,
  contents: string,
): Promise<string> {
  const filePath = path.join(value.dir, name);
  await writeTextFile(filePath, contents);
  return filePath;
}

async function buildFixture(
  value: Fixture,
  runtime: 'deno' | 'node' = 'node',
): Promise<StaticAssets> {
  try {
    return await buildAssets(
      undefined,
      appEntryPoints(value.config),
      value.config,
      { runtime },
    );
  } finally {
    await stopBackgroundCompiler();
  }
}

function decodeAsset(assets: StaticAssets, key: string): string {
  const asset = assets[key];
  assertExists(asset, `Expected asset '${key}' to exist`);
  return new TextDecoder().decode(asset.data);
}

function asError(value: unknown): Error {
  assertTrue(value instanceof Error, 'Expected operation to fail with Error');
  return value as Error;
}

function bundleTarget(source: string): unknown {
  const key = '__testBundleTarget';
  Reflect.deleteProperty(globalThis, key);
  try {
    Function(source)();
    return Reflect.get(globalThis, key);
  } finally {
    Reflect.deleteProperty(globalThis, key);
  }
}

function cssLoader(
  cssPath: string,
  contents: () => Promise<string>,
  watchFiles?: string[],
): Plugin {
  const escapedPath = cssPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    name: 'test-css-loader',
    setup(build) {
      build.onLoad(
        { filter: new RegExp(escapedPath), namespace: 'file' },
        async () => ({
          contents: await contents(),
          loader: 'css',
          watchFiles,
        }),
      );
    },
  };
}

function staticCssLoader(cssPath: string, contents: string): Plugin {
  return cssLoader(cssPath, async () => contents);
}

async function requiredTextFile(filePath: string): Promise<string> {
  const contents = await readTextFile(filePath);
  if (contents === undefined) {
    throw new Error(`Missing plugin input: ${filePath}`);
  }
  return contents;
}

function watchedCssLoader(cssPath: string, inputPath: string): Plugin {
  return cssLoader(cssPath, () => requiredTextFile(inputPath), [inputPath]);
}

async function denoPluginDirectTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(
    ctx,
    'deno-plugin-direct',
    "import './style.css';",
  );
  const cssPath = await addFile(
    value,
    'style.css',
    '.original { color: red; }',
  );
  value.config.esbuildPlugins = [
    staticCssLoader(cssPath, '.plugin-direct { color: blue; }'),
  ];
  const css = decodeAsset(await buildFixture(value, 'deno'), '/index.css');
  assertTrue(
    css.includes('plugin-direct'),
    'Deno build should use custom CSS loader',
  );
  assertTrue(!css.includes('original'), 'Deno loader must remain a fallback');
}

async function pluginRebuildTest(
  ctx: TestSuite,
  runtime: 'deno' | 'node',
): Promise<void> {
  const source =
    "import './style.css'; globalThis.__testBundleTarget = __BUNDLE_TARGET__;";
  const value = await fixture(ctx, `${runtime}-plugin-rebuild`, source);
  const cssPath = await addFile(
    value,
    'style.css',
    '.original { color: red; }',
  );
  const pluginInput = await addFile(
    value,
    'plugin-input.css',
    '.plugin-first { color: blue; }',
  );
  value.config.esbuildPlugins = [watchedCssLoader(cssPath, pluginInput)];
  const buildCtx = await createBuildContext({
    entryPoints: appEntryPoints(value.config),
    runtime,
    userPlugins: value.config.esbuildPlugins,
  });
  try {
    const assets = await buildAssets(
      buildCtx,
      appEntryPoints(value.config),
      value.config,
    );
    assertTrue(decodeAsset(assets, '/index.css').includes('plugin-first'));
    await writeTextFile(pluginInput, '.plugin-second { color: green; }');
    const rebuiltAssets = await buildAssets(
      buildCtx,
      appEntryPoints(value.config),
      value.config,
    );
    const rebuiltCss = decodeAsset(rebuiltAssets, '/index.css');
    assertTrue(rebuiltCss.includes('plugin-second'));
    assertTrue(!rebuiltCss.includes('plugin-first'));
    const js = decodeAsset(rebuiltAssets, '/app.js');
    assertEquals(bundleTarget(js), 'browser');
  } finally {
    buildCtx.close();
    await stopBackgroundCompiler();
  }
}

async function invalidPluginTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(ctx, 'invalid-plugin');
  value.config.esbuildPlugins = [{} as Plugin];
  let error: unknown;
  try {
    await buildFixture(value);
  } catch (caught) {
    error = caught;
  }
  assertTrue(asError(error).message.includes('Invalid esbuild plugin'));
}

async function jsImportedCssTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(ctx, 'css-from-js', "import './style.css';");
  await addFile(value, 'style.css', '.from-js { color: red; }');
  const assets = await buildFixture(value);
  assertEquals(assets['/index.css']?.contentType, 'text/css');
  assertTrue(decodeAsset(assets, '/index.css').includes('from-js'));
}

async function cssOrderingAndMapsTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(ctx, 'css-order', "import './component.css';");
  value.config.cssPath = await addFile(
    value,
    'base.css',
    '.base { color: blue; }',
  );
  await addFile(value, 'component.css', '.component { color: red; }');
  const assets = await buildFixture(value);
  const css = decodeAsset(assets, '/index.css');
  const baseIdx = css.indexOf('.base');
  const componentIdx = css.indexOf('.component');
  assertTrue(baseIdx >= 0, '.base must be present in CSS');
  assertTrue(componentIdx >= 0, '.component must be present in CSS');
  assertTrue(baseIdx < componentIdx, '.base must precede .component');
  assertTrue(!css.includes('sourceMappingURL='));
  assertEquals(assets['/index.css.map'], undefined);
}

async function cssUrlAssetTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(ctx, 'css-url', "import './style.css';");
  await addFile(value, 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await addFile(value, 'style.css', '.logo { background: url(./logo.svg); }');
  const assets = await buildFixture(value);
  const svgKey = Object.keys(assets).find((key) =>
    key.startsWith('/assets/logo-') && key.endsWith('.svg')
  );
  assertExists(svgKey, 'Expected a content-hashed SVG asset');
  assertEquals(assets[svgKey].contentType, 'image/svg+xml');
  assertTrue(decodeAsset(assets, '/index.css').includes('assets/logo-'));
}

async function cssMapRewriteTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(ctx, 'css-map', "import './style.css';");
  await addFile(value, 'style.css', '.mapped { color: red; }');
  const assets = await buildFixture(value);
  const css = decodeAsset(assets, '/index.css');
  assertTrue(css.includes('/*# sourceMappingURL=index.css.map */'));
  assertTrue(!css.includes('web-app.css.map'));
  const mapAsset = assets['/index.css.map'];
  assertExists(mapAsset, 'Expected /index.css.map to exist');
  assertEquals(mapAsset.contentType, 'application/json');
  const mapJson = JSON.parse(new TextDecoder().decode(mapAsset.data));
  assertTrue(
    mapJson.sources?.some((s: string) => s.includes('style.css')),
    'Sourcemap must reference style.css',
  );
}

async function noCssTest(ctx: TestSuite): Promise<void> {
  const assets = await buildFixture(await fixture(ctx, 'no-css'));
  assertEquals(assets['/index.css'], undefined);
}

async function missingHtmlTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(ctx, 'missing-html');
  value.config.htmlPath = path.join(value.dir, 'missing.html');
  let error: unknown;
  try {
    await buildFixture(value);
  } catch (caught) {
    error = caught;
  }
  assertEquals(
    asError(error).message,
    `Error loading ${value.config.htmlPath}`,
  );
}

async function denoRealFilesTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(ctx, 'deno-real-files', "import './style.css';");
  await addFile(
    value,
    'style.css',
    '.real { background: url(./logo.svg); }',
  );
  await addFile(value, 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const assets = await buildFixture(value, 'deno');
  const css = decodeAsset(assets, '/index.css');
  assertTrue(
    css.includes('.real'),
    'Real CSS file must be bundled via browserAssetPlugin',
  );
  assertTrue(
    css.includes('assets/logo-'),
    'url() must be rewritten to a hashed asset',
  );
  const svgKey = Object.keys(assets).find((key) =>
    key.startsWith('/assets/logo-') && key.endsWith('.svg')
  );
  assertExists(svgKey, 'Expected a content-hashed SVG asset');
  assertEquals(assets[svgKey].contentType, 'image/svg+xml');
}

async function debugBuildAssets(
  config: AppConfig,
): Promise<StaticAssets> {
  const spec = debugClientBundleSpec(config, 'node');
  const buildCtx = await createBuildContext(spec);
  try {
    return await buildAssets(buildCtx, spec.entryPoints, config);
  } finally {
    buildCtx.close();
    await stopBackgroundCompiler();
  }
}

async function debugServerBuildSpecTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(
    ctx,
    'debug-build-spec',
    "import { webcrypto } from 'node:crypto';\nconst message = 'debug plugin';\nglobalThis.__debugMessage = webcrypto ? message : '';",
  );
  let completedBuilds = 0;
  value.config.esbuildPlugins = [{
    name: 'debug-build-plugin',
    setup(build) {
      build.onEnd(() => {
        completedBuilds++;
      });
    },
  }];
  const readable = await debugBuildAssets({ ...value.config, minify: false });
  const minified = await debugBuildAssets({ ...value.config, minify: true });
  assertEquals(completedBuilds, 2, 'Plugin must run for each debug build');
  assertTrue(
    decodeAsset(minified, '/app.js').length <
      decodeAsset(readable, '/app.js').length,
    'Debug build spec must pass minify to esbuild',
  );
}

async function debugCssParityTest(ctx: TestSuite): Promise<void> {
  // Dev (startDebugServer rebuild path) and prod (compile path) share
  // clientBuildOptions; pin that observable plugin-produced CSS is identical
  // across both and that the debug context rebuilds plugin inputs.
  const value = await fixture(ctx, 'debug-css-parity', "import './style.css';");
  await addFile(value, 'style.css', '.from-js { color: red; }');
  value.config.cssPath = await addFile(
    value,
    'base.css',
    '.base { color: blue; }',
  );
  const cssPath = path.join(value.dir, 'style.css');
  const pluginInput = await addFile(
    value,
    'plugin-input.css',
    '.plugin-first { color: green; }',
  );
  value.config.esbuildPlugins = [watchedCssLoader(cssPath, pluginInput)];
  const directCss = decodeAsset(
    await buildFixture(value, 'node'),
    '/index.css',
  );
  assertTrue(
    directCss.includes('plugin-first'),
    'Direct build must emit plugin-produced CSS',
  );
  const spec = debugClientBundleSpec(value.config, 'node');
  const buildCtx = await createBuildContext(spec);
  try {
    const debugCss = decodeAsset(
      await buildAssets(buildCtx, spec.entryPoints, value.config),
      '/index.css',
    );
    assertTrue(
      debugCss.includes('plugin-first'),
      'Debug build must emit plugin-produced CSS',
    );
    assertEquals(debugCss, directCss, 'Debug and production CSS must match');
    await writeTextFile(pluginInput, '.plugin-second { color: purple; }');
    const rebuiltCss = decodeAsset(
      await buildAssets(buildCtx, spec.entryPoints, value.config),
      '/index.css',
    );
    assertTrue(
      rebuiltCss.includes('plugin-second'),
      'Debug rebuild must apply updated plugin input',
    );
    assertTrue(
      !rebuiltCss.includes('plugin-first'),
      'Debug rebuild must drop stale plugin CSS',
    );
  } finally {
    buildCtx.close();
    await stopBackgroundCompiler();
  }
}

async function buildFailureTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(
    ctx,
    'build-failure',
    "import './missing-module.ts';",
  );
  let error: unknown;
  try {
    await buildFixture(value);
  } catch (caught) {
    error = caught;
  }
  assertTrue(
    asError(error).message.includes('Build failed'),
    'esbuild build errors must propagate through buildAssets',
  );
}

export default function setupCliBuildAssetsTests() {
  TEST(
    kSuite,
    'Deno build lets a custom plugin load CSS',
    denoTest(denoPluginDirectTest),
  );
  TEST(
    kSuite,
    'Deno rebuild applies plugins and browser define',
    denoTest((ctx) => pluginRebuildTest(ctx, 'deno')),
  );
  TEST(
    kSuite,
    'Node rebuild applies plugins and browser define',
    serverTest((ctx) => pluginRebuildTest(ctx, 'node')),
  );
  TEST(kSuite, 'invalid plugin is rejected', serverTest(invalidPluginTest));
  TEST(
    kSuite,
    'CSS imported from JS produces index.css',
    serverTest(jsImportedCssTest),
  );
  TEST(
    kSuite,
    'CSS order is deterministic and multi-chunk maps are omitted',
    serverTest(cssOrderingAndMapsTest),
  );
  TEST(
    kSuite,
    'relative CSS URL emits a hashed asset',
    serverTest(cssUrlAssetTest),
  );
  TEST(
    kSuite,
    'JS-imported CSS sourcemap URL is rewritten',
    serverTest(cssMapRewriteTest),
  );
  TEST(kSuite, 'entry without CSS omits index.css', serverTest(noCssTest));
  TEST(kSuite, 'missing htmlPath fails visibly', serverTest(missingHtmlTest));
  TEST(
    kSuite,
    'Deno build loads real CSS and asset files',
    denoTest(denoRealFilesTest),
  );
  TEST(
    kSuite,
    'debug build spec wires Node runtime, plugins, and minify',
    nodeTest(debugServerBuildSpecTest),
  );
  TEST(
    kSuite,
    'build failure propagates through buildAssets',
    serverTest(buildFailureTest),
  );
  TEST(
    kSuite,
    'debug rebuild emits plugin CSS identical to production and rebuilds it',
    nodeTest(debugCssParityTest),
  );
}
