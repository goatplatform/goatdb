import * as path from '@std/path';
import * as esbuild from 'esbuild';
import { denoPlugin } from '@deno/esbuild-plugin';
import { getRepositoryPath } from '../base/git-root.ts';
import { normalizeBuildEntryPath } from '../build.ts';
import type { ReadonlyJSONObject } from '../base/interfaces.ts';
import { type StaticAssets, staticAssetsToJS } from './system-assets.ts';

/** Builds the system-assets map from current worker sources without writing. */
export async function buildSysAssetMap(): Promise<ReadonlyJSONObject> {
  const repoPath = await getRepositoryPath();
  const result = await esbuild.build({
    entryPoints: [
      {
        in: normalizeBuildEntryPath(
          path.join(repoPath, 'base', 'json-log', 'json-log-worker-entry.ts'),
        ),
        out: 'json-log-worker',
      },
    ],
    // noTranspile: let esbuild transpile so the final bundle map is composed
    // from file-relative sources instead of the loader's repo-relative maps.
    plugins: [denoPlugin({ noTranspile: true })],
    bundle: true,
    write: false,
    sourcemap: 'external',
    outdir: path.join(repoPath, 'system-assets'),
    // minify: true,
    logOverride: {
      'empty-import-meta': 'silent',
    },
  });

  const assets: StaticAssets = {};
  for (const f of result.outputFiles) {
    assets['/system-assets/' + path.basename(f.path)] = {
      data: f.contents,
      contentType: f.path.endsWith('.map')
        ? 'application/json'
        : 'text/javascript',
    };
  }
  for (
    const [name, file, type] of [
      ['bloom_filter.js', 'bloom_filter.js', 'text/javascript'],
      ['bloom-filter.wasm', 'bloom_filter.wasm', 'application/wasm'],
      ['bloom_filter.wasm.map', 'bloom_filter.wasm.map', 'application/json'],
    ] as const
  ) {
    assets['/system-assets/' + name] = {
      data: await Deno.readFile(
        path.join(repoPath, 'system-assets', file),
      ),
      contentType: type,
    };
  }
  return staticAssetsToJS(assets);
}

/** Rebuilds system-assets/assets.json from current worker sources. */
export async function buildSysAssets(): Promise<void> {
  const repoPath = await getRepositoryPath();
  await Deno.writeTextFile(
    path.join(repoPath, 'system-assets', 'assets.json'),
    JSON.stringify(await buildSysAssetMap()),
  );
}

if (import.meta.main) {
  await buildSysAssets();
}
