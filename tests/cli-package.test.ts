/**
 * Built artifact contract for the CLI.
 *
 * WHY: Source-tree tests cannot see missing dist files, a wrong shipped
 * manifest, or an entry point that resolves but cannot load. This suite builds
 * the current checkout and loads the build outputs in place.
 *
 * It must not install the package or resolve it from a registry. Registry
 * checks validate the publication process; they do not validate this checkout.
 *
 * Gated because it runs the production build. Run with:
 *   GOATDB_TEST_PACKAGE=1 deno task test:package
 */

import { TEST, type TestSuite } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { isBrowser, isNode } from '../base/common.ts';
import { getEnvVar, isWindows } from '../base/os.ts';
import { cli } from '../base/development.ts';
import { getRuntime } from '../base/runtime/index.ts';
import {
  mkdir,
  readTextFile,
  writeTextFile,
} from '../base/json-log/json-log.ts';
import { chmod } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  type NpmManifest,
  type ProductionManifest,
  productionManifest,
} from '../scripts/npm-manifest.ts';
import {
  assertScaffoldTemplates,
  assertTemplateTree,
  readJson,
} from './cli-template-utils.ts';

/**
 * Public API contract: each published subpath must expose its documented
 * symbol. A target that exists but exports the wrong surface must fail.
 */
const kPublicExports: Record<string, string> = {
  '.': 'GoatDB',
  './react': 'useDB',
  './server': 'Server',
  './server/build': 'compile',
  './link': 'linkGoatDB',
};

function packageTestsEnabled(): boolean {
  return getEnvVar('GOATDB_TEST_PACKAGE') === '1';
}

/** File-only existence probe; every caller checks a file, never a directory. */
async function fileExists(file: path.PosixPath): Promise<boolean> {
  return (await readTextFile(file)) !== undefined;
}

function assertCliFailure(output: string): void {
  assertTrue(
    output.includes('Error during project initialization:'),
    `Missing CLI failure prefix:\n${output}`,
  );
  assertTrue(
    output.includes('EJSONPARSE') && output.includes('package.json'),
    `Missing package-manager diagnostic:\n${output}`,
  );
}

async function readVersion(repoRoot: string): Promise<string> {
  const config = await readJson<{ version: string }>(
    path.join(repoRoot, 'deno.json'),
  );
  assertExists(config?.version, 'deno.json version missing');
  return config.version;
}

function binTarget(manifest: NpmManifest): string {
  const bin = manifest.bin as Record<string, string> | undefined;
  const target = bin?.goatdb;
  assertExists(target, 'npm bin target missing');
  return target;
}

/** Asserts every shipped target exists in the current build. */
async function assertManifestTargets(
  repoRoot: string,
  manifest: ProductionManifest,
): Promise<void> {
  const entries = Object.entries(manifest.exports);
  for (const [subpath, entry] of entries) {
    for (const target of [entry.import, entry.types]) {
      assertTrue(
        await fileExists(path.join(repoRoot, target)),
        `Missing build target for ${subpath}: ${target}`,
      );
    }
  }
  for (const subpath of Object.keys(kPublicExports)) {
    assertTrue(
      entries.some(([entrySubpath]) => entrySubpath === subpath),
      `Missing public export: ${subpath}`,
    );
  }
  const target = binTarget(manifest);
  assertTrue(
    await fileExists(path.join(repoRoot, target)),
    `Missing npm bin target: ${target}`,
  );
}

/** Loads every public entry and proves its documented symbol is present. */
async function assertExportsLoad(
  repoRoot: string,
  manifest: ProductionManifest,
): Promise<void> {
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    const module = await import(
      pathToFileURL(path.join(repoRoot, entry.import)).href
    );
    assertTrue(
      Object.keys(module).length > 0,
      `Entry point exported nothing: ${subpath}`,
    );
    const expected = kPublicExports[subpath];
    if (expected !== undefined) {
      assertTrue(
        expected in module,
        `Entry point must export ${expected}: ${subpath}`,
      );
    }
  }
}

function declaredPackages(manifest: NpmManifest): Set<string> {
  const declared = new Set<string>();
  for (
    const field of [
      'dependencies',
      'peerDependencies',
      'optionalDependencies',
    ]
  ) {
    const deps = manifest[field];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const name of Object.keys(deps)) declared.add(name);
  }
  return declared;
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

