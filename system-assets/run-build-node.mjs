// Node entry for the system-assets build.
// Bundles build-sys-assets.ts with esbuild (the same bundler the build uses)
// then executes it, so the build does not depend on Node's TS type-stripping
// (which chokes on type-only named imports across the dependency graph).
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const result = await esbuild.build({
  entryPoints: [join(here, 'build-sys-assets.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['esbuild'],
  logOverride: { 'empty-import-meta': 'silent' },
});
const bundle = result.outputFiles[0];
// Temp dir lives inside the repo so node resolves esbuild from node_modules.
const dir = await mkdtemp(join(here, '.goatdb-build-'));
const outFile = join(dir, 'build.mjs');
try {
  await writeFile(outFile, bundle.contents);
  await promisify(execFile)('node', [outFile], { stdio: 'inherit' });
} finally {
  await rm(dir, { recursive: true, force: true });
}
