import * as path from '../base/path.ts';
import {
  bundleResultFromBuildResult,
  isReBuildContext,
  type ReBuildContext,
} from '../build.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import type { AppConfig } from './app-config.ts';
import type {
  Asset,
  ContentType,
  StaticAssets,
} from '../system-assets/system-assets.ts';
import { pathExists, readFile, walkDir } from '../base/json-log/file-impl.ts';

// Lazy-loaded modules to avoid bundling build-time dependencies into runtime code.
// These packages (esbuild, @luca/esbuild-deno-loader) are Deno/JSR-specific and
// cannot be resolved by Node.js at runtime.
let esbuildModule: typeof import('esbuild') | undefined;
let denoPluginsModule: typeof import('@luca/esbuild-deno-loader') | undefined;

async function getEsbuild() {
  if (!esbuildModule) {
    esbuildModule = await import('esbuild');
  }
  return esbuildModule;
}

async function getDenoPlugins() {
  if (!denoPluginsModule) {
    denoPluginsModule = await import('@luca/esbuild-deno-loader');
  }
  return denoPluginsModule.denoPlugins;
}

export type EntryPoint = { in: string; out: string };

export async function buildAssets(
  ctx: ReBuildContext | undefined,
  entryPoints: EntryPoint[],
  appConfig: AppConfig,
): Promise<StaticAssets> {
  let buildResults: Record<string, { source: string; map: string }>;
  let shouldStopEsbuild = false;

  if (ctx && isReBuildContext(ctx)) {
    buildResults = await ctx.rebuild();
  } else {
    // No context provided, use esbuild directly
    const esbuild = await getEsbuild();
    const denoPlugins = await getDenoPlugins();
    buildResults = bundleResultFromBuildResult(
      await esbuild.build({
        entryPoints,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugins: [...denoPlugins()] as any,
        bundle: true,
        write: false,
        sourcemap: 'linked',
        outdir: 'output',
        logOverride: {
          'empty-import-meta': 'silent',
        },
        minify: appConfig.minify,
        jsx: 'automatic',
      }),
    );
    shouldStopEsbuild = true;
  }

  if (shouldStopEsbuild) {
    const esbuild = await getEsbuild();
    await esbuild.stop();
  }

  // System assets are always included and are placed at the root
  const result: StaticAssets = {};
  const textEncoder = new TextEncoder();

  // User provided assets are always processed, regardless of app build success
  if (appConfig.assetsPath) {
    // User provided assets are placed under /assets/
    Object.assign(
      result,
      await compileAssetsDirectory(
        path.resolve(appConfig.assetsPath),
        appConfig.assetsFilter,
        '/assets',
      ),
    );
  }

  // For app code, include html and css files
  if (Object.hasOwn(buildResults, APP_ENTRY_POINT)) {
    const { source, map } = buildResults[APP_ENTRY_POINT];
    result['/app.js'] = {
      data: textEncoder.encode(source),
      contentType: 'text/javascript',
    };
    result['/app.js.map'] = {
      data: textEncoder.encode(map),
      contentType: 'application/json',
    };
    if (appConfig.htmlPath) {
      try {
        result['/index.html'] = {
          data: await readFile(appConfig.htmlPath),
          contentType: 'text/html',
        };
      } catch (_: unknown) {
        throw new Error(`Error loading ${appConfig.htmlPath}`);
      }
    }
    if (appConfig.cssPath) {
      try {
        result['/index.css'] = {
          data: await readFile(appConfig.cssPath),
          contentType: 'text/css',
        };
      } catch (_: unknown) {
        throw new Error(`Error loading ${appConfig.cssPath}`);
      }
    }
  }
  // All other entries included as JavaScript files
  for (const ep of Object.keys(buildResults)) {
    if (ep === APP_ENTRY_POINT) {
      continue;
    }
    const { source, map } = buildResults[ep];
    result[`/${ep}.js`] = {
      data: textEncoder.encode(source),
      contentType: 'text/javascript',
    };
    result[`/${ep}.js.map`] = {
      data: textEncoder.encode(map),
      contentType: 'application/json',
    };
  }
  return result;
}

const ContentTypeMapping: Record<string, ContentType> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  json: 'application/json',
  js: 'text/javascript',
  ts: 'text/javascript',
  html: 'text/html',
  css: 'text/css',
  wasm: 'application/wasm',
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