/** Import and re-export specifiers, including dynamic imports. */
const kImportSpecifier =
  /(?:^|\n)\s*(?:import|export)\s+[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

async function importSpecifiers(file: path.PosixPath): Promise<string[]> {
  const text = await readTextFile(file);
  assertExists(text, `Unable to read dist file: ${file}`);
  return [...text.matchAll(kImportSpecifier)].flatMap((match) =>
    match[1] ?? match[2] ?? match[3] ?? []
  );
}

/** Walks the dist graph so transitive bare imports are checked too. */
async function distBareImports(
  entryFiles: path.PosixPath[],
): Promise<Set<string>> {
  const visited = new Set<path.PosixPath>();
  const bare = new Set<string>();

  async function visit(file: path.PosixPath): Promise<void> {
    if (visited.has(file)) return;
    visited.add(file);
    for (const specifier of await importSpecifiers(file)) {
      if (specifier.startsWith('.')) {
        await visit(path.join(path.dirname(file), specifier));
      } else if (
        !specifier.startsWith('/') && !/^[a-z]+:/i.test(specifier)
      ) {
        const name = packageName(specifier);
        if (!builtinModules.includes(name)) bare.add(name);
      }
    }
  }

  for (const entry of entryFiles) await visit(entry);
  return bare;
}

async function assertDistImports(
  repoRoot: string,
  manifest: ProductionManifest,
): Promise<void> {
  const entries = Object.entries(manifest.exports).map(([, entry]) =>
    path.join(repoRoot, entry.import)
  );
  entries.push(path.join(repoRoot, binTarget(manifest)));
  const bare = await distBareImports(entries);
  assertTrue(bare.size > 0, 'No imports found in the dist entry points');
  const declared = declaredPackages(manifest);
  for (const name of bare) {
    assertTrue(
      declared.has(name),
      `Dist imports undeclared package: ${name}`,
    );
  }
}

/** Fake npm proves the bin reaches the install step without the registry. */
async function writeNpmShim(
  dir: path.PosixPath,
  marker: path.PosixPath,
): Promise<void> {
  await mkdir(dir);
  const shell = path.join(dir, 'npm');
  assertTrue(
    await writeTextFile(
      shell,
      `#!/bin/sh\nprintf ok > "$GOATDB_FAKE_NPM_MARKER"\nexit 0\n`,
    ),
    'Unable to write npm shim',
  );
  await chmod(shell, 0o755);
  assertTrue(
    await writeTextFile(
      path.join(dir, 'npm.cmd'),
      `@echo off\r\n> "%GOATDB_FAKE_NPM_MARKER%" echo ok\r\nexit /b 0\r\n`,
    ),
    'Unable to write npm.cmd shim',
  );
  assertTrue(await fileExists(marker) === false, 'Shim marker already exists');
}

/** Runs the real npm bin and proves it scaffolds from the shipped templates. */
async function assertDistBinInit(
  ctx: TestSuite,
  repoRoot: string,
  manifest: NpmManifest,
): Promise<void> {
  const targetDir = await ctx.tempDir('dist-bin-init');
  const shimDir = await ctx.tempDir('npm-shim');
  const marker = path.join(shimDir, 'invoked');
  await writeNpmShim(shimDir, marker);
  const separator = isWindows() ? ';' : ':';
  const result = await cli(
    'node',
    path.join(repoRoot, binTarget(manifest)),
    'init',
    targetDir,
    {
      cwd: repoRoot,
      env: {
        PATH: `${shimDir}${separator}${process.env.PATH ?? ''}`,
        GOATDB_FAKE_NPM_MARKER: marker,
      },
      timeout: 120_000,
    },
  );
  assertEquals(result.exitCode, 0, result.result);
  assertTrue(
    await fileExists(marker),
    `Bin did not invoke npm:\n${result.result}`,
  );
  await assertScaffoldTemplates(targetDir, 'node', repoRoot);
}

async function assertBuiltCli(
  repoRoot: string,
  manifest: NpmManifest,
): Promise<void> {
  const result = await cli(
    'node',
    path.join(repoRoot, binTarget(manifest)),
    '--help',
    { cwd: repoRoot, timeout: 120_000 },
  );
  assertEquals(result.exitCode, 0, result.result);
  assertTrue(
    result.result.includes('Commands:') &&
      result.result.includes('init [dir]'),
    `Unexpected help output:\n${result.result}`,
  );
}

async function assertCliFailureContract(
  ctx: TestSuite,
  repoRoot: string,
  manifest: NpmManifest,
): Promise<void> {
  const invalid = await ctx.tempDir('invalid-app');
  await writeTextFile(path.join(invalid, 'package.json'), '{ invalid json');
  const result = await cli(
    'node',
    path.join(repoRoot, binTarget(manifest)),
    'init',
    invalid,
    { cwd: repoRoot, timeout: 120_000 },
  );
  assertEquals(result.exitCode, 1, result.result);
  assertCliFailure(result.result);
}

export default function setupCliPackageTests() {
  TEST(
    'CLI-Package',
    'built artifact ships templates and loads every public entry point',
    async (ctx) => {
      if (isBrowser() || !isNode()) return;
      if (!packageTestsEnabled()) {
        console.log(
          'Skipping CLI-Package (set GOATDB_TEST_PACKAGE=1 to run)',
        );
        return;
      }
      const repoRoot = getRuntime().getCWD();
      const build = await cli('npm', 'run', 'build:npm', {
        cwd: repoRoot,
        timeout: 300_000,
      });
      assertEquals(build.exitCode, 0, build.result);
      await assertTemplateTree(
        path.join(repoRoot, 'dist/cli/templates'),
        repoRoot,
      );

      const checkout = await readJson<NpmManifest>(
        path.join(repoRoot, 'package.json'),
      );
      assertExists(checkout, 'Checkout package.json missing');
      const version = await readVersion(repoRoot);
      const manifest = productionManifest(checkout, version);

      await assertManifestTargets(repoRoot, manifest);
      await assertExportsLoad(repoRoot, manifest);
      await assertDistImports(repoRoot, manifest);
      await assertDistBinInit(ctx, repoRoot, manifest);
      await assertBuiltCli(repoRoot, manifest);
      await assertCliFailureContract(ctx, repoRoot, manifest);
    },
  );
}
