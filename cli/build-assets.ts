import { APP_ENTRY_POINT } from '../base/app-entry-point.ts';
import * as path from '../base/path.ts';
import {
  type BundleResult,
  clientBuildOptions,
  type ClientBuildOutput,
  clientBuildOutputFromResult,
  type EntryPoint,
  getEsbuild,
  isReBuildContext,
  type ReBuildContext,
  stopBackgroundCompiler,
} from '../build.ts';
import type { AppConfig } from './app-config.ts';
import type {
  Asset,
  ContentType,
  StaticAssets,
} from '../system-assets/system-assets.ts';
import { pathExists, readFile, walkDir } from '../base/json-log/file-impl.ts';

/**
 * Options for buildAssets function.
 */
export interface BuildAssetsOptions {
  /**
   * Target runtime. If 'node', skips Deno-specific plugins.
   * Default: 'deno'
   */
  runtime?: 'deno' | 'node';
  /**
   * When true, keeps the esbuild background process alive after building.
   * Caller is responsible for calling stopBackgroundCompiler().
   */
  keepEsbuildAlive?: boolean;
}

/**
 * Client bundle entry points: the JS app plus the optional cssPath, which is
 * bundled through esbuild (minified, sourcemapped, processed by user plugins).
 */
export function appEntryPoints(appConfig: AppConfig): EntryPoint[] {
  const entryPoints = [{
    in: path.resolve(appConfig.jsPath),
    out: APP_ENTRY_POINT,
  }];
  if (appConfig.cssPath) {
    entryPoints.push({ in: path.resolve(appConfig.cssPath), out: 'index' });
  }
  return entryPoints;
}

export async function buildAssets(
  ctx: ReBuildContext | undefined,
  entryPoints: EntryPoint[],
  appConfig: AppConfig,
  options?: BuildAssetsOptions,
): Promise<StaticAssets> {
  const output = ctx && isReBuildContext(ctx)
    ? await ctx.rebuild()
    : await buildDirectly(entryPoints, appConfig, options);
  return staticAssetsFromOutput(output, entryPoints, appConfig);
}

async function buildDirectly(
  entryPoints: EntryPoint[],
  appConfig: AppConfig,
  options?: BuildAssetsOptions,
): Promise<ClientBuildOutput> {
  const esbuild = await getEsbuild();
  const buildOptions = await clientBuildOptions({
    entryPoints,
    runtime: options?.runtime ?? 'deno',
    minify: appConfig.minify,
    userPlugins: appConfig.esbuildPlugins,
  });
  try {
    return clientBuildOutputFromResult(await esbuild.build(buildOptions));
  } finally {
    if (!options?.keepEsbuildAlive) {
      await stopBackgroundCompiler();
    }
  }
}

async function staticAssetsFromOutput(
  output: ClientBuildOutput,
  entryPoints: EntryPoint[],
  appConfig: AppConfig,
): Promise<StaticAssets> {
  const result: StaticAssets = {};
  // User provided assets are always processed, regardless of app build success
  if (appConfig.assetsPath) {
    Object.assign(
      result,
      await compileAssetsDirectory(
        path.resolve(appConfig.assetsPath),
        appConfig.assetsFilter,
        '/assets',
      ),
    );
  }
  Object.assign(result, jsStaticAssets(output.bundles));
  Object.assign(result, cssStaticAssets(output.bundles, entryPoints));
  Object.assign(result, loaderStaticAssets(output.assets));
  if (appConfig.htmlPath) {
    Object.assign(result, await htmlStaticAsset(appConfig.htmlPath));
  }
  return result;
}

function jsStaticAssets(bundles: Record<string, BundleResult>): StaticAssets {
  const result: StaticAssets = {};
  const encoder = new TextEncoder();
  for (const [name, bundle] of Object.entries(bundles)) {
    if (!bundle.js) {
      continue;
    }
    const base = name === APP_ENTRY_POINT ? '/app' : `/${name}`;
    result[`${base}.js`] = {
      data: encoder.encode(bundle.js),
      contentType: 'text/javascript',
    };
    if (bundle.jsMap) {
      result[`${base}.js.map`] = {
        data: encoder.encode(bundle.jsMap),
        contentType: 'application/json',
      };
    }
  }
  return result;
}

