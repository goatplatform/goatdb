import * as path from '../base/path.ts';
import { assert } from '../base/error.ts';
import {
  type BuildOutput,
  type BuildPluginLike,
  bundleResultFromBuildResult,
  getClientBuildPlugins,
  getEsbuild,
  isReBuildContext,
  type ReBuildContext,
  resolveBuildEntryPath,
  sharedClientBuildOptions,
  stopBackgroundCompiler,
} from '../build.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import type { AppConfig } from './app-config.ts';
import {
  type Asset,
  type StaticAssets,
} from '../system-assets/system-assets.ts';
import {
  type ContentType,
  ContentTypeMapping,
} from '../system-assets/content-type.ts';
import { pathExists, readFile, walkDir } from '../base/json-log/file-impl.ts';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

interface CSSChunk {
  content: string; // CSS text (sourceMappingURL comment already stripped)
  map?: string; // source map JSON string from esbuild, if available
}

/** @internal Counts '\n' characters in s — used to compute line offsets for the sections source map. */
export function countNewlines(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === '\n') n++;
  return n;
}

/**
 * @internal
 * Combines CSS chunks into a single /index.css string and, when source maps are
 * available, a /index.css.map.
 *
 * Strategy:
 * - Zero source-mapped chunks → no map emitted.
 * - Exactly one chunk, and it has a map → serve the esbuild map as-is
 *   (skip the sections wrapper to keep the map simple).
 * - Multiple chunks or mixed map/no-map → emit a sections-format map with
 *   correct line offsets for each mapped chunk. Unmapped chunks (e.g. a raw
 *   cssPath vendor file) are silently omitted from the map — DevTools will
 *   simply show no source for those lines, which is acceptable for vendor CSS.
 */
export function buildCombinedCSS(
  chunks: CSSChunk[],
  mapUrl: string,
): { css: string; cssMap?: string } {
  const cssBody = chunks.map((c) => c.content).join('\n\n');

  const mappedChunks = chunks.filter((c) => c.map);
  if (mappedChunks.length === 0) {
    return { css: cssBody };
  }

  // Single mapped chunk — serve its source map directly (most common case).
  if (chunks.length === 1 && chunks[0].map) {
    return {
      css: cssBody + `\n/*# sourceMappingURL=${mapUrl} */`,
      cssMap: chunks[0].map,
    };
  }

  // Multiple chunks: build a sections-format composite map.
  const sections: {
    offset: { line: number; column: number };
    map: Record<string, unknown>;
  }[] = [];
  let lineOffset = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].map) {
      sections.push({
        offset: { line: lineOffset, column: 0 },
        map: JSON.parse(chunks[i].map!),
      });
    }
    // Advance by the chunk's generated newline count plus the unconditional
    // '\n\n' separator inserted between chunks.
    lineOffset += countNewlines(chunks[i].content);
    if (i < chunks.length - 1) lineOffset += 2;
  }

  return {
    css: cssBody + `\n/*# sourceMappingURL=${mapUrl} */`,
    cssMap: JSON.stringify({ version: 3, sections }),
  };
}

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
  /**
   * Custom esbuild plugins injected between GoatDB's stub plugins and the CSS
   * fallback loader.
   * Throws when a pre-built ReBuildContext is also passed because plugins must
   * be registered when that context is created.
   */
  esbuildPlugins?: BuildPluginLike[];
}

/**
 * Bundles client-side assets using esbuild and assembles the complete
 * {@link StaticAssets} map served by GoatDB's HTTP layer.
 *
 * @param ctx Pre-built {@link ReBuildContext} for incremental rebuilds. When
 *   provided, `options.esbuildPlugins` must be omitted because plugins are
 *   fixed at context-creation time; passing both throws.
 * @param entryPoints Entry-point descriptors forwarded to esbuild.
 *   `entryPoints[].in` accepts any path form (native absolute, `file://` URL,
 *   relative) — normalized to an esbuild entry specifier internally
 *   (filesystem path for local entries, `file://` URL for UNC).
 * @param appConfig Application configuration (HTML template, CSS, assets dir…).
 * @param options Optional runtime and plugin overrides.
 */
