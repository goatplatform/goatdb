// Note: We use ../base/path.ts instead of @std/path to avoid JSR dependencies
// that would break when this module is transitively bundled into SEA binaries.
import { APP_ENTRY_POINT } from './base/app-entry-point.ts';
import * as path from './base/path.ts';
// IMPORTANT: These MUST remain `import type` — runtime imports would break
// Node.js SEA binaries since esbuild/deno-loader are Deno-specific packages.
import type { BuildOptions, Loader, Plugin } from 'esbuild';
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

/** Single source of truth for client (browser) esbuild options. */
export async function clientBuildOptions(
  spec: ClientBundleSpec,
): Promise<BuildOptions> {
  const plugins = await clientPlugins(spec.runtime, spec.userPlugins ?? []);
  return {
    entryPoints: spec.entryPoints,
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
): Promise<Plugin[]> {
  assertValidPlugins(userPlugins, 'AppConfig.esbuildPlugins');
  const adapterPlugin = adapterStubPlugin(['deno', 'node']);
  if (runtime === 'node') {
    return [adapterPlugin, nodeStubPlugin(), ...userPlugins];
  }
  const builtins = (await getDenoPlugins())() as unknown as Plugin[];
  assertDenoPluginOrder(builtins);
  return [
    adapterPlugin,
    builtins[0],
    ...userPlugins,
    browserAssetPlugin(),
    ...builtins.slice(1),
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

function assertDenoPluginOrder(plugins: Plugin[]): void {
  assertValidPlugins(plugins, '@luca/esbuild-deno-loader');
  if (
    plugins[0]?.name !== 'deno-resolver' ||
    plugins[1]?.name !== 'deno-loader'
  ) {
    throw new Error(
      'Unsupported @luca/esbuild-deno-loader plugin order: expected deno-resolver then deno-loader.',
    );
  }
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

export async function stopBackgroundCompiler(): Promise<void> {
  if (esbuildModule) {
    await esbuildModule.stop();
    esbuildModule = undefined;
    denoPluginsModule = undefined;
  }
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