const kCssSourcemapUrlPattern = /\/\*# sourceMappingURL=[^*]*\*\/\s*/g;

function stripSourcemapUrl(css: string): string {
  return css.replace(kCssSourcemapUrlPattern, '');
}

/**
 * Concatenates all CSS chunks into a single /index.css. Order: the cssPath
 * entry ('index') first — preserving its historical base-stylesheet role —
 * then the app entry (CSS imported from JS), then any remaining entries.
 * A single chunk keeps its sourcemap; multi-chunk output has no combined map
 * (composing maps requires a VLQ composer, which esbuild does not provide).
 */
function cssStaticAssets(
  bundles: Record<string, BundleResult>,
  entryPoints: EntryPoint[],
): StaticAssets {
  const orderedNames = [
    ...new Set(['index', APP_ENTRY_POINT, ...entryPoints.map((e) => e.out)]),
  ];
  const chunks = orderedNames
    .map((name) => bundles[name])
    .filter((bundle) => bundle?.css) as BundleResult[];
  if (chunks.length === 0) {
    return {};
  }
  const encoder = new TextEncoder();
  if (chunks.length === 1) {
    return singleCssStaticAsset(chunks[0] as BundleResult, encoder);
  }
  const combined = chunks.map((bundle) => stripSourcemapUrl(bundle.css!)).join(
    '\n',
  );
  return {
    '/index.css': { data: encoder.encode(combined), contentType: 'text/css' },
  };
}

function singleCssStaticAsset(
  bundle: BundleResult,
  encoder: TextEncoder,
): StaticAssets {
  let css = bundle.css!;
  const result: StaticAssets = {};
  if (bundle.cssMap) {
    css = css.replace(
      kCssSourcemapUrlPattern,
      '/*# sourceMappingURL=index.css.map */\n',
    );
    result['/index.css.map'] = {
      data: encoder.encode(bundle.cssMap),
      contentType: 'application/json',
    };
  }
  result['/index.css'] = { data: encoder.encode(css), contentType: 'text/css' };
  return result;
}

// Files emitted by esbuild's 'file' loader for relative url() in CSS. Served
// under /assets/ to match the relative URLs esbuild rewrote into the CSS.
function loaderStaticAssets(assets: Record<string, Uint8Array>): StaticAssets {
  const result: StaticAssets = {};
  for (const [name, data] of Object.entries(assets)) {
    const ext = path.extname(name).substring(1).toLowerCase();
    result[`/assets/${name}`] = {
      data,
      contentType: ContentTypeMapping[ext] || 'application/octet-stream',
    };
  }
  return result;
}

async function htmlStaticAsset(htmlPath: string): Promise<StaticAssets> {
  try {
    return {
      '/index.html': {
        data: await readFile(htmlPath),
        contentType: 'text/html',
      },
    };
  } catch (_: unknown) {
    throw new Error(`Error loading ${htmlPath}`);
  }
}

const ContentTypeMapping: Record<string, ContentType> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  json: 'application/json',
  js: 'text/javascript',
  ts: 'text/javascript',
  html: 'text/html',
  css: 'text/css',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
};

export async function compileAssetsDirectory(
  dir: string,
  filter?: (path: string) => boolean,
  prefix?: string,
): Promise<Record<string, Asset>> {
  const result: Record<string, Asset> = {};
  if (!(await pathExists(dir))) {
    return result;
  }
  for await (const filePath of walkDir(dir, { includeDirs: false })) {
    if (filter && !filter(filePath)) {
      continue;
    }
    const origExt = path.extname(filePath);
    let ext = origExt.substring(1);
    if (ext === 'ts') {
      ext = 'js';
    }
    let key = filePath.substring(dir.length).toLowerCase();
    // Rewrite extension to match
    key = key.substring(0, key.length - origExt.length) + '.' + ext;
    if (prefix) {
      key = `${prefix}${key}`;
    }
    result[key] = {
      data: await readFile(filePath),
      contentType: ContentTypeMapping[ext] || 'application/octet-stream',
    };
  }
  return result;
}
