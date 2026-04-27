// Note: We use ../base/path.ts instead of @std/path to avoid JSR dependencies
// that would break when this module is transitively bundled into SEA binaries.
import * as path from './base/path.ts';
import { APP_ENTRY_POINT } from './net/server/static-assets.ts';
import { readFile } from './base/json-log/file-impl.ts';
import { isDeno } from './base/common.ts';

// IMPORTANT: `esbuild` and `@luca/esbuild-deno-loader` MUST remain `import type`.
// Runtime imports of these Deno/JSR-specific packages break Node.js SEA binaries.
// `readFile` is a GoatDB-internal utility and is safe as a runtime import.
import type { Plugin } from 'esbuild';
import type { denoPlugins } from '@luca/esbuild-deno-loader';

// Lazy-loaded modules to avoid bundling build-time dependencies into runtime code.
// These packages (esbuild, @luca/esbuild-deno-loader) are Deno/JSR-specific and
// cannot be resolved by Node.js at runtime.
// We assign specifiers to variables so bundlers (esbuild) won't statically
// resolve and inline these imports, which would break SEA binaries.
// deno-lint-ignore no-explicit-any
let esbuildModule: any;
// deno-lint-ignore no-explicit-any
let denoPluginsModule: any;

export async function getEsbuild(): Promise<typeof import('esbuild')> {
  if (!esbuildModule) {
    const specifier = 'esbuild';
    esbuildModule = await import(specifier);
  }
  return esbuildModule as typeof import('esbuild');
}

export async function getDenoPlugins(): Promise<typeof denoPlugins> {
  if (!denoPluginsModule) {
    const specifier = '@luca/esbuild-deno-loader';
    denoPluginsModule = await import(specifier);
  }
  return denoPluginsModule.denoPlugins as typeof denoPlugins;
}

export interface BundleResult {
  source: string;
  map: string;
  css?: string; // companion CSS emitted by esbuild from bundled CSS imports; sourceMappingURL already stripped
  cssMap?: string; // corresponding CSS source map JSON string from esbuild .css.map output
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

export function bundleResultFromBuildResult(
  buildResult: { outputFiles?: { path: string; text: string }[] },
): Record<string, BundleResult> {
  const result = {} as Record<string, BundleResult>;
  if (!buildResult.outputFiles) {
    throw new Error(
      'esbuild returned no output files. Ensure write: false is set.',
    );
  }
  for (const file of buildResult.outputFiles) {
    const entryPoint = path.basename(file.path)
      .replace(/\.(js\.map|css\.map|js|css)$/, '') as string;
    let bundleResult: BundleResult | undefined = result[entryPoint];
    if (!bundleResult) {
      bundleResult = {} as BundleResult;
      result[entryPoint] = bundleResult;
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
      bundleResult.css = file.text.replace(
        /\/\*#\s*sourceMappingURL=\S+\s*\*\/\s*$/,
        '',
      );
    }
  }
  return result;
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

export async function stopBackgroundCompiler(): Promise<void> {
  if (esbuildModule) {
    await esbuildModule.stop();
    esbuildModule = undefined;
    denoPluginsModule = undefined;
  }
}

export interface ReBuildContext {
  rebuild(): Promise<Record<string, BundleResult>>;
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
        contents: new TextDecoder().decode(await readFile(args.path)),
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
  const reservedNames = new Set(['node-stub', 'goatdb-css-loader', 'adapter-stub']);
  for (const p of extraPlugins) {
    if (!p.name || typeof p.name !== 'string') {
      throw new Error(
        'GoatDB: esbuild plugin has an invalid name. Expected a non-empty string.',
      );
    }
    if (reservedNames.has(p.name)) {
      throw new Error(
        `GoatDB: esbuild plugin name '${p.name}' is reserved internally (${[...reservedNames].join(', ')}). Rename your plugin.`,
      );
    }
    if (typeof p.setup !== 'function') {
      throw new Error(
        `GoatDB: esbuild plugin '${p.name}' is missing a setup() function.`,
      );
    }
  }
  const plugins: Plugin[] = [adapterStubPlugin(['deno', 'node'])];
  if (targetRuntime === 'node') {
    plugins.push(nodeStubPlugin);
  }
  plugins.push(...extraPlugins as Plugin[], cssLoaderPlugin);
  if (targetRuntime === 'deno') {
    plugins.push(...(await getDenoPlugins())() as unknown as Plugin[]);
  }
  return plugins;
}

/**
 * Creates an esbuild incremental context for the debug server (development,
 * hot-reload). Deno-only — uses `@luca/esbuild-deno-loader` which is not
 * available on Node.js. Production builds go through `buildAssets()` in
 * `cli/build-assets.ts` directly.
 */
export async function createBuildContext(
  entryPoints: { in: string; out: string }[],
  extraPlugins: BuildPluginLike[] = [],
): Promise<ReBuildContext> {
  if (!isDeno()) {
    throw new Error(
      'createBuildContext() is only supported in Deno. GoatDB debug-server ' +
        'bundling uses @luca/esbuild-deno-loader; use buildAssets() or ' +
        'compile() for Node.js production builds.',
    );
  }
  const esbuild = await getEsbuild();
  const ctx = await esbuild.context({
    entryPoints,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: await getClientBuildPlugins('deno', extraPlugins) as any,
    bundle: true,
    write: false,
    sourcemap: 'linked',
    outdir: 'output',
    jsx: 'automatic',
    platform: 'browser',
    define: {
      '__BUNDLE_TARGET__': '"browser"',
      'import.meta.main': 'false',
    },
    logOverride: {
      'empty-import-meta': 'silent',
    },
  });
  return {
    rebuild: async () => bundleResultFromBuildResult(await ctx.rebuild()),
    close: () => ctx.dispose(),
  };
}
