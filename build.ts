// Note: We use ../base/path.ts instead of @std/path to avoid JSR dependencies
// that would break when this module is transitively bundled into SEA binaries.
import * as path from './base/path.ts';
import { APP_ENTRY_POINT } from './net/server/static-assets.ts';
import { readFile } from './base/json-log/file-impl.ts';
import { getEffectiveRuntimeId, getRuntime } from './base/runtime/index.ts';
import { log } from './logging/log.ts';

// IMPORTANT: `esbuild` and `@deno/esbuild-plugin` MUST remain `import type`.
// Runtime imports of these Deno/JSR-specific packages break Node.js SEA binaries.
// `readFile` is a GoatDB-internal utility and is safe as a runtime import.
import type { Plugin } from 'esbuild';
import type { denoPlugin } from '@deno/esbuild-plugin';

/** Specifier for esbuild — variable import prevents SEA bundler capture. */
const kEsbuildSpecifier = 'esbuild';
/** Specifier for the Deno esbuild plugin — used in imports and external lists. */
export const kDenoEsbuildPluginSpecifier = '@deno/esbuild-plugin';
/** JSR npm-proxy specifier for the Deno esbuild plugin. */
export const kJsrDenoEsbuildPluginSpecifier = '@jsr/deno__esbuild-plugin';

// Lazy-loaded modules to avoid bundling build-time dependencies into runtime code.
// These packages (esbuild, @deno/esbuild-plugin) are Deno/JSR-specific and
// cannot be resolved by Node.js at runtime.
// We assign specifiers to variables so bundlers (esbuild) won't statically
// resolve and inline these imports, which would break SEA binaries.
// Cached import promises — concurrent callers share one in-flight import, but
// failed imports must clear the cache so later calls can retry.
/** Mutable cache slot for a lazily imported module. */
export interface ImportCacheState<T> {
  promise?: Promise<T>;
}

/**
 * Shares one in-flight dynamic import across callers, but clears rejected
 * imports so later calls can retry.
 */
export function getCachedImport<T>(
  state: ImportCacheState<T>,
  importer: () => Promise<T>,
): Promise<T> {
  if (!state.promise) {
    let pending: Promise<T>;
    pending = importer().catch((err) => {
      if (state.promise === pending) state.promise = undefined;
      throw err;
    });
    state.promise = pending;
  }
  return state.promise;
}

/** Clears the cached import before callers await or dispose the prior one. */
export function resetImportState<T>(
  state: ImportCacheState<T>,
): Promise<T> | undefined {
  const pending = state.promise;
  state.promise = undefined;
  return pending;
}

// deno-lint-ignore no-explicit-any
const esbuildImportState: ImportCacheState<any> = {};
// deno-lint-ignore no-explicit-any
const denoPluginImportState: ImportCacheState<any> = {};

export async function getEsbuild(): Promise<typeof import('esbuild')> {
  return (await getCachedImport(
    esbuildImportState,
    () =>
      import(kEsbuildSpecifier).catch((cause) => {
        throw new Error(
          `esbuild is required for GoatDB build operations ` +
            `(compile, startDebugServer) but is not installed.\n` +
            `Install it with: npm install esbuild\n` +
            `(esbuild is an optional dependency of @goatdb/goatdb; ` +
            `core DB and server functionality work without it.)\n` +
            `Original error: ${String(cause)}`,
          { cause },
        );
      }),
  )) as typeof import('esbuild');
}

export async function getDenoPlugin(): Promise<typeof denoPlugin> {
  const mod = await getCachedImport(
    denoPluginImportState,
    () => import(kDenoEsbuildPluginSpecifier),
  );
  const plugin = (mod.denoPlugin || mod.default) as
    | typeof denoPlugin
    | undefined;
  if (!plugin) {
    throw new Error(
      `${kDenoEsbuildPluginSpecifier} is missing the expected 'denoPlugin' export.`,
    );
  }
  return plugin;
}

