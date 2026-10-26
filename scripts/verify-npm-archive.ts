/** Verifies the npm archive contains every file the package contract promises.
 * CI runs this after `build:npm`, so a broken archive fails the PR, not the
 * release. */

import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from '../base/path.ts';
import {
  type NpmManifest,
  productionManifest,
  readJson,
} from './npm-manifest.ts';

interface PackEntry {
  files: Array<{ path: string }>;
}

function normalize(target: string): string {
  return target.replace(/^\.\//, '');
}

async function requiredShipPaths(root: string): Promise<string[]> {
  const checkout = await readJson<NpmManifest>(resolve(root, 'package.json'));
  const config = await readJson<{ version: string }>(
    resolve(root, 'deno.json'),
  );
  const manifest = productionManifest(checkout, config.version);
  const required = new Set(['README.md', 'LICENSE']);
  for (const entry of Object.values(manifest.exports)) {
    required.add(normalize(entry.import));
    required.add(normalize(entry.types));
  }
  const bin = manifest.bin as Record<string, string> | undefined;
  if (bin?.goatdb !== undefined) {
    required.add(normalize(bin.goatdb));
  }
  const templateRoot = resolve(root, 'cli/templates');
  for (
    const entry of await readdir(templateRoot, {
      recursive: true,
      withFileTypes: true,
    })
  ) {
    if (!entry.isFile()) continue;
    const file = resolve(entry.parentPath, entry.name);
    required.add(`dist/cli/templates/${file.slice(templateRoot.length + 1)}`);
  }
  return [...required].sort();
}

function packFiles(root: string): Set<string> {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`npm pack failed:\n${result.stderr || result.stdout}`);
  }
  const start = result.stdout.indexOf('[');
  const end = result.stdout.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new Error(`npm pack produced no JSON:\n${result.stdout}`);
  }
  const entries = JSON.parse(
    result.stdout.slice(start, end + 1),
  ) as PackEntry[];
  if (entries.length !== 1) {
    throw new Error(`Expected one package entry, got ${entries.length}`);
  }
  return new Set(entries[0].files.map((file) => file.path));
}
const root = resolve(Deno.args[0] ?? '.');
const shipped = packFiles(root);
const missing = (await requiredShipPaths(root)).filter((file) =>
  !shipped.has(file)
);
if (missing.length > 0) {
  throw new Error(`npm archive is missing:\n${missing.join('\n')}`);
}
console.log(`npm archive contains all ${shipped.size} required files`);
