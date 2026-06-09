import * as path from '../base/path.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { TEST } from './mod.ts';
import { assertEquals, assertFalse, assertTrue } from './asserts.ts';

const kFakeTypeErrorMarker = 'FAKE_TYPE_ERROR';

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<CommandResult> {
  const output = await new Deno.Command(command, {
    args,
    cwd,
    env,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function writeExecutable(
  filePath: string,
  content: string,
): Promise<void> {
  await Deno.mkdir(path.dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, content);
  await Deno.chmod(filePath, 0o755);
}

async function setupHookRepo(repoDir: string): Promise<{ logPath: string }> {
  const sourceHookPath = path.join(
    getRuntime().getCWD(),
    '.githooks/pre-commit',
  );
  const hookText = await Deno.readTextFile(sourceHookPath);
  const hookPath = path.join(repoDir, '.githooks/pre-commit');
  await writeExecutable(hookPath, hookText);

  const denoBinDir = path.join(repoDir, 'fake-bin');
  const logPath = path.join(repoDir, 'fake-deno.log');
  const fakeDenoPath = path.join(denoBinDir, 'deno');
  await writeExecutable(
    fakeDenoPath,
    `#!/bin/sh
log_file="$GOATDB_FAKE_DENO_LOG"
{
  printf 'cmd=%s\n' "$1"
  i=1
  for arg in "$@"; do
    printf 'arg%s=%s\n' "$i" "$arg"
    i=$((i + 1))
  done
  printf -- '--\n'
} >> "$log_file"
if [ "$1" = "check" ]; then
  shift
  for file in "$@"; do
    if grep -q '${kFakeTypeErrorMarker}' "$file"; then
      echo "fake type-check failed for $file" >&2
      exit 1
    fi
  done
fi
exit 0
`,
  );

  const init = await runCommand('git', ['init'], repoDir);
  assertEquals(init.code, 0, `git init must succeed: ${init.stderr}`);

  const currentPath = Deno.env.get('PATH') || '';
  const env = {
    PATH: `${denoBinDir}:${currentPath}`,
    GOATDB_FAKE_DENO_LOG: logPath,
  };

  const setupResult = await runCommand(
    'sh',
    ['.githooks/pre-commit'],
    repoDir,
    env,
  );
  assertEquals(
    setupResult.code,
    0,
    `hook setup run must succeed: ${setupResult.stdout}\n${setupResult.stderr}`,
  );
  await Deno.writeTextFile(logPath, '');
  return { logPath };
}

async function stageFile(
  repoDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(repoDir, relativePath);
  await Deno.mkdir(path.dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, content);
  const add = await runCommand('git', ['add', '--', relativePath], repoDir);
  assertEquals(add.code, 0, `git add must succeed: ${add.stderr}`);
}

async function runPreCommit(
  repoDir: string,
  logPath: string,
): Promise<CommandResult & { log: string }> {
  const currentPath = Deno.env.get('PATH') || '';
  const env = {
    PATH: `${path.join(repoDir, 'fake-bin')}:${currentPath}`,
    GOATDB_FAKE_DENO_LOG: logPath,
  };
  const result = await runCommand('sh', ['.githooks/pre-commit'], repoDir, env);
  return {
    ...result,
    log: await Deno.readTextFile(logPath),
  };
}

export function setupGitHooksDenoTests(): void {
  if (getRuntime().getOS() === 'windows') {
    return;
  }

  TEST(
    'GitHooks',
    'pre-commit skips deno check when no staged TypeScript files exist',
    async (ctx) => {
      const repoDir = await ctx.tempDir('git-hook-no-ts');
      const { logPath } = await setupHookRepo(repoDir);
      await stageFile(repoDir, 'notes.txt', 'no type-check needed\n');

      const result = await runPreCommit(repoDir, logPath);

      assertEquals(result.code, 0, result.stderr);
      assertFalse(
        result.log.includes('cmd=check\n'),
        'deno check must not run when no staged TypeScript files exist',
      );
    },
  );

  TEST(
    'GitHooks',
    'pre-commit type-checks staged TypeScript paths without splitting spaces',
    async (ctx) => {
      const repoDir = await ctx.tempDir('git-hook-spaces');
      const { logPath } = await setupHookRepo(repoDir);
      const stagedPath = 'space dir/component file.tsx';
      await stageFile(
        repoDir,
        stagedPath,
        'export default function C() { return null; }\n',
      );

      const result = await runPreCommit(repoDir, logPath);

      assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
      assertTrue(
        result.log.includes('cmd=check\n'),
        'deno check must run for staged TypeScript files',
      );
      assertTrue(
        result.log.includes(`arg2=${stagedPath}\n`),
        'staged TypeScript paths must be passed to deno check intact',
      );
    },
  );

  TEST(
    'GitHooks',
    'pre-commit fails commits when staged TypeScript files do not type-check',
    async (ctx) => {
      const repoDir = await ctx.tempDir('git-hook-type-error');
      const { logPath } = await setupHookRepo(repoDir);
      await stageFile(
        repoDir,
        'broken.ts',
        `export const broken = '${kFakeTypeErrorMarker}';\n`,
      );

      const result = await runPreCommit(repoDir, logPath);

      assertEquals(result.code, 1, 'type-check failures must block the commit');
      assertTrue(
        result.stdout.includes('fake type-check failed for broken.ts'),
        'pre-commit must surface the deno check failure output',
      );
      assertTrue(
        result.stderr.includes(
          'Error: type-checking failed. Fix the issues above before committing.',
        ),
        'pre-commit must print a clear failure message',
      );
    },
  );
}
