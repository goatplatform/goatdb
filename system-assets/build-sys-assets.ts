import * as path from '@std/path';
import * as esbuild from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    // platform: 'node' keeps node: builtins (worker_threads, crypto, fs)
    // external so the bundles runtime-guarded Node branches stay intact.
    platform: 'node',
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
      data: await readFile(
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
  await writeFile(
    path.join(repoPath, 'system-assets', 'assets.json'),
    JSON.stringify(await buildSysAssetMap()),
  );
}

// Entry guard that works in both Node (argv[1]) and Deno (import.meta.main).
const isMain =
  (import.meta as { main?: boolean }).main === true ||
  (typeof process !== 'undefined' && process.argv[1] !== undefined &&
    resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]));
if (isMain) {
  await buildSysAssets();
}
