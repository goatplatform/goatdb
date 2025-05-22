import { exists, walk } from '@std/fs';
import { extname } from '@std/path';
import * as esbuild from 'esbuild';
import * as path from '@std/path';
import { denoPlugins } from '@luca/esbuild-deno-loader';
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

export type EntryPoint = { in: string; out: string };

export async function buildAssets(
  ctx: ReBuildContext | typeof esbuild | undefined,
  entryPoints: EntryPoint[],
  appConfig: AppConfig,
): Promise<StaticAssets> {
  if (!ctx) {
    ctx = esbuild;
  }
  const buildResults =
    await (isReBuildContext(ctx) ? ctx.rebuild() : bundleResultFromBuildResult(
      await ctx.build({
        entryPoints,
        plugins: [...denoPlugins()],
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
    ));

  if (ctx === esbuild) {
    await ctx.stop();
  }

  // System assets are always included and are placed at the root
  const result: StaticAssets = {};
  const textEncoder = new TextEncoder();
  // For app code, include html and css files
  if (Object.hasOwn(buildResults, APP_ENTRY_POINT)) {
    const { source, map } = buildResults[APP_ENTRY_POINT];
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
          data: await Deno.readFile(appConfig.htmlPath),
          contentType: 'text/html',
        };
      } catch (_: unknown) {
        throw new Error(`Error loading ${appConfig.htmlPath}`);
      }
    }
    if (appConfig.cssPath) {
      try {
        result['/index.css'] = {
          data: await Deno.readFile(appConfig.cssPath),
          contentType: 'text/css',
        };
      } catch (_: unknown) {
        throw new Error(`Error loading ${appConfig.cssPath}`);
      }
    }
  }
  // All other entries include as
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
  if (!(await exists(dir))) {
    return result;
  }
  for await (
    const { path } of walk(dir, {
      includeDirs: false,
      includeSymlinks: false,
      followSymlinks: false,
    })
  ) {
    if (filter && !filter(path)) {
      continue;
    }
    const origExt = extname(path);
    let ext = origExt.substring(1);
    if (ext === 'ts') {
      ext = 'js';
    }
    let key = path.substring(dir.length).toLowerCase();
    // Rewrite extension to match
    key = key.substring(0, key.length - origExt.length) + '.' + ext;
    if (prefix) {
      key = `${prefix}${key}`;
    }
    result[key] = {
      data: await Deno.readFile(path),
      contentType: ContentTypeMapping[ext] || 'application/octet-stream',
    };
  }
  return result;
}
