import * as path from '@std/path';
import * as esbuild from 'esbuild';
import { denoPlugins } from '@luca/esbuild-deno-loader';
import { getRepositoryPath } from '../base/development.ts';

export async function buildSysAssets(): Promise<void> {
  const repoPath = await getRepositoryPath();
  const outputDir = path.join(repoPath, 'assets', '__system_assets');
  const result = await esbuild.build({
    entryPoints: [
      {
        in: path.join(repoPath, '__file_worker', 'json-log.worker.ts'),
        out: '__file_worker',
      },
    ],
    plugins: [
      ...denoPlugins({
        configPath: `${await getRepositoryPath()}/deno.json`,
      }),
    ],
    bundle: true,
    write: false,
    sourcemap: 'external',
    outdir: outputDir,
    minify: true,
  });

  try {
    await Deno.remove(outputDir, { recursive: true });
  } catch (_: unknown) {
    // Pass
  }
  await Deno.mkdir(outputDir, { recursive: true });

  for (const f of result.outputFiles) {
    await Deno.writeFile(f.path, f.contents);
  }
}

buildSysAssets();
