/** Static guard: tests must exercise this checkout, never a published package.
 * A registry install changes the subject from current code to release behavior. */

import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { isBrowser } from '../base/common.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { scanSourceTree } from './file-walk.ts';

const kGuardFile = 'no-registry-dependency.test.ts';
const kManagers = /^(?:npm|npx|pnpm|yarn|bun|bunx|deno)$/;
const kInstallManagers = /^(?:npm|pnpm|yarn|bun)$/;
const kInstallCommands = /^(?:install|i|add|ci)$/;
const kRunLike = /^(?:npx|bunx|dlx|x)$/;
const kForbiddenSpec =
  /(?:@goatdb\/goatdb|@jsr\/goatdb__|npm:@jsr\/goatdb__|jsr:@goatdb\/goatdb)(?![\w-])/;
const kCallStart =
  /\b(?:cli|runProcess|spawn|spawnSync|exec|execFile|execFileSync|Deno\.Command)\s*\(/g;
const kQuoted = /(['"`])((?:\\.|[\s\S])*?)\1/g;

/** Collects string args of each process call, balanced across nested calls. */
function processCallArgs(text: string): string[][] {
  return [...text.matchAll(kCallStart)].map((match) => {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let i = start;
    for (; depth > 0 && i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    const raw = text.slice(start, i - 1);
    return [...raw.matchAll(kQuoted)].map((quote) =>
      quote[2].replace(/\\(.)/g, '$1')
    );
  });
}

/** Returns violations for package-manager calls that leave the checkout. */
export function scanRegistryCommands(text: string): string[] {
  const violations: string[] = [];
  for (const args of processCallArgs(text)) {
    const manager = args[0];
    if (manager === undefined || !kManagers.test(manager)) continue;
    const rest = args.slice(1);
    const spec = rest.find((arg) => kForbiddenSpec.test(arg));
    if (spec !== undefined) {
      violations.push(
        `${manager} must not resolve GoatDB from a registry: ${spec}`,
      );
      continue;
    }
    const command = rest.find((arg) => !arg.startsWith('-'));
    const runLike = kRunLike.test(manager) ||
      (command !== undefined && kRunLike.test(command));
    if (
      runLike &&
      rest.some((arg) => arg === 'goatdb' || arg.endsWith('/goatdb'))
    ) {
      violations.push(`${manager} must not run the published goatdb bin`);
    }
    if (
      kInstallManagers.test(manager) && command !== undefined &&
      kInstallCommands.test(command)
    ) {
      violations.push(
        `${manager} ${command} must not install packages during tests`,
      );
    }
  }
  return [...new Set(violations)];
}

async function assertNoRegistryConsumption(
  root: path.PosixPath,
): Promise<void> {
  const violations = await scanSourceTree(
    path.join(root, 'tests'),
    kGuardFile,
    (file, text) =>
      scanRegistryCommands(text).map((violation) => `${file}: ${violation}`),
  );
  assertTrue(violations.length === 0, violations.join('\n'));
}

export default function setupNoRegistryDependencyTests() {
  TEST(
    'TestBoundaries',
    'registry guard classifies package-manager calls',
    () => {
      for (
        const text of [
          "await cli('npm', 'install',\n  '--omit=dev',\n  tarball, { cwd });",
          "await cli('npx', '--no-install', 'goatdb', 'init');",
          "await cli('deno', 'add', 'jsr:@goatdb/goatdb');",
          "await cli('npm', 'install', '@goatdb/goatdb');",
          "await cli('pnpm', 'dlx', 'goatdb');",
          "await cli('npm', 'install', path.join(root, tarball));",
          "await runProcess('npm', ['install', '@goatdb/goatdb'], {});",
          "await new Deno.Command('npm', { args: ['install', '@goatdb/goatdb'] });",
        ]
      ) {
        assertTrue(scanRegistryCommands(text).length > 0, text);
      }
      for (
        const text of [
          "await cli('npm', 'run', 'build:npm', { cwd });",
          "await cli('node', bin, '--help');",
          "await cli('deno', 'info', '--json', 'client/index.tsx');",
          "await cli('npm', 'ls', '--depth=0', '--json');",
        ]
      ) {
        assertEquals(scanRegistryCommands(text), [], text);
      }
    },
  );

  // Browser runs the pure classifier; checkout scanning needs filesystem access.
  if (!isBrowser()) {
    TEST(
      'TestBoundaries',
      'tests do not install GoatDB from a registry',
      () => assertNoRegistryConsumption(getRuntime().getCWD()),
    );
  }
}
