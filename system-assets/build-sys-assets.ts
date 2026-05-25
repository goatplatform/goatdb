import * as path from '@std/path';
import { getRepositoryPath } from '../base/git-root.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { normalizeBuildEntryPath } from '../build.ts';
import { type StaticAssets, staticAssetsToJS } from './system-assets.ts';

// Lazy-loaded build-time dependencies to avoid breaking Node.js bundles.
// These are Deno/JSR-specific and cannot be resolved by Node.js at runtime.
// deno-lint-ignore no-explicit-any
let esbuildModule: any;
// deno-lint-ignore no-explicit-any
let denoPluginModule: any;

async function getEsbuild(): Promise<typeof import('esbuild')> {
  if (!esbuildModule) {
    esbuildModule = await import('esbuild');
  }
  return esbuildModule as typeof import('esbuild');
}

async function getDenoPlugin(): Promise<
  typeof import('@deno/esbuild-plugin').denoPlugin
> {
  if (!denoPluginModule) {
    denoPluginModule = await import('@deno/esbuild-plugin');
  }
  return denoPluginModule.denoPlugin;
}

export async function buildSysAssetsBundle(): Promise<StaticAssets> {
  if (getRuntime().id !== 'deno') {
    throw new Error(
      'buildSysAssetsBundle() requires Deno runtime. ' +
        'It uses @deno/esbuild-plugin which is Deno-only.',
    );
  }
  const esbuild = await getEsbuild();
  const denoPlugin = await getDenoPlugin();
  const repoPath = await getRepositoryPath();
  const outputDir = path.join(repoPath, 'system-assets');
  const result = await esbuild.build({
    entryPoints: [
      {
        // path.join(repoPath, ...) produces an already-absolute path; no resolve step needed
        in: normalizeBuildEntryPath(
          path.join(repoPath, 'base', 'json-log', 'json-log-worker-entry.ts'),
        ),
        out: 'json-log-worker',
      },
    ],
    // Let esbuild transpile TypeScript so the final bundle map is composed from
    // file-relative sources instead of the loader's repo-relative inline maps.
    plugins: [denoPlugin({ noTranspile: true })],
    bundle: true,
    write: false,
    sourcemap: 'external',
    outdir: outputDir,
    // minify: true,
    logOverride: {
      'empty-import-meta': 'silent',
    },
  });

  await Deno.mkdir(outputDir, { recursive: true });
  const assets: StaticAssets = {};
  for (const f of result.outputFiles) {
    assets['/system-assets/' + path.basename(f.path)] = {
      data: f.contents,
      contentType: f.path.endsWith('.map')
        ? 'application/json'
        : 'text/javascript',
    };
  }
  return assets;
}

export async function buildSysAssetsJSON(): Promise<string> {
  const assets = await buildSysAssetsBundle();
  return JSON.stringify(staticAssetsToJS(assets));
}

export async function buildSysAssets(): Promise<void> {
  const repoPath = await getRepositoryPath();
  const outputDir = path.join(repoPath, 'system-assets');
  await Deno.writeTextFile(
    path.join(outputDir, 'assets.json'),
    await buildSysAssetsJSON(),
  );
}

if (import.meta.main) {
  await buildSysAssets();
}
