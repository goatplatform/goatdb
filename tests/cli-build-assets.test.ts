import { APP_ENTRY_POINT } from '../base/app-entry-point.ts';
import { isBrowser, isDeno, isNode } from '../base/common.ts';
import { readTextFile, writeTextFile } from '../base/json-log/file-impl.ts';
import * as path from '../base/path.ts';
import {
  createBuildContext,
  type EntryPoint,
  normalizeBuildEntryPath,
  stopBackgroundCompiler,
} from '../build.ts';
import { appEntryPoints, buildAssets } from '../cli/build-assets.ts';
import { composeCssSourcemap } from '../cli/css-sourcemap.ts';
import type { AppConfig } from '../cli/app-config.ts';
import {
  debugClientBundleSpec,
  debugConfigPaths,
} from '../cli/debug-server.ts';
import type { StaticAssets } from '../system-assets/system-assets.ts';
import type { Plugin } from 'esbuild';
import { AnyMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import { TEST, type TestFunc, type TestSuite } from './mod.ts';

const kSuite = 'CLI-BuildAssets';

type Fixture = { dir: string; config: AppConfig };

function serverTest(test: (ctx: TestSuite) => Promise<void> | void): TestFunc {
  return (ctx) => isBrowser() ? undefined : test(ctx);
}

function denoTest(test: (ctx: TestSuite) => Promise<void> | void): TestFunc {
  return (ctx) => isDeno() ? test(ctx) : undefined;
}

function nodeTest(test: (ctx: TestSuite) => Promise<void> | void): TestFunc {
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
      { runtime, denoConfigPath: value.config.denoJson },
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

// ---- CSS sourcemap contract helpers -------------------------------------------

// 1-based line / 0-based column of charIndex, per source-map query convention
// (lines are 1-based, columns 0-based, both in UTF-16 code units — JS string
// indices already count UTF-16 units).
function lineColumnOf(text: string, charIndex: number): {
  line: number;
  column: number;
} {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < charIndex; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: charIndex - lastNewline - 1 };
}

/**
 * Contract probe: the marker must appear in /index.css and its generated
 * position must resolve, through the served map, to the authored source with
 * the given basename, whose embedded sourcesContent contains the marker.
 * Positions are computed dynamically from the built output and resolution goes
 * through an independent consumer that accepts both flat and indexed maps, so
 * the probe survives bundler swaps and map-format changes.
 */
function assertCssProbe(
  assets: StaticAssets,
  marker: string,
  sourceBasename: string,
): void {
  const css = decodeAsset(assets, '/index.css');
  const mapAsset = assets['/index.css.map'];
  assertExists(mapAsset, `Expected /index.css.map to exist (probe ${marker})`);
  const tracer = new AnyMap(
    JSON.parse(new TextDecoder().decode(mapAsset.data)),
  );
  const idx = css.indexOf(marker);
  assertTrue(idx >= 0, `Marker '${marker}' must appear in /index.css`);
  const original = originalPositionFor(tracer, lineColumnOf(css, idx));
  assertTrue(
    original.source !== null,
    `Position of '${marker}' must map to an original source`,
  );
  assertEquals(path.basename(original.source!), sourceBasename);
  const sourceIdx = tracer.sources.indexOf(original.source!);
  const content = tracer.sourcesContent?.[sourceIdx];
  assertTrue(
    (content?.includes(marker)) === true,
    `sourcesContent of ${sourceBasename} must contain '${marker}'`,
  );
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
  // esbuild matches onLoad filters against the fully-resolved path, which uses
  // native separators (backslashes on Windows). Match both separator forms so
  // the plugin fires on every platform.
  // e.g. "/a/b.css" → "[/\\]a[/\\]b\\.css" (matches both / and \ separators)
  const escapedPath = cssPath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '[/\\\\]');
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

async function cssSourcemapMultiChunkTest(ctx: TestSuite): Promise<void> {
  // Base stylesheet (cssPath) plus JS-imported CSS: two chunks merged into a
  // single /index.css whose composed sourcemap must resolve rules from both.
  // The unicode line after .probe-base pins line counting across a line whose
  // UTF-16 length differs from its byte length.
  const value = await fixture(ctx, 'css-order', "import './component.css';");
  value.config.cssPath = await addFile(
    value,
    'base.css',
    '.probe-base { color: blue; }\n.probe-unicode::after { content: "héllo wörld"; }\n.probe-base-2 { color: navy; }',
  );
  await addFile(value, 'component.css', '.probe-component { color: red; }');
  const assets = await buildFixture(value);
  const css = decodeAsset(assets, '/index.css');
  const baseIdx = css.indexOf('.probe-base');
  const componentIdx = css.indexOf('.probe-component');
  assertTrue(baseIdx >= 0, '.probe-base must be present in CSS');
  assertTrue(componentIdx >= 0, '.probe-component must be present in CSS');
  assertTrue(
    baseIdx < componentIdx,
    '.probe-base must precede .probe-component',
  );
  // Contract: exactly one trailing sourceMappingURL comment.
  assertEquals(
    css.split('sourceMappingURL=').length - 1,
    1,
    'Exactly one sourceMappingURL comment must remain in /index.css',
  );
  assertTrue(
    css.trimEnd().endsWith('/*# sourceMappingURL=index.css.map */'),
    'The map comment must reference index.css.map at the end',
  );
  // Contract: a served, correctly-typed map resolving every chunk's rules.
  const mapAsset = assets['/index.css.map'];
  assertExists(mapAsset, 'Expected /index.css.map to exist');
  assertEquals(mapAsset.contentType, 'application/json');
  assertCssProbe(assets, '.probe-base', 'base.css');
  assertCssProbe(assets, '.probe-base-2', 'base.css');
  assertCssProbe(assets, '.probe-component', 'component.css');
  // Contract: self-contained maps — every source embeds its original content.
  const tracer = new AnyMap(
    JSON.parse(new TextDecoder().decode(mapAsset.data)),
  );
  const sourcesContent = tracer.sourcesContent ?? [];
  for (let i = 0; i < tracer.sources.length; i++) {
    assertTrue(
      sourcesContent[i] != null,
      `sourcesContent must be embedded for ${tracer.sources[i]}`,
    );
  }
  // Implementation-format pin (documented choice, not a hard contract): the
  // composed map is an indexed map with one section per chunk, all columns 0
  // (chunks are line-aligned), starting at (0,0). Exact offset values are
  // verified by the composer unit test against known inputs; here the probe
  // assertions above already prove offsets are correct end-to-end (a shifted
  // offset lands the marker on an unmapped line and resolution returns null).
  const mapJson = JSON.parse(new TextDecoder().decode(mapAsset.data));
  assertEquals(mapJson.version, 3);
  assertEquals(mapJson.file, 'index.css');
  assertEquals(mapJson.sections.length, 2);
  assertEquals(mapJson.sections[0].offset, { line: 0, column: 0 });
  assertTrue(
    mapJson.sections[1].offset.line > mapJson.sections[0].offset.line,
    'Section offsets must be strictly increasing',
  );
  for (const section of mapJson.sections) {
    assertEquals(section.offset.column, 0);
  }
}

async function cssSourcemapThreeChunkTest(ctx: TestSuite): Promise<void> {
  // Three CSS chunks (base, JS-imported, extra entry) must all resolve through
  // one composed map, in cascade order.
  const value = await fixture(ctx, 'css-three', "import './app.css';");
  const basePath = await addFile(
    value,
    'base.css',
    '.probe-base { color: blue; }',
  );
  await addFile(value, 'app.css', '.probe-app { color: red; }');
  const extraPath = await addFile(
    value,
    'extra.css',
    '.probe-extra { color: green; }',
  );
  const entryPoints: EntryPoint[] = [
    { in: basePath, out: 'index' },
    { in: path.join(value.dir, 'entry.ts'), out: APP_ENTRY_POINT },
    { in: extraPath, out: 'extra' },
  ];
  const assets = await buildAssets(undefined, entryPoints, value.config, {
    runtime: 'node',
  });
  const css = decodeAsset(assets, '/index.css');
  const order = ['.probe-base', '.probe-app', '.probe-extra'].map((m) =>
    css.indexOf(m)
  );
  assertTrue(
    order.every((idx) => idx >= 0),
    'All three markers must be present in CSS',
  );
  assertTrue(
    order[0] < order[1] && order[1] < order[2],
    'Cascade order must be base, app, extra',
  );
  assertCssProbe(assets, '.probe-base', 'base.css');
  assertCssProbe(assets, '.probe-app', 'app.css');
  assertCssProbe(assets, '.probe-extra', 'extra.css');
}

async function cssSourcemapMinifiedTest(ctx: TestSuite): Promise<void> {
  // Production builds minify CSS by default; the composed map must still
  // resolve rules in the minified concatenation.
  const value = await fixture(ctx, 'css-minified', "import './component.css';");
  value.config.cssPath = await addFile(
    value,
    'base.css',
    '.probe-base { color: blue; }',
  );
  await addFile(value, 'component.css', '.probe-component { color: red; }');
  value.config.minify = true;
  const assets = await buildFixture(value);
  assertCssProbe(assets, '.probe-base', 'base.css');
  assertCssProbe(assets, '.probe-component', 'component.css');
}

function cssSourcemapComposerUnitTest(_ctx: TestSuite): void {
  // Pure-function coverage of the composition math: section offsets must equal
  // each part's start line in the '\n'-joined output, including trailing-
  // newline and unmapped-chunk edge cases.
  const fakeMap = (src: string): string =>
    JSON.stringify({ version: 3, sources: [src], names: [], mappings: '' });
  const parts = ['a\nb', 'c', 'd\n']; // joined: 'a\nb\nc\nd\n'
  const map = JSON.parse(
    composeCssSourcemap(parts, [
      fakeMap('a.css'),
      fakeMap('c.css'),
      fakeMap('d.css'),
    ])!,
  );
  assertEquals(map.version, 3);
  assertEquals(map.file, 'index.css');
  assertEquals(map.sections.length, 3);
  assertEquals(map.sections[0].offset, { line: 0, column: 0 });
  assertEquals(map.sections[1].offset, { line: 2, column: 0 });
  assertEquals(map.sections[2].offset, { line: 3, column: 0 });
  // Chunks without a map are skipped; the rest keep their true offsets.
  const partial = JSON.parse(
    composeCssSourcemap(parts, [
      fakeMap('a.css'),
      undefined,
      fakeMap('d.css'),
    ])!,
  );
  assertEquals(partial.sections.length, 2);
  assertEquals(partial.sections[1].offset, { line: 3, column: 0 });
  // No maps at all → no composed map.
  assertEquals(
    composeCssSourcemap(parts, [undefined, undefined, undefined]),
    undefined,
  );
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
  // Probe: the single-chunk flat map must resolve like the multi-chunk one.
  assertCssProbe(assets, '.mapped', 'style.css');
}

async function noCssTest(ctx: TestSuite): Promise<void> {
  const assets = await buildFixture(await fixture(ctx, 'no-css'));
  assertEquals(assets['/index.css'], undefined);
  assertEquals(assets['/index.css.map'], undefined);
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

function buildEntryPathNormalizationTest(_ctx: TestSuite): void {
  assertEquals(
    normalizeBuildEntryPath('C:\\Users\\goatdb\\entry.ts'),
    'file:///C:/Users/goatdb/entry.ts',
  );
  assertEquals(
    normalizeBuildEntryPath('\\\\fileserver\\share\\entry.ts'),
    'file://fileserver/share/entry.ts',
  );
  assertEquals(normalizeBuildEntryPath('/tmp/entry.ts'), '/tmp/entry.ts');
  assertEquals(normalizeBuildEntryPath('entry.ts'), 'entry.ts');
}

async function denoConfigBuildTest(ctx: TestSuite): Promise<void> {
  const value = await fixture(ctx, 'deno-config');
  value.config.jsPath = await addFile(
    value,
    'entry.tsx',
    [
      "import { message } from '@fixture/value';",
      'globalThis.__fixtureValue = <section>{message}</section>;',
    ].join('\n'),
  );
  const importsDir = path.join(value.dir, 'imports');
  await Deno.mkdir(importsDir, { recursive: true });
  await writeTextFile(
    path.join(importsDir, 'value.ts'),
    "export const message = 'import-map-value';",
  );
  await writeTextFile(
    path.join(importsDir, 'jsx-runtime.ts'),
    "export function jsx() { return 'configured-jsx-runtime'; }",
  );
  const denoJsonPath = await addFile(
    value,
    'deno.json',
    JSON.stringify({
      imports: {
        '@fixture/value': './imports/value.ts',
        'fixture-jsx/jsx-runtime': './imports/jsx-runtime.ts',
      },
      compilerOptions: {
        jsx: 'react-jsx',
        jsxImportSource: 'fixture-jsx',
      },
    }),
  );
  value.config.denoJson = denoJsonPath;
  const directAssets = await buildFixture(value, 'deno');
  const directJs = decodeAsset(directAssets, '/app.js');
  assertTrue(directJs.includes('import-map-value'));
  assertTrue(directJs.includes('configured-jsx-runtime'));

  const spec = debugClientBundleSpec(value.config, 'deno', denoJsonPath);
  const buildCtx = await createBuildContext(spec);
  try {
    const debugJs = decodeAsset(
      await buildAssets(buildCtx, spec.entryPoints, value.config),
      '/app.js',
    );
    assertTrue(debugJs.includes('import-map-value'));
    assertTrue(debugJs.includes('configured-jsx-runtime'));
  } finally {
    buildCtx.close();
    await stopBackgroundCompiler();
  }
}

async function packageOnlyDebugConfigTest(ctx: TestSuite): Promise<void> {
  const dir = await ctx.tempDir('package-only-debug-config');
  const packageJson = path.join(dir, 'package.json');
  await writeTextFile(packageJson, '{"name":"package-only"}');
  const paths = await debugConfigPaths({ packageJson }, dir);
  assertEquals(paths.buildInfoConfigPath, packageJson);
  assertEquals(paths.denoConfigPath, undefined);
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
    'CSS order is deterministic and multi-chunk CSS emits a correct combined sourcemap',
    serverTest(cssSourcemapMultiChunkTest),
  );
  TEST(
    kSuite,
    'three CSS chunks resolve through one composed sourcemap',
    serverTest(cssSourcemapThreeChunkTest),
  );
  TEST(
    kSuite,
    'composed sourcemap stays correct for minified CSS',
    serverTest(cssSourcemapMinifiedTest),
  );
  TEST(
    kSuite,
    'CSS sourcemap composer math (offsets, unmapped chunks)',
    serverTest(cssSourcemapComposerUnitTest),
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
    'normalizes Windows and UNC build entry paths',
    serverTest(buildEntryPathNormalizationTest),
  );
  TEST(
    kSuite,
    'Deno build uses a foreign-CWD config import map and JSX compiler options',
    denoTest(denoConfigBuildTest),
  );
  TEST(
    kSuite,
    'package-only debug config is not passed to the Deno plugin',
    serverTest(packageOnlyDebugConfigTest),
  );
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
