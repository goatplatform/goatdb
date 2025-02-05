import * as esbuild from 'esbuild';
import * as path from '@std/path';
import { denoPlugins } from '@luca/esbuild-deno-loader';
import { VCurrent, type VersionNumber } from '../base/version-number.ts';
import {
  bundleResultFromBuildResult,
  isReBuildContext,
  type ReBuildContext,
} from '../build.ts';
import {
  APP_ENTRY_POINT,
  compileAssetsDirectory,
  type StaticAssets,
} from '../net/server/static-assets.ts';
import { getGoatConfig } from './config.ts';
import { notImplemented } from '../base/error.ts';
import type { AppConfig } from './app-config.ts';

function generateConfigSnippet(
  version: VersionNumber,
  serverURL?: string,
  orgId?: string,
): string {
  const config = {
    ...getGoatConfig(),
    debug: true,
    version,
    orgId,
  };
  delete config.clientData;
  delete config.serverData;
  if (serverURL) {
    config.serverURL = serverURL;
  }
  return `;\n\self.OvvioConfig = ${JSON.stringify(config)};`;
}

export async function buildAssets(
  ctx: ReBuildContext | typeof esbuild | undefined,
  entryPoints: { in: string; out: string }[],
  version: VersionNumber,
  appConfig: AppConfig,
  serverURL?: string,
  orgId?: string,
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
        generateConfigSnippet(version, serverURL, orgId) + source,
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
        generateConfigSnippet(version, serverURL, orgId) + source,
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

export async function defaultAssetsBuild(
  appPath: string,
  version = VCurrent,
  ctx: ReBuildContext,
): Promise<void> {
  notImplemented();
  // const repoPath = await getRepositoryPath();
  // await Deno.mkdir(path.join(repoPath, 'build'), { recursive: true });
  // console.log('Bundling client code...');
  // const assets = await buildAssets(
  //   ctx,
  //   [
  //     {
  //       in: path.resolve(appPath),
  //       out: APP_ENTRY_POINT,
  //     },
  //     {
  //       in: path.join(
  //         await getRepositoryPath(),
  //         '__file_worker',
  //         'json-log.worker.ts',
  //       ),
  //       out: '__file_worker',
  //     },
  //   ],
  //   version,
  // );
  // await Deno.writeTextFile(
  //   path.join(repoPath, 'build', 'staticAssets.json'),
  //   JSON.stringify(staticAssetsToJS(assets)),
  // );
  // esbuild.stop();
}
