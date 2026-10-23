/**
 * npm package contract for the CLI.
 *
 * WHY: Source-tree tests cannot see missing templates, a wrong shipped
 * manifest, or an entry point that resolves but cannot load. This suite builds
 * the production tarball, installs it into a consumer outside the repo, then
 * imports the public entry points and asserts the generated effects.
 *
 * Gated because it performs registry installs. Run with:
 *   GOATDB_TEST_PACKAGE=1 deno task test:package
 */

import { TEST, type TestSuite } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { getEnvVar } from '../base/os.ts';
import { isBrowser, isNode } from '../base/common.ts';
import { cli } from '../base/development.ts';
import { getRuntime } from '../base/runtime/index.ts';
import {
  mkdir,
  readDir,
  readFile,
  readTextFile,
  writeFile,
  writeTextFile,
} from '../base/json-log/json-log.ts';
import {
  type NpmManifest,
  productionManifest,
} from '../scripts/npm-manifest.ts';
import {
  allTemplateRelativePaths,
  assertImportsWork,
  assertScaffoldTemplates,
  assertTemplateTree,
  readJson,
} from './cli-template-utils.ts';

const kPackageName = '@goatdb/goatdb';

/** Optional peers that public entry points import at module load. */
const kPeerDependencies = ['react@^19', 'nodemailer@^6'];

/**
 * Public API contract: each published subpath must expose its documented
 * symbol. Resolution plus a non-empty module also passes when a subpath points
 * at the wrong source, so the symbol is the only runtime proof of routing.
 */
const kPublicExports: Record<string, string> = {
  '.': 'GoatDB',
  './react': 'useDB',
  './server': 'Server',
  './server/build': 'compile',
  './link': 'linkGoatDB',
};

interface PackEntry {
  filename: string;
  files: Array<{ path: string }>;
}

function packageTestsEnabled(): boolean {
  return getEnvVar('GOATDB_TEST_PACKAGE') === '1';
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await readTextFile(file)) !== undefined;
  } catch {
    return false;
  }
}

function parsePackOutput(text: string): PackEntry[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  assertTrue(start >= 0 && end > start, `npm pack produced no JSON:\n${text}`);
  return JSON.parse(text.slice(start, end + 1)) as PackEntry[];
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

async function copyTree(source: string, target: string): Promise<void> {
  await mkdir(target);
  for (const entry of await readDir(source)) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory) {
      await copyTree(from, to);
    } else if (entry.isFile) {
      await writeFile(to, await readFile(from));
    }
  }
}

/** Root files npm always ships, so the archive matches a real publish. */
async function copyRootDocs(
  repoRoot: string,
  stage: string,
): Promise<void> {
  for (const name of ['README.md', 'LICENSE']) {
    const text = await readTextFile(path.join(repoRoot, name));
    if (text !== undefined) {
      await writeTextFile(path.join(stage, name), text);
    }
  }
}

/**
 * Builds the archive npm would publish: the shared production manifest plus the
 * built output. Staged outside the repo so the checkout manifest stays intact.
 */
