import type { denoPlugin } from '@deno/esbuild-plugin';
import { lazyModule, moduleExport } from './lazy-import.ts';

const kEsbuild = lazyModule<typeof import('esbuild')>('esbuild');
const kDenoPlugin = lazyModule<typeof import('@deno/esbuild-plugin')>(
  '@deno/esbuild-plugin',
);

export async function getEsbuild(): Promise<typeof import('esbuild')> {
  return await kEsbuild.get();
}

export async function getDenoPlugin(): Promise<typeof denoPlugin> {
  return moduleExport<typeof denoPlugin>(
    await kDenoPlugin.get() as Record<string, unknown>,
    'denoPlugin',
    '@deno/esbuild-plugin',
  );
}

export async function stopBackgroundCompiler(): Promise<void> {
  await kEsbuild.loaded()?.stop();
  kEsbuild.clear();
  kDenoPlugin.clear();
}