export async function buildAssets(
  ctx: ReBuildContext | undefined,
  entryPoints: EntryPoint[],
  appConfig: AppConfig,
  options?: BuildAssetsOptions,
): Promise<StaticAssets> {
  let buildOutput: BuildOutput;
  let shouldStopEsbuild = false;
  const targetRuntime = options?.runtime ?? 'deno';
  if (ctx && isReBuildContext(ctx)) {
    if (options?.esbuildPlugins?.length) {
      throw new Error(
        'BuildAssetsOptions.esbuildPlugins cannot be provided together with a ' +
          'pre-built ReBuildContext — plugins must be registered when the ' +
          'context is created via createBuildContext().',
      );
    }
    buildOutput = await ctx.rebuild();
  } else {
    // No context provided, use esbuild directly
    const esbuild = await getEsbuild();

    // Build options for client-side code (always browser target)
    const buildOptions: import('esbuild').BuildOptions = {
      entryPoints: entryPoints.map((ep) => ({
        ...ep,
        in: resolveBuildEntryPath(ep.in),
      })),
      plugins: await getClientBuildPlugins(
        targetRuntime,
        options?.esbuildPlugins ?? [],
      ),
      ...sharedClientBuildOptions(),
      minify: appConfig.minify,
    };

    buildOutput = bundleResultFromBuildResult(
      await esbuild.build(buildOptions),
    );
    shouldStopEsbuild = true;
  }

  if (shouldStopEsbuild && !options?.keepEsbuildAlive) {
    await stopBackgroundCompiler();
  }

  // System assets are always included and are placed at the root
  const result: StaticAssets = {};
  const buildResults = buildOutput.bundles;

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

  for (const [assetPath, data] of Object.entries(buildOutput.assets)) {
    result[assetPath] = {
      data,
      contentType: contentTypeForPath(assetPath),
    };
  }

  // For app code, include html and css files
  if (Object.hasOwn(buildResults, APP_ENTRY_POINT)) {
    if (appConfig.htmlPath) {
      try {
        result['/index.html'] = {
          data: await readFile(appConfig.htmlPath),
          contentType: 'text/html',
        };
      } catch (e: unknown) {
        throw new Error(`Error loading ${appConfig.htmlPath}`, { cause: e });
      }
    }
    // Emit /index.css — the main app entry's stylesheet plus optional cssPath.
    // Always emitted when the entry-point build succeeds (even if empty) so the
    // <link rel="stylesheet" href="/index.css"> tag in index.html never 404s.
    //
    // Invariant: global/vendor CSS (cssPath) is prepended before bundled CSS so that
    // component styles can override vendor resets (later rules win in the CSS cascade).
    const cssChunks: CSSChunk[] = [];
    if (appConfig.cssPath) {
      try {
        cssChunks.push({
          content: textDecoder.decode(await readFile(appConfig.cssPath)),
          // cssPath is a raw vendor/reset file — no source map to attach.
        });
      } catch (e: unknown) {
        throw new Error(`Error loading ${appConfig.cssPath}`, { cause: e });
      }
    }
    if (buildResults[APP_ENTRY_POINT].css) {
      cssChunks.push({
        content: buildResults[APP_ENTRY_POINT].css,
        map: buildResults[APP_ENTRY_POINT].cssMap,
      });
    }

    const { css: combinedCss, cssMap } = buildCombinedCSS(
      cssChunks,
      '/index.css.map',
    );
    result['/index.css'] = {
      data: textEncoder.encode(combinedCss),
      contentType: 'text/css',
    };
    if (cssMap) {
      result['/index.css.map'] = {
        data: textEncoder.encode(cssMap),
        contentType: 'application/json',
      };
    }
  }
  // All other entries included as JavaScript files, with per-entry CSS emitted
  // alongside the JS when that entry imported styles.
  for (const ep of Object.keys(buildResults)) {
    const { source, map } = buildResults[ep];
    // Every entry point produces JS output from esbuild. If this fires,
    // the build pipeline has a bug (e.g., CSS-only entry without JS stub).
    assert(source !== undefined, `Missing JS output for entry "${ep}"`);
    assert(map !== undefined, `Missing source map for entry "${ep}"`);
    if (ep === APP_ENTRY_POINT) {
      result['/app.js'] = {
        data: textEncoder.encode(source),
        contentType: 'text/javascript',
      };
      result['/app.js.map'] = {
        data: textEncoder.encode(map),
        contentType: 'application/json',
      };
      continue;
    }
    result[`/${ep}.js`] = {
      data: textEncoder.encode(source),
      contentType: 'text/javascript',
    };
    result[`/${ep}.js.map`] = {
      data: textEncoder.encode(map),
      contentType: 'application/json',
    };
    if (buildResults[ep].css) {
      const cssAssetPath = `/${ep}.css`;
      const cssMapAssetPath = `/${ep}.css.map`;
      const { css, cssMap } = buildCombinedCSS(
        [{ content: buildResults[ep].css, map: buildResults[ep].cssMap }],
        cssMapAssetPath,
      );
      result[cssAssetPath] = {
        data: textEncoder.encode(css),
        contentType: 'text/css',
      };
      if (cssMap) {
        result[cssMapAssetPath] = {
          data: textEncoder.encode(cssMap),
          contentType: 'application/json',
        };
      }
    }
  }
  return result;
}

function contentTypeForPath(filePath: string): ContentType {
  const ext = path.extname(filePath).substring(1).toLowerCase();
  return ContentTypeMapping[ext] || 'application/octet-stream';
}

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
      contentType: contentTypeForPath(filePath),
    };
  }
  return result;
}