async function stagePackage(
  ctx: TestSuite,
  repoRoot: string,
): Promise<{ stage: string; manifest: NpmManifest }> {
  const checkout = await readJson<NpmManifest>(
    path.join(repoRoot, 'package.json'),
  );
  assertExists(checkout, 'Checkout package.json missing');
  const manifest = productionManifest(checkout, await readVersion(repoRoot));
  const stage = await ctx.tempDir('stage');
  await writeTextFile(
    path.join(stage, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await copyTree(path.join(repoRoot, 'dist'), path.join(stage, 'dist'));
  await copyRootDocs(repoRoot, stage);
  return { stage, manifest };
}

function exportTargets(manifest: NpmManifest): string[] {
  const entries = Object.values(manifest.exports ?? {});
  return entries.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : [entry.import, entry.types]
  ).map((target) => target.replace(/^\.\//, ''));
}

async function requiredShipPaths(
  repoRoot: string,
  manifest: NpmManifest,
): Promise<string[]> {
  const templates = await allTemplateRelativePaths(repoRoot);
  return [
    'dist/cli/init.js', // package.json bin
    ...exportTargets(manifest),
    ...templates.map((file) => `dist/cli/templates/${file}`),
  ];
}

async function buildAndPack(
  ctx: TestSuite,
  repoRoot: string,
): Promise<{ tarball: string; manifest: NpmManifest }> {
  const build = await cli('npm', 'run', 'build:npm', {
    cwd: repoRoot,
    timeout: 300_000,
  });
  assertEquals(build.exitCode, 0, build.result);
  await assertTemplateTree(
    path.join(repoRoot, 'dist/cli/templates'),
    repoRoot,
  );

  const { stage, manifest } = await stagePackage(ctx, repoRoot);
  const packDir = await ctx.tempDir('pack');
  const pack = await cli(
    'npm',
    'pack',
    '--json',
    '--pack-destination',
    packDir,
    { cwd: stage, timeout: 180_000 },
  );
  assertEquals(pack.exitCode, 0, pack.result);
  const entries = parsePackOutput(pack.result);
  assertEquals(entries.length, 1, 'Expected exactly one tarball');

  const shipped = new Set(entries[0].files.map((file) => file.path));
  for (const file of await requiredShipPaths(repoRoot, manifest)) {
    assertTrue(shipped.has(file), `Tarball is missing ${file}`);
  }
  return { tarball: path.join(packDir, entries[0].filename), manifest };
}

/**
 * Installs the tarball outside the repo. Optional peers of public entry points
 * are installed explicitly, since `--omit=dev` skips them and the import probe
 * must load those entries.
 */
async function installConsumer(
  ctx: TestSuite,
  tarball: string,
): Promise<string> {
  const consumer = await ctx.tempDir('consumer');
  await writeTextFile(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      { name: 'goatdb-package-consumer', private: true, type: 'module' },
      null,
      2,
    ) + '\n',
  );
  // WHY an explicit scope: the published entries import @jsr/* packages through
  // the JSR npm-compat registry. A consumer outside this repo has no .npmrc, so
  // npm would look for @jsr on npmjs.org and fail with E404.
  await writeTextFile(
    path.join(consumer, '.npmrc'),
    '@jsr:registry=https://npm.jsr.io\n',
  );
  const install = await cli(
    'npm',
    'install',
    '--omit=dev',
    '--ignore-scripts',
    tarball,
    ...kPeerDependencies,
    { cwd: consumer, timeout: 300_000 },
  );
  assertEquals(install.exitCode, 0, install.result);
  return consumer;
}

async function assertBinLinks(consumer: string): Promise<void> {
  const bin = await fileExists(
    path.join(consumer, 'node_modules/.bin/goatdb'),
  );
  const binCmd = await fileExists(
    path.join(consumer, 'node_modules/.bin/goatdb.cmd'),
  );
  assertTrue(bin || binCmd, 'Installed goatdb bin missing');
}

async function assertResolvesLocally(consumer: string): Promise<void> {
  const resolved = await cli(
    'node',
    '--input-type=module',
    '-e',
    `console.log(import.meta.resolve('${kPackageName}'))`,
    { cwd: consumer, timeout: 120_000 },
  );
  assertEquals(resolved.exitCode, 0, resolved.result);
  assertTrue(
    resolved.result.includes(consumer) &&
      resolved.result.includes('node_modules/@goatdb/goatdb'),
    `Consumer resolved outside its node_modules:\n${resolved.result}`,
  );
}

function subpathSpecifier(subpath: string): string {
  return subpath === '.' ? kPackageName : kPackageName + subpath.slice(1);
}

function entrySpecifiers(manifest: NpmManifest): string[] {
  return Object.keys(manifest.exports ?? {}).map(subpathSpecifier);
}

/**
 * Imports every public export from the consumer. Resolution alone passes for
 * archives whose targets are absent, so the modules must actually load.
 */
async function assertEntryPointsLoad(
  consumer: string,
  manifest: NpmManifest,
): Promise<void> {
  const specifiers = entrySpecifiers(manifest);
  await writeTextFile(
    path.join(consumer, 'entrypoint-probe.mjs'),
    [
      `const specifiers = ${JSON.stringify(specifiers)};`,
      'const report = {};',
      'for (const specifier of specifiers) {',
      '  report[specifier] = Object.keys(await import(specifier));',
      '}',
      'console.log(JSON.stringify(report));',
    ].join('\n'),
  );
  const run = await cli('node', 'entrypoint-probe.mjs', {
    cwd: consumer,
    timeout: 120_000,
  });
  assertEquals(run.exitCode, 0, run.result);
  const report = JSON.parse(
    run.result.trim().split('\n').at(-1)!,
  ) as Record<string, string[]>;
  for (const specifier of specifiers) {
    assertTrue(
      (report[specifier] ?? []).length > 0,
      `Entry point exported nothing: ${specifier}`,
    );
  }
  for (const [subpath, symbol] of Object.entries(kPublicExports)) {
    const specifier = subpathSpecifier(subpath);
    assertTrue(
      report[specifier]?.includes(symbol) ?? false,
      `Entry point must export ${symbol}: ${specifier}`,
    );
  }
}

async function assertInstalledPackage(
  consumer: string,
  repoRoot: string,
  expected: NpmManifest,
): Promise<void> {
  const installed = path.join(consumer, 'node_modules', kPackageName);
  const installedPkg = await readJson<NpmManifest>(
    path.join(installed, 'package.json'),
  );
  assertExists(installedPkg, 'Installed package.json missing');
  assertEquals(installedPkg.version, expected.version, 'Shipped version drift');
  assertEquals(installedPkg.exports, expected.exports, 'Shipped exports drift');
  await assertTemplateTree(
    path.join(installed, 'dist/cli/templates'),
    repoRoot,
  );
  await assertBinLinks(consumer);
  await assertResolvesLocally(consumer);
  await assertEntryPointsLoad(consumer, expected);
}

async function assertCliWorks(
  consumer: string,
  repoRoot: string,
): Promise<void> {
  const help = await cli(
    'npx',
    '--no-install',
    'goatdb',
    '--help',
    { cwd: consumer, timeout: 120_000 },
  );
  assertEquals(help.exitCode, 0, help.result);
  assertTrue(
    help.result.includes('Commands:') &&
      help.result.includes('init [dir]'),
    `Unexpected help output:\n${help.result}`,
  );

  const target = path.join(consumer, 'generated-app');
  const init = await cli(
    'npx',
    '--no-install',
    'goatdb',
    'init',
    target,
    { cwd: consumer, timeout: 300_000 },
  );
  assertEquals(init.exitCode, 0, init.result);

  await assertScaffoldTemplates(target, 'node', repoRoot);
  const packageJson = await readJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(path.join(target, 'package.json'));
  assertExists(packageJson, 'Generated package.json missing');
  assertTrue(
    packageJson.dependencies?.['@goatdb/goatdb']?.includes(
      '@jsr/goatdb__goatdb',
    ) ?? false,
    'Generated project must install GoatDB from the registry',
  );
  await assertImportsWork(target, 'node');
}

async function assertCliFailureContract(consumer: string): Promise<void> {
  const invalid = path.join(consumer, 'invalid-app');
  await writeTextFile(path.join(invalid, 'package.json'), '{ invalid json');
  const result = await cli(
    'npx',
    '--no-install',
    'goatdb',
    'init',
    invalid,
    { cwd: consumer, timeout: 120_000 },
  );
  assertEquals(result.exitCode, 1, result.result);
  assertCliFailure(result.result);
}

export default function setupCliPackageTests() {
  TEST(
    'CLI-Package',
    'npm tarball ships templates and loads every public entry point',
    async (ctx) => {
      if (isBrowser() || !isNode()) return;
      if (!packageTestsEnabled()) {
        console.log(
          'Skipping CLI-Package (set GOATDB_TEST_PACKAGE=1 to run)',
        );
        return;
      }
      const repoRoot = getRuntime().getCWD();
      const { tarball, manifest } = await buildAndPack(ctx, repoRoot);
      const consumer = await installConsumer(ctx, tarball);
      await assertInstalledPackage(consumer, repoRoot, manifest);
      await assertCliWorks(consumer, repoRoot);
      await assertCliFailureContract(consumer);
    },
  );
}
