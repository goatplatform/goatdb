// Note: We use ../base/path.ts instead of @std/path to avoid JSR dependencies
// that would break when this module is transitively bundled into SEA binaries.
import { APP_ENTRY_POINT } from './base/app-entry-point.ts';
import {
  getDenoPlugin,
  getEsbuild,
  stopBackgroundCompiler,
} from './base/build-dependencies.ts';
import { isWindows } from './base/common.ts';
import * as path from './base/path.ts';
// IMPORTANT: These MUST remain `import type` — runtime imports would break
// Node.js SEA binaries since esbuild/deno-plugin are Deno-specific packages.
import type { BuildOptions, Loader, Plugin } from 'esbuild';

export { getDenoPlugin, getEsbuild, stopBackgroundCompiler };

export type EntryPoint = { in: string; out: string };

/**
 * Everything needed to bundle the browser client. Shared by compile() and the
 * debug server's rebuild loop so dev and production builds never diverge.
 */
export interface ClientBundleSpec {
  entryPoints: EntryPoint[];
  runtime: 'deno' | 'node';
  minify?: boolean;
  userPlugins?: Plugin[];
  /**
   * Path to the project's deno.json. Passed to @deno/esbuild-plugin so app
   * dependencies (import map) resolve regardless of the process CWD, whose
   * config the plugin would otherwise auto-discover.
   */
  denoConfigPath?: string;
}

/** Per entry-point outputs, keyed by the entry's out name. */
export interface BundleResult {
  js?: string;
  jsMap?: string;
  css?: string;
  cssMap?: string;
}

export interface ClientBuildOutput {
  bundles: Record<string, BundleResult>;
  /** Files emitted by esbuild's 'file' loader (CSS url() refs), keyed by basename. */
  assets: Record<string, Uint8Array>;
}

function assertValidPlugins(plugins: Plugin[], owner: string): void {
  for (const plugin of plugins) {
    if (
      !plugin || typeof plugin.name !== 'string' ||
      typeof plugin.setup !== 'function'
    ) {
      throw new Error(
        `Invalid esbuild plugin from ${owner}: expected a string name and setup function.`,
      );
    }
  }
}

/**
 * Canonicalizes a build entry path before it crosses into the bundling layer.
 * On Windows, the Deno WASM resolver (@deno/esbuild-plugin) parses drive-letter
 * paths (C:/foo) with `C:` as a URL scheme — dropping the drive letter and
 * breaking resolution. UNC paths must also use file:// form so the host/share
 * boundary stays intact. POSIX absolute, relative, and existing file:// paths
 * pass through unchanged.
 */
export function normalizeBuildEntryPath(entryPath: string): string {
  if (/^[A-Za-z]:[/\\]/.test(entryPath) || /^[/\\]{2}[^/\\]/.test(entryPath)) {
    return path.toFileUrl(entryPath);
  }
  return entryPath;
}

/**
 * Converts Deno-target entry points to file:// URLs on Windows so the WASM
 * resolver doesn't mangle drive-letter paths. Node's native resolver and
 * POSIX paths are unaffected.
 */
function denoEntryPoints(spec: ClientBundleSpec): EntryPoint[] {
  if (spec.runtime !== 'deno' || !isWindows()) {
    return spec.entryPoints;
  }
  return spec.entryPoints.map((e) => ({
    ...e,
    in: normalizeBuildEntryPath(e.in),
  }));
}

/** Single source of truth for client (browser) esbuild options. */
export async function clientBuildOptions(
  spec: ClientBundleSpec,
): Promise<BuildOptions> {
  const plugins = await clientPlugins(
    spec.runtime,
    spec.userPlugins ?? [],
    spec.denoConfigPath,
  );
  return {
    entryPoints: denoEntryPoints(spec),
    plugins,
    bundle: true,
    write: false,
    sourcemap: 'linked',
    outdir: 'output',
    define: {
      '__BUNDLE_TARGET__': '"browser"',
      // Prevent CLI entry-point code (if (import.meta.main) {...}) from
      // being bundled into the browser client bundle.
      'import.meta.main': 'false',
    },
    logOverride: {
      'empty-import-meta': 'silent',
    },
    minify: spec.minify,
    jsx: 'automatic',
    // Client code is always for browser
    platform: 'browser',
    // Relative url() references in bundled CSS are emitted under assets/ so
    // the URLs esbuild rewrites stay valid when CSS is served from /index.css.
    loader: kClientLoaders,
    assetNames: 'assets/[name]-[hash]',
  };
}

