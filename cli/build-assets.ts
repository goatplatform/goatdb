import * as path from '../base/path.ts';
import {
  adapterStubPlugin,
  bundleResultFromBuildResult,
  getDenoPlugins,
  getEsbuild,
  isReBuildContext,
  type ReBuildContext,
  stopBackgroundCompiler,
} from '../build.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import type { AppConfig } from './app-config.ts';
import type {
  Asset,
  ContentType,
  StaticAssets,
} from '../system-assets/system-assets.ts';
import { pathExists, readFile, walkDir } from '../base/json-log/file-impl.ts';

export type EntryPoint = { in: string; out: string };

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

export async function buildAssets(
  ctx: ReBuildContext | undefined,
  entryPoints: EntryPoint[],
  appConfig: AppConfig,
  options?: BuildAssetsOptions,
): Promise<StaticAssets> {
  let buildResults: Record<string, { source: string; map: string }>;
  let shouldStopEsbuild = false;
  const targetRuntime = options?.runtime ?? 'deno';

  if (ctx && isReBuildContext(ctx)) {
    buildResults = await ctx.rebuild();
  } else {
    // No context provided, use esbuild directly
    const esbuild = await getEsbuild();

    // Only load denoPlugins for Deno builds - they're incompatible with Node.js
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let plugins: any[];

    if (targetRuntime === 'node') {
      // For Node.js builds, we need a plugin to handle node:* imports that appear
      // in library code but are behind runtime checks. These imports are never
      // actually called in browser, but esbuild needs to resolve them.
      // We provide empty stubs that throw if called (which should never happen).
      const nodeStubPlugin = {
        name: 'node-stub',
        setup(build: { onResolve: Function; onLoad: Function }) {
          // Match all node:* imports
          build.onResolve({ filter: /^node:/ }, (args: { path: string }) => ({
            path: args.path,
            namespace: 'node-stub',
          }));

          // Return empty module that throws if accessed
          build.onLoad(
            { filter: /.*/, namespace: 'node-stub' },
            (args: { path: string }) => ({
              contents: `
                // Stub for ${args.path} - this code should never run in browser
                export default new Proxy({}, {
                  get(_, prop) {
                    throw new Error(\`Cannot access \${String(prop)} from ${args.path} in browser\`);
                  }
                });
                ${
                args.path === 'node:crypto'
                  ? 'export const webcrypto = globalThis.crypto;'
                  : ''
              }
              `,
              loader: 'js',
            }),
          );
        },
      };
      plugins = [adapterStubPlugin(['deno', 'node']), nodeStubPlugin];
    } else {
      plugins = [
        adapterStubPlugin(['deno', 'node']),
        ...(await getDenoPlugins())(),
      ];
    }

    // Build options for client-side code (always browser target)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buildOptions: any = {
      entryPoints,
      plugins,
      bundle: true,
      write: false,
      sourcemap: 'linked',
      outdir: 'output',
      define: { '__BUNDLE_TARGET__': '"browser"' },
      logOverride: {
        'empty-import-meta': 'silent',
      },
      minify: appConfig.minify,
      jsx: 'automatic',
      // Client code is always for browser
      platform: 'browser',
    };

    buildResults = bundleResultFromBuildResult(
      await esbuild.build(buildOptions),
    );
    shouldStopEsbuild = true;
  }

  if (shouldStopEsbuild && !options?.keepEsbuildAlive) {
    await stopBackgroundCompiler();
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
