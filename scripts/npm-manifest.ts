/**
 * Production manifest transform for the npm package.
 *
 * WHY: package.json exports point at TypeScript sources for local development,
 * while npm ships only `dist`. Publication must therefore rewrite version and
 * exports. The publish workflow and the package contract test both call this
 * module, so a drift between the dev manifest and the shipped one fails the
 * gate instead of the release.
 *
 * Single source of truth: package.json export values name the public entry
 * sources. Dist targets are a pure function of those values (`./a/b.ts` ->
 * `./dist/a/b.js`), and scripts/check-npm-entrypoints.ts pins tsup entry names
 * to the same source paths. A new public entry therefore needs no edit here.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from '../base/path.ts';

export interface NpmExportEntry {
  import: string;
  types: string;
}

export interface NpmManifest {
  version?: string;
  exports?: Record<string, string | NpmExportEntry>;
  [key: string]: unknown;
}

/** Manifest returned by {@link productionManifest}; every export is built. */
export interface ProductionManifest extends NpmManifest {
  exports: Record<string, NpmExportEntry>;
}

const kSourcePrefix = './';
const kSourceExt = '.ts';
const kDistPrefix = './dist/';

/** Maps a `./*.ts` export source to its built counterpart (`./dist/*.<ext>`). */
function distTarget(subpath: string, source: unknown, ext: string): string {
  if (
    typeof source !== 'string' ||
    !source.startsWith(kSourcePrefix) ||
    !source.endsWith(kSourceExt) ||
    source.length === kSourcePrefix.length + kSourceExt.length
  ) {
    throw new Error(
      `npm export "${subpath}" must be a './*.ts' source path, got ` +
        JSON.stringify(source),
    );
  }
  return kDistPrefix + source.slice(kSourcePrefix.length, -kSourceExt.length) +
    ext;
}

function distExports(manifest: NpmManifest): Record<string, NpmExportEntry> {
  const sources = manifest.exports;
  if (sources === undefined || Object.keys(sources).length === 0) {
    throw new Error('npm exports missing from package.json');
  }
  const exports: Record<string, NpmExportEntry> = {};
  for (const [subpath, source] of Object.entries(sources)) {
    exports[subpath] = {
      import: distTarget(subpath, source, '.js'),
      types: distTarget(subpath, source, '.d.ts'),
    };
  }
  return exports;
}

/** Returns the manifest npm must publish. Does not mutate the input. */
export function productionManifest(
  manifest: NpmManifest,
  version: string,
): ProductionManifest {
  return { ...manifest, version, exports: distExports(manifest) };
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** Rewrites `<root>/package.json` in place for npm publication. */
export async function writeNpmManifest(root: string): Promise<void> {
  const manifest = await readJson<NpmManifest>(resolve(root, 'package.json'));
  const config = await readJson<{ version: string }>(
    resolve(root, 'deno.json'),
  );
  const prepared = productionManifest(manifest, config.version);
  await writeFile(
    resolve(root, 'package.json'),
    JSON.stringify(prepared, null, 2) + '\n',
  );
}

// Guard: the test runner imports this module, so only Deno entry execution may
// touch package.json. `typeof Deno` also blocks Node bundles that define
// import.meta.main for their own entry module.
if (typeof Deno !== 'undefined' && import.meta.main) {
  await writeNpmManifest(Deno.args[0] ?? '.');
}