async function clientPlugins(
  runtime: 'deno' | 'node',
  userPlugins: Plugin[],
  denoConfigPath?: string,
): Promise<Plugin[]> {
  assertValidPlugins(userPlugins, 'AppConfig.esbuildPlugins');
  const adapterPlugin = adapterStubPlugin(['deno', 'node']);
  if (runtime === 'node') {
    return [adapterPlugin, nodeStubPlugin(), ...userPlugins];
  }
  // @deno/esbuild-plugin is a single resolver+loader plugin (WASM). It must be
  // registered LAST: esbuild runs handlers in registration order, so user
  // plugins and browserAssetPlugin win the onLoad chain for CSS/assets, and
  // user onResolve handlers see raw specifiers (with resolveDir) rather than
  // pre-resolved paths (the @luca resolver/loader split no longer exists).
  // configPath: the plugin's config discovery is CWD-based, so the project's
  // deno.json must be passed explicitly or app deps fail to resolve.
  return [
    adapterPlugin,
    ...userPlugins,
    browserAssetPlugin(),
    (await getDenoPlugin())({
      configPath: denoConfigPath,
    }) as unknown as Plugin,
  ];
}

const kClientLoaders: Record<string, Loader> = {
  '.css': 'css',
  '.png': 'file',
  '.jpg': 'file',
  '.jpeg': 'file',
  '.gif': 'file',
  '.svg': 'file',
  '.webp': 'file',
  '.ico': 'file',
  '.woff': 'file',
  '.woff2': 'file',
  '.ttf': 'file',
  '.otf': 'file',
  '.eot': 'file',
};

// Single source of truth: derive the asset filter regex from kClientLoaders keys.
const kAssetFilter = new RegExp(
  `(?:${
    Object.keys(kClientLoaders).map((e) => e.replace('.', '\\.')).join('|')
  })$`,
);

// The Deno loader claims every local file, so browser assets need an explicit
// fallback before it instead of esbuild's unreachable default loaders.
function browserAssetPlugin(): Plugin {
  return {
    name: 'browser-asset-loader',
    setup(build) {
      build.onLoad(
        {
          filter: kAssetFilter,
          namespace: 'file',
        },
        async (args) => ({
          contents: await readBuildFile(args.path),
          loader: kClientLoaders[path.extname(args.path)],
        }),
      );
    },
  };
}

async function readBuildFile(filePath: string): Promise<Uint8Array> {
  return await (await import('node:fs/promises')).readFile(filePath);
}

// Node.js builds: stub node:* imports that appear in library code behind
// runtime checks. Never called in browser, but esbuild must resolve them.
function nodeStubPlugin(): Plugin {
  return {
    name: 'node-stub',
    setup(build) {
      build.onResolve({ filter: /^node:/ }, (args) => ({
        path: args.path,
        namespace: 'node-stub',
      }));
      build.onLoad({ filter: /.*/, namespace: 'node-stub' }, (args) => ({
        contents: nodeStubContents(args.path),
        loader: 'js',
      }));
    },
  };
}

// Empty module that throws if accessed (should never run in browser).
function nodeStubContents(importPath: string): string {
  return `
    // Stub for ${importPath} - this code should never run in browser
    export default new Proxy({}, {
      get(_, prop) {
        throw new Error(\`Cannot access \${String(prop)} from ${importPath} in browser\`);
      }
    });
    ${
    importPath === 'node:crypto'
      ? 'export const webcrypto = globalThis.crypto;'
      : ''
  }
  `;
}

/**
 * Maps esbuild's in-memory output to per-entry bundles plus loader assets.
 * Classification is by extension; anything else is a 'file'-loader asset.
 */
export function clientBuildOutputFromResult(
  buildResult: {
    outputFiles?: { path: string; text: string; contents: Uint8Array }[];
  },
): ClientBuildOutput {
  const bundles = {} as Record<string, BundleResult>;
  const assets = {} as Record<string, Uint8Array>;
  if (!buildResult.outputFiles) {
    throw new Error(
      'esbuild returned no output files. Ensure write: false is set.',
    );
  }
  for (const file of buildResult.outputFiles) {
    if (file.path.endsWith('.js')) {
      bundleFor(bundles, file.path).js = file.text;
    } else if (file.path.endsWith('.js.map')) {
      bundleFor(bundles, file.path).jsMap = file.text;
    } else if (file.path.endsWith('.css')) {
      bundleFor(bundles, file.path).css = file.text;
    } else if (file.path.endsWith('.css.map')) {
      bundleFor(bundles, file.path).cssMap = file.text;
    } else {
      assets[path.basename(file.path)] = file.contents;
    }
  }
  return { bundles, assets };
}

function bundleFor(
  bundles: Record<string, BundleResult>,
  filePath: string,
): BundleResult {
  const name = path.basename(filePath).split('.')[0] as string;
  let bundle = bundles[name];
  if (!bundle) {
    bundle = {};
    bundles[name] = bundle;
  }
  return bundle;
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

export interface ReBuildContext {
  rebuild(): Promise<ClientBuildOutput>;
  close(): void;
}

export function isReBuildContext(
  ctx: ReBuildContext | { context: unknown },
): ctx is ReBuildContext {
  return typeof (ctx as ReBuildContext).rebuild === 'function';
}

export async function createBuildContext(
  spec: ClientBundleSpec,
): Promise<ReBuildContext> {
  const esbuild = await getEsbuild();
  const ctx = await esbuild.context(await clientBuildOptions(spec));
  return {
    rebuild: async () => clientBuildOutputFromResult(await ctx.rebuild()),
    close: () => ctx.dispose(),
  };
}
