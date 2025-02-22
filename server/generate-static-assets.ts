import * as esbuild from 'esbuild';
import * as path from '@std/path';
import { denoPlugins } from '@luca/esbuild-deno-loader';
import type { VersionNumber } from '../base/version-number.ts';
import {
  bundleResultFromBuildResult,
  isReBuildContext,
  type ReBuildContext,
} from '../build.ts';
import {
  APP_ENTRY_POINT,
  compileAssetsDirectory,
} from '../net/server/static-assets.ts';
import { getGoatConfig } from './config.ts';
import type { AppConfig } from './app-config.ts';
import type { StaticAssets } from '../system-assets/system-assets.ts';

function generateConfigSnippet(
  version: VersionNumber,
  serverURL?: string,
  orgId?: string,
  debug?: boolean,
): string {
  const config = {
    ...getGoatConfig(),
    debug,
    version,
    orgId,
  };
  delete config.clientData;
  delete config.serverData;
  if (serverURL) {
    config.serverURL = serverURL;
  }
  return `;\n\self.GoatConfig = ${JSON.stringify(config)};`;
}

export type EntryPoint = { in: string; out: string };

export async function buildAssets(
  ctx: ReBuildContext | typeof esbuild | undefined,
  entryPoints: EntryPoint[],
  version: VersionNumber,
  appConfig: AppConfig,
  serverURL?: string,
  orgId?: string,
  debug?: boolean,
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
      data: textEncoder.encode(
        generateConfigSnippet(version, serverURL, orgId, debug) + source,
      ),
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
      data: textEncoder.encode(
        generateConfigSnippet(version, serverURL, orgId, debug) + source,
      ),
      contentType: 'text/javascript',
    };
    result[`/${ep}.js.map`] = {
      data: textEncoder.encode(map),
      contentType: 'application/json',
    };
  }
  return result;
}