export interface BundleResult {
  source?: string; // JS bundle text; undefined for CSS-only entries (esbuild always emits JS, type is honest)
  map?: string; // JS source map text
  css?: string; // companion CSS emitted by esbuild from bundled CSS imports; sourceMappingURL already stripped
  cssMap?: string; // corresponding CSS source map JSON string from esbuild .css.map output
}

export interface BuildOutput {
  bundles: Record<string, BundleResult>;
  assets: Record<string, Uint8Array>;
}

/**
 * Minimal public plugin shape for GoatDB's build-only APIs.
 * Keeps `esbuild` out of the root package's exported type surface while still
 * allowing callers to pass standard esbuild-compatible plugins.
 *
 * Plugins run before GoatDB's fallback CSS loader, so they can resolve package
 * CSS, rewrite local CSS imports, or provide other browser bundle transforms.
 */
export interface BuildPluginLike {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup(build: any): void;
}

export const kAssetLoaders = {
  '.gif': 'file',
  '.png': 'file',
  '.jpg': 'file',
  '.jpeg': 'file',
  '.svg': 'file',
  '.webp': 'file',
  '.woff': 'file',
  '.woff2': 'file',
  '.ttf': 'file',
} as const;

export const kAssetNamesPattern = 'assets/[name]-[hash]';

const textDecoder = new TextDecoder();

