import * as path from '@std/path';
import { APP_ENTRY_POINT } from './net/server/static-assets.ts';

// Lazy-loaded modules to avoid bundling build-time dependencies into runtime code.
// These packages (esbuild, @luca/esbuild-deno-loader) are Deno/JSR-specific and
// cannot be resolved by Node.js at runtime.
let esbuildModule: typeof import('esbuild') | undefined;
let denoPluginsModule: typeof import('@luca/esbuild-deno-loader') | undefined;

async function getEsbuild() {
  if (!esbuildModule) {
    esbuildModule = await import('esbuild');
  }
  return esbuildModule;
}

async function getDenoPlugins() {
  if (!denoPluginsModule) {
    denoPluginsModule = await import('@luca/esbuild-deno-loader');
  }
  return denoPluginsModule.denoPlugins;
}

export interface BundleResult {
  source: string;
  map: string;
}

export async function bundle(
  sourcePath: string,
): Promise<Record<string, BundleResult>> {
  const esbuild = await getEsbuild();
  const denoPlugins = await getDenoPlugins();
  const result = await esbuild.build({
    entryPoints: [
      {
        in: sourcePath,
        out: APP_ENTRY_POINT,
      },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: [...denoPlugins()] as any,
    bundle: true,
    write: false,
    sourcemap: 'linked',
  });
  return bundleResultFromBuildResult(result);
}

export function bundleResultFromBuildResult(
  buildResult: { outputFiles?: { path: string; text: string }[] },
): Record<string, BundleResult> {
  const result = {} as Record<string, BundleResult>;
  for (const file of buildResult.outputFiles!) {
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

export async function stopBackgroundCompiler(): Promise<void> {
  const esbuild = await getEsbuild();
  esbuild.stop();
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
