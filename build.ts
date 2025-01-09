import * as esbuild from 'npm:esbuild@0.20.2';
import { denoPlugins } from 'jsr:@luca/esbuild-deno-loader';
import * as path from 'std/path';
import { assert } from './base/error.ts';
import { getRepositoryPath } from './base/development.ts';
import {
  kEntryPointsNames,
  EntryPointName,
  EntryPointIndex,
} from './net/server/static-assets.ts';

async function getEntryPoints(): Promise<{ in: string; out: string }[]> {
  const repoPath = await getRepositoryPath();
  return kEntryPointsNames.map((name) => {
    return {
      in: path.join(repoPath, name, EntryPointIndex[name]),
      out: name,
    };
  });
}

export const ENTRY_POINTS = await getEntryPoints();

export interface BundleResult {
  source: string;
  map: string;
}

export async function bundle(): Promise<Record<EntryPointName, BundleResult>> {
  const result = await esbuild.build({
    entryPoints: ENTRY_POINTS,
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
): Record<EntryPointName, BundleResult> {
  const result = {} as Record<EntryPointName, BundleResult>;
  for (const file of buildResult.outputFiles!) {
    const entryPoint = path.basename(file.path).split('.')[0] as EntryPointName;
    assert(kEntryPointsNames.includes(entryPoint)); // Sanity check
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
  rebuild(): Promise<Record<EntryPointName, BundleResult>>;
  close(): void;
}

export function isReBuildContext(
  ctx: ReBuildContext | typeof esbuild,
): ctx is ReBuildContext {
  return typeof (ctx as ReBuildContext).rebuild === 'function';
}

export async function createBuildContext(): Promise<ReBuildContext> {
  const ctx = await esbuild.context({
    entryPoints: ENTRY_POINTS,
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
