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
  readDir,
  readTextFile,
  writeTextFile,
} from '../base/json-log/json-log.ts';
import { templateTargetPath } from '../cli/template-manifest.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';

export type CliTemplateRuntime = 'deno' | 'node';

/** Deno info JSON shape for the fields used by these assertions. */
export interface DenoInfo {
  modules: Array<{
    specifier: string;
    npmPackage?: string;
    local?: string;
  }>;
  npmPackages: Record<string, { name: string; version: string }>;
}

/** Worker-boundary-safe recursive walk over template files. */
async function* walkFiles(dir: string): AsyncGenerator<string> {
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
): Promise<Map<string, string>> {
  const templateRoot = path.join(repoRoot, 'cli/templates');
  const files = new Map<string, string>();
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
  const start = result.indexOf('{');
  const end = result.lastIndexOf('}');
  assertTrue(
    start >= 0 && end > start,
    `deno info produced no JSON:\n${result}`,
  );
  return JSON.parse(result.slice(start, end + 1)) as DenoInfo;
}

/** Asserts a bare specifier resolved to the expected npm subpath. */
export function assertModuleSpecifier(
  info: DenoInfo,
  includes: string[],
): void {
  const found = info.modules.find((module) =>
    includes.every((part) => module.specifier.includes(part))
  );
  assertExists(found, `No resolved module matching ${includes.join(', ')}`);
}

/** Writes and runs a probe that proves imports resolve and export values. */
export async function assertImportsWork(
  projectDir: string,
  runtime: CliTemplateRuntime,
): Promise<void> {
  const probe = runtime === 'deno' ? 'import-probe.ts' : 'import-probe.mjs';
  const probePath = path.join(projectDir, probe);
  await writeTextFile(
    probePath,
    [
      "import { createRoot } from 'react-dom/client';",
      "import * as goatdb from '@goatdb/goatdb';",
      'console.log(JSON.stringify({',
      '  createRoot: typeof createRoot,',
      '  goatdbExports: Object.keys(goatdb).length,',
      '}));',
    ].join('\n'),
  );
  const { result, exitCode } = runtime === 'deno'
    ? await cli('deno', 'run', '-A', probe, {
      cwd: projectDir,
      timeout: 120_000,
    })
    : await cli('node', probe, { cwd: projectDir, timeout: 120_000 });
  assertEquals(exitCode, 0, `import probe failed:\n${result}`);
  const line = result.trim().split('\n').at(-1)!;
  const parsed = JSON.parse(line) as {
    createRoot: string;
    goatdbExports: number;
  };
  assertEquals(
    parsed.createRoot,
    'function',
    'react-dom/client export missing',
  );
  assertTrue(parsed.goatdbExports > 0, 'GoatDB exports missing');
}

/** Reads a JSON file and returns undefined when it does not exist. */
export async function readJson<T>(file: string): Promise<T | undefined> {
  const text = await readTextFile(file);
  return text === undefined ? undefined : JSON.parse(text) as T;
}
