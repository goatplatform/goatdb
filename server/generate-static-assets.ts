import * as esbuild from 'esbuild';
import { denoPlugins } from '@luca/esbuild-deno-loader';
import * as path from '@std/path';
import { getRepositoryPath } from '../base/development.ts';
import { VCurrent, VersionNumber } from '../base/version-number.ts';
import {
  ReBuildContext,
  isReBuildContext,
  bundleResultFromBuildResult,
} from '../build.ts';
import {
  APP_ENTRY_POINT,
  Asset,
  StaticAssets,
  compileAssetsDirectory,
  staticAssetsToJS,
} from '../net/server/static-assets.ts';
import { getGoatConfig } from './config.ts';
import { AppConfig } from '../cli/config.ts';

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
  ctx: ReBuildContext | typeof esbuild,
  entryPoints: { in: string; out: string }[],
  version: VersionNumber,
  appConfig: AppConfig,
  serverURL?: string,
  orgId?: string,
): Promise<StaticAssets> {
  const buildResults = await(
    isReBuildContext(ctx)
      ? ctx.rebuild()
      : bundleResultFromBuildResult(
          await ctx.build({
            entryPoints,
            plugins: [
              ...denoPlugins({
                configPath: `${await getRepositoryPath()}/deno.json`,
              }),
            ],
            bundle: true,
            write: false,
            sourcemap: 'linked',
            outdir: 'output',
            logOverride: {
              'empty-import-meta': 'silent',
            },
          }),
        ),
  );

  debugger;
  const repoPath = await getRepositoryPath();
  // System assets are always included and are placed at the root
  const result: StaticAssets = await compileAssetsDirectory(
    path.join(repoPath, 'assets'),
  );
  const textEncoder = new TextEncoder();
  // For app code, include html and css files
  if (Object.hasOwn(buildResults, APP_ENTRY_POINT)) {
    const { source, map } = buildResults[APP_ENTRY_POINT];
    if (appConfig.assets) {
      // User provided assets are placed under /assets/
      Object.assign(
        result,
        await compileAssetsDirectory(appConfig.assets, '/assets'),
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
    if (appConfig.html) {
      try {
        result['/index.html'] = {
          data: await Deno.readFile(appConfig.html),
          contentType: 'text/html',
        };
      } catch (_: unknown) {
        throw new Error(`Error loading ${appConfig.html}`);
      }
    }
    if (appConfig.css) {
      try {
        result['/index.css'] = {
          data: await Deno.readFile(appConfig.css),
          contentType: 'text/css',
        };
      } catch (_: unknown) {
        throw new Error(`Error loading ${appConfig.css}`);
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
  const repoPath = await getRepositoryPath();
  await Deno.mkdir(path.join(repoPath, 'build'), { recursive: true });

  console.log('Bundling client code...');
  const assets = await buildAssets(
    ctx,
    [
      {
        in: path.resolve(appPath),
        out: APP_ENTRY_POINT,
      },
      {
        in: path.join(
          await getRepositoryPath(),
          '__file_worker',
          'json-log.worker.ts',
        ),
        out: '__file_worker',
      },
    ],
    version,
  );
  await Deno.writeTextFile(
    path.join(repoPath, 'build', 'staticAssets.json'),
    JSON.stringify(staticAssetsToJS(assets)),
  );
  esbuild.stop();
}
