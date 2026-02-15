// Note: We use ../base/path.ts instead of @std/path to avoid JSR dependencies
// that would break when this module is transitively bundled into SEA binaries.
import * as path from './base/path.ts';
import { APP_ENTRY_POINT } from './net/server/static-assets.ts';
// IMPORTANT: These MUST remain `import type` — runtime imports would break
// Node.js SEA binaries since esbuild/deno-loader are Deno-specific packages.
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
    const entryPoint = path.basename(file.path).split('.')[0] as string;
    let bundleResult: BundleResult | undefined = result[entryPoint];
    if (!bundleResult) {
      bundleResult = {} as BundleResult;
      result[entryPoint] = bundleResult;
    }
    if (file.path.endsWith('.js')) {
      bundleResult.source = file.text;
    } else if (file.path.endsWith('.js.map')) {
      bundleResult.map = file.text;
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

export async function createBuildContext(
  entryPoints: { in: string; out: string }[],
): Promise<ReBuildContext> {
  const esbuild = await getEsbuild();
  const denoPlugins = await getDenoPlugins();
  const ctx = await esbuild.context({
    entryPoints,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: [...denoPlugins()] as any,
    bundle: true,
    write: false,
    sourcemap: 'linked',
    outdir: 'output',
    logOverride: {
      'empty-import-meta': 'silent',
    },
  });
  return {
    rebuild: async () => bundleResultFromBuildResult(await ctx.rebuild()),
    close: () => ctx.dispose(),
  };
}
