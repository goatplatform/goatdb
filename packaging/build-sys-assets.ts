import * as path from '@std/path';
import * as esbuild from 'esbuild';
import { denoPlugins } from '@luca/esbuild-deno-loader';
import { getRepositoryPath } from '../base/development.ts';
import type { StaticAssets } from '../net/server/static-assets.ts';
import { staticAssetsToJS } from '../net/server/static-assets.ts';

export async function buildSysAssets(): Promise<void> {
  const repoPath = await getRepositoryPath();
  const outputDir = path.join(repoPath, 'system-assets');
  const result = await esbuild.build({
    entryPoints: [
      {
        in: path.join(repoPath, 'base', 'json-log', 'json-log-worker.ts'),
        out: 'json-log-worker',
      },
    ],
    plugins: [...denoPlugins()],
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
  assets['/system-assets/bloom_filter.js'] = {
    data: await Deno.readFile(
      path.join(repoPath, 'system-assets', 'bloom_filter.js'),
    ),
    contentType: 'text/javascript',
  };
  assets['/system-assets/bloom-filter.wasm'] = {
    data: await Deno.readFile(
      path.join(repoPath, 'system-assets', 'bloom_filter.wasm'),
    ),
    contentType: 'application/wasm',
  };
  assets['/system-assets/bloom_filter.wasm.map'] = {
    data: await Deno.readFile(
      path.join(repoPath, 'system-assets', 'bloom_filter.wasm.map'),
    ),
    contentType: 'application/json',
  };
  await Deno.writeTextFile(
    path.join(outputDir, 'assets.json'),
    JSON.stringify(staticAssetsToJS(assets)),
  );
}

buildSysAssets();