const kCssSourceMapPattern = /\/\*[#@]\s*sourceMappingURL=\S+\s*\*\/\s*$/;
const kTrailingCssCommentPattern = /\/\*(?:(?!\*\/)[\s\S])*\*\/\s*$/;
const kCssSourceMapDirectiveCommentPattern =
  /^\/\*[#@]\s*sourceMappingURL\b[\s\S]*\*\/\s*$/;

function outputPathForFile(filePath: string): string {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const parts = normalizedPath.split('/');
  const outputIndex = parts.lastIndexOf('output');
  if (outputIndex >= 0 && outputIndex + 1 < parts.length) {
    return parts.slice(outputIndex + 1).join('/');
  }
  return path.basename(normalizedPath);
}

function bundleKeyForFile(filePath: string): string {
  return outputPathForFile(filePath)
    .replace(/\.(js\.map|css\.map|js|css)$/, '');
}

export function bundleResultFromBuildResult(
  buildResult: {
    outputFiles?: { path: string; text: string; contents: Uint8Array }[];
  },
): BuildOutput {
  const bundles = {} as Record<string, BundleResult>;
  const assets = {} as Record<string, Uint8Array>;
  if (!buildResult.outputFiles) {
    throw new Error(
      'esbuild returned no output files. Ensure write: false is set.',
    );
  }
  for (const file of buildResult.outputFiles) {
    if (
      !file.path.endsWith('.js') &&
      !file.path.endsWith('.js.map') &&
      !file.path.endsWith('.css') &&
      !file.path.endsWith('.css.map')
    ) {
      const assetPath = `/${outputPathForFile(file.path)}`;
      assets[assetPath] = file.contents;
      continue;
    }

    const entryPoint = bundleKeyForFile(file.path) as string;
    let bundleResult: BundleResult | undefined = bundles[entryPoint];
    if (!bundleResult) {
      bundleResult = {} as BundleResult;
      bundles[entryPoint] = bundleResult;
    }
    if (file.path.endsWith('.js')) {
      bundleResult.source = file.text;
    } else if (file.path.endsWith('.js.map')) {
      bundleResult.map = file.text;
    } else if (file.path.endsWith('.css.map')) {
      // Collect the esbuild CSS source map; offset correction happens in
      // buildAssets when CSS chunks are combined into the final emitted asset.
      bundleResult.cssMap = file.text;
    } else if (file.path.endsWith('.css')) {
      // Strip the trailing sourceMappingURL comment — buildAssets reattaches the
      // final map URL for whichever emitted CSS asset owns this chunk.
      // Warn only when the final trailing CSS comment looks like a malformed
      // sourceMappingURL footer. Earlier comments and arbitrary CSS content may
      // legitimately contain the same text and must not trigger warnings.
      const trailingComment = file.text.match(kTrailingCssCommentPattern)?.[0];
      const hadMapUrl = kCssSourceMapPattern.test(file.text);
      bundleResult.css = file.text.replace(kCssSourceMapPattern, '');
      if (
        trailingComment &&
        kCssSourceMapDirectiveCommentPattern.test(trailingComment) &&
        !hadMapUrl
      ) {
        log({
          severity: 'WARNING',
          message:
            'CSS sourceMappingURL comment does not match expected format. ' +
            'esbuild may have changed its output format.',
        });
      }
    }
  }
  return { bundles, assets };
}

/**
 * Creates an esbuild plugin that replaces runtime adapter modules with empty
 * stubs. Used to exclude unused adapters from platform-specific bundles.
 */
export function adapterStubPlugin(
  adapters: ('deno' | 'node' | 'browser')[],
): Plugin {
  const exportNames: Record<string, string> = {
    deno: 'DenoAdapter',
    node: 'NodeAdapter',
    browser: 'BrowserAdapter',
  };
  return {
    name: 'adapter-stub',
    setup(build) {
      for (const adapter of adapters) {
        const re = new RegExp(`runtime[/\\\\]adapters[/\\\\]${adapter}\\.ts$`);
        build.onLoad({ filter: re }, () => ({
          contents: `export const ${exportNames[adapter]} = {};`,
          loader: 'ts',
        }));
      }
    },
  };
}

/**
 * Stops the esbuild background worker WITHOUT clearing the import cache.
 * Use this when you only need to release the esbuild worker between
 * compilation cycles but expect to compile again — avoids the cost and
 * the shared-state side effects of a full {@link stopBackgroundCompiler}
 * teardown.
 */
export async function stopEsbuildWorker(): Promise<void> {
  if (esbuildImportState.promise) {
    const mod = await esbuildImportState.promise;
    await mod.stop();
  }
}

export async function stopBackgroundCompiler(): Promise<void> {
  const esbuildPromise = resetImportState(esbuildImportState);
  // denoPlugin cleanup is fire-and-forget: @deno/esbuild-plugin has no destructor
  // or stop method — we only need to clear the cached promise so the next call to
  // getDenoPlugin() starts a fresh import. The .catch() prevents an unhandled
  // rejection if the in-flight import fails.
  resetImportState(denoPluginImportState)?.catch(() => {});
  if (esbuildPromise) {
    const mod = await esbuildPromise;
    await mod.stop();
  }
}

export interface ReBuildContext {
  rebuild(): Promise<BuildOutput>;
  close(): void;
}

export function isReBuildContext(
  ctx: ReBuildContext | { context: unknown },
): ctx is ReBuildContext {
  return typeof (ctx as ReBuildContext).rebuild === 'function';
}

// Load resolved CSS files before the runtime module loaders (deno-loader /
// node-stub) see them. This keeps native CSS Modules semantics for
// `.module.css` while still letting user plugins rewrite CSS imports by
// returning a different file-namespace path from onResolve.
export const cssLoaderPlugin: Plugin = {
  name: 'goatdb-css-loader',
  setup(build) {
    build.onLoad(
      { filter: /\.css$/, namespace: 'file' },
      async (args) => ({
        contents: textDecoder.decode(await readFile(args.path)),
        loader: args.path.endsWith('.module.css') ? 'local-css' : 'css',
        resolveDir: path.dirname(args.path),
        watchFiles: [args.path],
      }),
    );
  },
};

/**
 * Intercepts `node:*` imports in browser bundles with empty stubs that throw
 * if called at runtime (which should never happen). Required for Node.js-path
 * builds where library code contains `node:*` imports behind runtime checks.
 */
export const nodeStubPlugin: Plugin = {
  name: 'node-stub',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path,
      namespace: 'node-stub',
    }));
    build.onLoad(
      { filter: /.*/, namespace: 'node-stub' },
      (args) => ({
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

/**
 * Returns the shared client-bundle plugin stack in precedence order.
 *
 * Ordering is intentional:
 * - adapter stubs always run first so unused runtime adapters never bundle in.
 * - node stubs (Node.js production only) must run before user plugins so
 *   browser bundles cannot remap `node:*` imports back into real Node APIs.
 * - user plugins run before GoatDB's CSS fallback so they can rewrite or
 *   resolve local `.css` imports when desired.
 * - cssLoaderPlugin remains the fallback that turns unresolved CSS files into
 *   native esbuild CSS / CSS Modules inputs.
 * - Deno runtime loaders stay last so user plugins and cssLoaderPlugin can
 *   intercept imports before deno-loader sees them.
 */
export async function getClientBuildPlugins(
  targetRuntime: 'deno' | 'node',
  extraPlugins: BuildPluginLike[] = [],
): Promise<Plugin[]> {
  const seen = new Map<string, number>();
  for (const p of extraPlugins) {
    if (p.name && typeof p.name === 'string') {
      seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
    }
  }
  const duplicates = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  if (duplicates.length > 0) {
    throw new Error(
      `GoatDB: duplicate esbuild plugin names: ${duplicates.join(', ')}.`,
    );
  }
  const adapterStub = adapterStubPlugin(['deno', 'node']);
  const reservedNames = new Set([
    adapterStub.name,
    nodeStubPlugin.name,
    cssLoaderPlugin.name,
  ]);
  for (const p of extraPlugins) {
    if (!p.name || typeof p.name !== 'string') {
      throw new Error(
        'GoatDB: esbuild plugin has an invalid name. Expected a non-empty string.',
      );
    }
    if (reservedNames.has(p.name)) {
      throw new Error(
        `GoatDB: esbuild plugin name '${p.name}' is reserved internally (${
          [...reservedNames].join(', ')
        }). Rename your plugin.`,
      );
    }
    if (typeof p.setup !== 'function') {
      throw new Error(
        `GoatDB: esbuild plugin '${p.name}' is missing a setup() function.`,
      );
    }
  }
  const plugins: Plugin[] = [adapterStub];
  if (targetRuntime === 'node') {
    plugins.push(nodeStubPlugin);
  }
  plugins.push(...extraPlugins as Plugin[], cssLoaderPlugin);
  if (targetRuntime === 'deno') {
    if (getRuntime().id !== 'deno') {
      throw new Error(
        'GoatDB: cannot build Deno-target bundle from Node.js. ' +
          'Deno loader plugin (@deno/esbuild-plugin) requires the Deno runtime. ' +
          'Use runtime: "node" or run the build under Deno.',
      );
    }
    // Double cast via unknown: @deno/esbuild-plugin's Plugin type may differ
    // nominally from our installed esbuild version due to JSR/npm version
    // skew, but they are structurally compatible at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins.push((await getDenoPlugin())() as unknown as any);
  }
  return plugins;
}

export function sharedClientBuildOptions() {
  return {
    bundle: true,
    write: false,
    sourcemap: 'linked' as const,
    outdir: 'output',
    jsx: 'automatic' as const,
    platform: 'browser' as const,
    loader: kAssetLoaders,
    assetNames: kAssetNamesPattern,
    define: {
      '__BUNDLE_TARGET__': '"browser"',
      'import.meta.main': 'false',
    },
    logOverride: { 'empty-import-meta': 'silent' as const },
  };
}

/**
 * Canonicalizes build entry paths before they cross into the bundling layer.
 * Existing `file://` URLs are preserved as-is. UNC paths must use `file://`
 * URL form so loaders preserve the host/share boundary. Drive-letter paths
 * are normalized to forward slashes for esbuild compatibility on Windows.
 *
 * POSIX absolute paths are returned unchanged. Relative paths are returned
 * unchanged — this function does NOT resolve them; see
 * {@link resolveBuildEntryPath} for inputs that may be relative or in local
 * `file://` URL form.
 *
 * @remarks Use {@link resolveBuildEntryPath} for user-facing inputs (config
 *   values, CLI arguments) that may be relative or need local `file://` URLs
 *   decoded to filesystem paths. Use this function only for already-decoded
 *   path strings when format conversion (UNC ↔ `file://`, backslash ↔ forward
 *   slash) is the only concern.
 */
export function normalizeBuildEntryPath(entryPath: string): string {
  // Existing file:// specifiers are already valid build-entry inputs.
  if (path.isFileUrlPath(entryPath)) {
    return entryPath;
  }
  // UNC paths must use file:// URL form to preserve host/share boundary
  if (path.isUncPathRaw(entryPath)) {
    return path.toFileUrl(entryPath).href;
  }
  // Drive-letter paths: normalize to forward slashes for esbuild
  if (/^[A-Za-z]:[/\\]/.test(entryPath)) {
    return entryPath.replace(/\\/g, '/');
  }
  return entryPath;
}

/**
 * Resolves public build entry inputs into absolute build-entry specifiers.
 *
 * Accepts relative paths, `file://` URLs, Windows drive-letter paths, and
 * UNC paths. Relative paths are resolved against the current working
 * directory. Local `file://` URLs are decoded to filesystem paths before the
 * format-conversion rules in {@link normalizeBuildEntryPath} are applied.
 *
 * The returned value is intended for build tooling such as esbuild:
 * - POSIX paths and Windows drive-letter paths become absolute filesystem
 *   paths.
 * - UNC inputs become `file://` URLs so the host/share boundary is preserved.
 *
 * @remarks Use this function for any entry path originating from user input
 *   (config files, CLI arguments, environment variables). Use
 *   {@link normalizeBuildEntryPath} directly when you already have an
 *   absolute path and only need format conversion.
 */
export function resolveBuildEntryPath(entryPath: string): string {
  if (path.isFileUrlPath(entryPath)) {
    const fsPath = path.fromFileUrl(entryPath);
    // UNC file:// URL decodes to a //host/share path which must stay a file://
    // specifier so esbuild preserves the host/share boundary.
    if (path.isUncPathRaw(fsPath)) {
      return entryPath;
    }
    return normalizeBuildEntryPath(fsPath);
  }
  return normalizeBuildEntryPath(path.resolve(entryPath));
}

/**
 * Creates an esbuild incremental context for the debug server (development,
 * hot-reload).
 *
 * Deno contexts use `@deno/esbuild-plugin`; Node.js contexts use GoatDB's
 * browser-target plugin stack without the Deno loader. Production builds still
 * go through `buildAssets()` in `cli/build-assets.ts` directly.
 *
 * @param entryPoints Entry-point descriptors passed to esbuild.
 *   `entryPoints[].in` accepts any of: POSIX absolute path, Windows
 *   drive-letter path, UNC path, `file://` URL, or relative path —
 *   normalized to an esbuild entry specifier internally before esbuild
 *   receives it (filesystem path for local entries, `file://` URL for UNC).
 * @param extraPlugins Optional esbuild-compatible plugins injected between
 *   GoatDB's stub plugins and the CSS fallback loader.
 */
export async function createBuildContext(
  entryPoints: { in: string; out: string }[],
  extraPlugins: BuildPluginLike[] = [],
): Promise<ReBuildContext> {
  const runtime = getEffectiveRuntimeId();
  if (runtime !== 'deno' && runtime !== 'node') {
    throw new Error(
      'createBuildContext() is only supported in Deno or Node.js. ' +
        'Use compile() for production builds targeting other runtimes.',
    );
  }
  const esbuild = await getEsbuild();
  const ctx = await esbuild.context({
    entryPoints: entryPoints.map((ep) => ({
      ...ep,
      in: resolveBuildEntryPath(ep.in),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: await getClientBuildPlugins(
      runtime as 'deno' | 'node',
      extraPlugins,
    ) as any,
    ...sharedClientBuildOptions(),
  });
  return {
    rebuild: async () => bundleResultFromBuildResult(await ctx.rebuild()),
    close: () => ctx.dispose(),
  };
}
