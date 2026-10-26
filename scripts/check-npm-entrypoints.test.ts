import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from '../base/path.ts';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const guard = resolve(root, 'scripts/check-npm-entrypoints.ts');

async function fixture(run: (path: string) => Promise<void>) {
  // Keep module resolution identical to the real build, without editing its files.
  const path = await mkdtemp(resolve(root, '.npm-entrypoints-'));
  try {
    for (
      const name of ['package.json', 'tsup.config.ts', 'tsconfig.npm.json']
    ) {
      await copyFile(resolve(root, name), resolve(path, name));
    }
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

async function replace(path: string, name: string, old: string, value: string) {
  const file = resolve(path, name);
  const text = await readFile(file, 'utf8');
  assert.ok(text.includes(old), `Mutation target missing: ${old}`);
  await writeFile(file, text.replace(old, value));
}

function check(path: string, missing?: string) {
  const result = spawnSync(process.execPath, [guard, path], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.ifError(result.error);
  if (missing) {
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(missing), result.stderr);
  } else {
    assert.equal(result.status, 0, result.stderr);
  }
}

test('npm entrypoint guard runs as a script from its own path', async () => {
  const path = await mkdtemp(resolve(root, '.npm-entrypoints-'));
  try {
    // Empty cwd: only a live main-module guard reaches checkNpmEntrypoints.
    const result = spawnSync(process.execPath, [guard], {
      cwd: path,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test('npm entrypoint guard accepts the real public entrypoints', async () => {
  await fixture(async (path) => check(path));
});

for (
  const [name, text, value, failure] of [
    ['tsup.config.ts', "server: 'server.ts',", '', 'missing [server.ts]'],
    [
      'tsup.config.ts',
      "'cli/init': 'cli/init.ts',",
      '',
      'missing [cli/init.ts]',
    ],
    ['tsconfig.npm.json', '"server.ts",', '', 'missing [server.ts]'],
    ['tsconfig.npm.json', '"cli/init.ts",', '', 'missing [cli/init.ts]'],
    [
      'tsup.config.ts',
      'entry: {',
      "entry: { extra: 'extra.ts',",
      'extra [extra.ts]',
    ],
    [
      'tsup.config.ts',
      "server: 'server.ts'",
      "renamed: 'server.ts'",
      'tsup output entrypoint drift: missing [server.ts]',
    ],
    [
      'package.json',
      '"./server.ts"',
      '"./new-public.ts"',
      'missing [new-public.ts]',
    ],
    [
      'package.json',
      './dist/cli/init.js',
      './cli/init.js',
      'Unsupported npm bin target',
    ],
  ]
) {
  test(`npm guard rejects ${name}: ${failure}`, async () => {
    await fixture(async (path) => {
      await replace(path, name, text, value);
      check(path, failure);
    });
  });
}
