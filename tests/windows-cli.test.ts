import { TEST, type TestSuite } from './mod.ts';
import { assertEquals, assertThrows } from './asserts.ts';
import * as path from '../base/path.ts';
import {
  readFile,
  writeFile,
  writeTextFile,
} from '../base/json-log/file-impl.ts';
import { cli } from '../base/cli.ts';
import { getRuntime } from '../base/runtime/index.ts';

function nativeArgumentCommand(values: string[]): [string, ...string[]] {
  const runtime = getRuntime();
  const code = runtime.id === 'deno'
    ? 'console.log(JSON.stringify(Deno.args))'
    : 'console.log(JSON.stringify(process.argv.slice(1)))';
  const prefix = runtime.id === 'deno' ? ['eval', code] : ['-e', code];
  return [runtime.getExecPath(), ...prefix, ...values];
}

function batchScript(values: string[]): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    ...values.map((value) => `echo [${value}]`),
  ]
    .join('\r\n');
}

async function createBatch(ctx: TestSuite, name: string): Promise<string> {
  const dir = await ctx.tempDir(name);
  const script = path.join(dir, 'echo-args.cmd');
  await writeTextFile(script, batchScript(['%~1', '%~2']));
  return script;
}

async function copyRuntimeAsLocalCommandProcessor(dir: string): Promise<void> {
  const runtime = getRuntime();
  await writeFile(
    path.join(dir, 'cmd.exe'),
    await readFile(runtime.getExecPath()),
  );
}

export default function setupWindowsCliTests(): void {
  TEST(
    'Windows-CLI',
    'native executables preserve raw argv values',
    async () => {
      const values = [
        'space value',
        'amp&value',
        'percent%value',
        'quote"value',
        'trailing\\',
        '',
      ];
      const [command, ...args] = nativeArgumentCommand(values);
      const { exitCode, result } = await cli(command, ...args);
      assertEquals(exitCode, 0);
      assertEquals(JSON.parse(result), values);
    },
  );

  TEST(
    'Windows-CLI',
    'batch commands preserve safe quoted values',
    async (ctx) => {
      const script = await createBatch(ctx, 'windows cli batch');
      const { exitCode, result } = await cli(
        script,
        'safe space',
        'safe&value',
      );
      assertEquals(exitCode, 0);
      assertEquals(result.trim().split(/\r?\n/), [
        '[safe space]',
        '[safe&value]',
      ]);
    },
  );

  TEST(
    'Windows-CLI',
    'batch commands reject literal percent values',
    async (ctx) => {
      const script = await createBatch(ctx, 'windows-cli-percent');
      await assertThrows(
        () => cli(script, 'literal%value'),
        Error,
        'literal "%"',
      );
    },
  );

  TEST(
    'Windows-CLI',
    'batch commands do not select a local cmd.exe',
    async (ctx) => {
      const dir = await ctx.tempDir('windows cli command processor');
      const script = await createBatch(ctx, 'windows cli command processor');
      await copyRuntimeAsLocalCommandProcessor(dir);
      const { exitCode, result } = await cli(
        script,
        'safe space',
        'safe&value',
        { cwd: dir },
      );
      assertEquals(exitCode, 0);
      assertEquals(result.trim().split(/\r?\n/), [
        '[safe space]',
        '[safe&value]',
      ]);
    },
  );
}
