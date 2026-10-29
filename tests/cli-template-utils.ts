/**
 * Shared assertions for CLI scaffold contracts.
 *
 * WHY: Scaffold tests must assert the generated project, not the commands that
 * produced it. Exit codes are preconditions; files, resolved modules, and
 * runtime behavior are the effects under test.
 */

import * as path from '../base/path.ts';
import { cli } from '../base/development.ts';
import {
  getEsbuild,
  stopBackgroundCompiler,
} from '../base/build-dependencies.ts';
import {
  readDir,
  readTextFile,
  writeTextFile,
} from '../base/json-log/json-log.ts';
import { templateTargetPath } from '../cli/template-manifest.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';

export type CliTemplateRuntime = 'deno' | 'node';

import { type DenoInfo, parseDenoInfo } from './deno-info.ts';
export {
  type DenoInfo,
  denoInfoProjectRoot,
  parseDenoInfo,
} from './deno-info.ts';

/** Recursive walk over template files. */
async function* walkFiles(
  dir: path.PosixPath,
): AsyncGenerator<path.PosixPath> {
  for (const entry of await readDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(full);
    } else if (entry.isFile) {
      yield full;
    }
  }
}

/**
 * Maps generated project paths to template source files for one runtime.
 * Skipped config files are patched by bootstrap, so they are asserted
 * structurally by their own tests.
 */
async function templateFiles(
  runtime: CliTemplateRuntime,
  repoRoot: string,
): Promise<Map<string, path.PosixPath>> {
  const templateRoot = path.join(repoRoot, 'cli/templates');
  const files = new Map<string, path.PosixPath>();
  for await (const source of walkFiles(templateRoot)) {
    const relative = source.slice(templateRoot.length + 1);
    if (
      !relative.startsWith('shared/') &&
      !relative.startsWith(`${runtime}/`)
    ) {
      continue;
    }
    const target = templateTargetPath(relative, runtime);
    const existing = files.get(target);
    if (existing !== undefined) {
      throw new Error(
        `Template collision for ${target}: ${existing} and ${source}`,
      );
    }
    files.set(target, source);
  }
  return files;
}

/** Asserts every static template landed with identical bytes. */
export async function assertScaffoldTemplates(
  targetDir: string,
  runtime: CliTemplateRuntime,
  repoRoot: string,
): Promise<void> {
  const files = await templateFiles(runtime, repoRoot);
  assertTrue(files.size > 0, 'No template files found');
  for (const [target, source] of files) {
    if (target === 'deno.json' || target === 'package.json') continue;
    const expected = await readTextFile(source);
    assertExists(expected, `Missing template source: ${source}`);
    const actual = await readTextFile(path.join(targetDir, target));
    assertExists(actual, `Missing generated file: ${target}`);
    assertEquals(actual, expected, `Template content drift: ${target}`);
  }
}

/** Lists every template path relative to cli/templates. */
export async function allTemplateRelativePaths(
  repoRoot: string,
): Promise<string[]> {
  const root = path.join(repoRoot, 'cli/templates');
  const paths: string[] = [];
  for await (const source of walkFiles(root)) {
    paths.push(source.slice(root.length + 1));
  }
  return paths.sort();
}

/** Asserts a copied template tree matches cli/templates byte-for-byte. */
export async function assertTemplateTree(
  targetRoot: string,
  repoRoot: string,
): Promise<void> {
  const sourceRoot = path.join(repoRoot, 'cli/templates');
  const paths = await allTemplateRelativePaths(repoRoot);
  assertTrue(paths.length > 0, 'No template files found');
  for (const relative of paths) {
    const expected = await readTextFile(path.join(sourceRoot, relative));
    const actual = await readTextFile(path.join(targetRoot, relative));
    assertExists(expected, `Missing template source: ${relative}`);
    assertExists(actual, `Missing copied template: ${relative}`);
    assertEquals(actual, expected, `Copied template drift: ${relative}`);
  }
}

/**
 * Builds and runs a probe that imports the scaffold's public modules.
 *
 * WHY: A resolvable graph can still throw on import (missing export or split
 * React runtime). Node cannot load the checkout's .ts exports directly, so the
 * probe is bundled exactly as a Node app would be before it runs.
 */
export async function assertImportsWork(
  projectDir: path.PosixPath,
  runtime: CliTemplateRuntime,
): Promise<void> {
  const sourcePath = path.join(projectDir, 'import-probe.ts');
  const probeName = runtime === 'deno' ? 'import-probe.ts' : 'import-probe.mjs';
  const probePath = path.join(projectDir, probeName);
  await writeTextFile(
    sourcePath,
    [
      "import { createRoot } from 'react-dom/client';",
      "import { DataRegistry, GoatDB } from '@goatdb/goatdb';",
      "import { useDBReady } from '@goatdb/goatdb/react';",
      'console.log(JSON.stringify({',
      '  createRoot: typeof createRoot,',
      '  DataRegistry: typeof DataRegistry,',
      '  GoatDB: typeof GoatDB,',
      '  useDBReady: typeof useDBReady,',
      '}));',
    ].join('\n'),
  );
  if (runtime === 'node') {
    const esbuild = await getEsbuild();
    try {
      await esbuild.build({
        entryPoints: [sourcePath],
        outfile: probePath,
        bundle: true,
        platform: 'node',
        format: 'esm',
        // Node 24 defines import.meta.main; the bundled probe is the entry, so
        // without this the library's CLI branch runs instead of the probe.
        define: { 'import.meta.main': 'false' },
      });
    } finally {
      await stopBackgroundCompiler();
    }
  }
  const { result, exitCode } = runtime === 'deno'
    ? await cli('deno', 'run', '-A', probeName, {
      cwd: projectDir,
      timeout: 120_000,
    })
    : await cli('node', probeName, { cwd: projectDir, timeout: 120_000 });
  assertEquals(exitCode, 0, `import probe failed:\n${result}`);
  const parsed = JSON.parse(result.trim().split('\n').at(-1)!) as Record<
    string,
    string
  >;
  for (const name of Object.keys(parsed)) {
    assertEquals(parsed[name], 'function', `${name} export missing`);
  }
}

/** Parses `deno info --json` for a generated entry point. */
export async function denoInfo(
  testDir: string,
  entry: string,
  timeout = 120_000,
): Promise<DenoInfo> {
  const { result, exitCode } = await cli(
    'deno',
    'info',
    '--json',
    entry,
    { cwd: testDir, timeout },
  );
  assertEquals(exitCode, 0, `deno info failed:\n${result}`);
  return parseDenoInfo(result);
}

/** Reads a JSON file and returns undefined when it does not exist. */
export async function readJson<T>(
  file: path.PosixPath,
): Promise<T | undefined> {
  const text = await readTextFile(file);
  return text === undefined ? undefined : JSON.parse(text) as T;
}
