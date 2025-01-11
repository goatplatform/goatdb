import * as esbuild from 'npm:esbuild@0.20.2';
import { denoPlugins } from 'jsr:@luca/esbuild-deno-loader';
import * as path from '@std/path';
import { getRepositoryPath } from './base/development.ts';
import { APP_ENTRY_POINT } from './net/server/static-assets.ts';

export interface BundleResult {
  source: string;
  map: string;
}

export async function bundle(
  sourcePath: string,
): Promise<Record<string, BundleResult>> {
  const result = await esbuild.build({
    entryPoints: [
      {
        in: sourcePath,
        out: APP_ENTRY_POINT,
      },
    ],
    plugins: [
      ...denoPlugins({
        configPath: `${await getRepositoryPath()}/deno.json`,
      }),
    ],
    bundle: true,
    write: false,
    sourcemap: 'linked',
  });
  return bundleResultFromBuildResult(result);
}

export function bundleResultFromBuildResult(
  buildResult: esbuild.BuildResult,
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

export function stopBackgroundCompiler(): void {
  esbuild.stop();
}

export interface ReBuildContext {
  rebuild(): Promise<Record<string, BundleResult>>;
  close(): void;
}

export function isReBuildContext(
  ctx: ReBuildContext | typeof esbuild,
): ctx is ReBuildContext {
  return typeof (ctx as ReBuildContext).rebuild === 'function';
}

export async function createBuildContext(
  entryPoints: { in: string; out: string }[],
): Promise<ReBuildContext> {
  const ctx = await esbuild.context({
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
  });
  return {
    rebuild: async () => bundleResultFromBuildResult(await ctx.rebuild()),
    close: () => ctx.dispose(),
  };
}
