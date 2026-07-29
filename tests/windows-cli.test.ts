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

const kSupportedBatchValues = [
  'space value',
  'amp&value',
  'pipe|value',
  'redirect>out<input',
  'caret^value',
  'quote"value',
  '',
  'trailing\\',
  'space & pipe| redirect>< caret^ quote" trailing\\',
];

const kRejectedBatchValues = [
  ['literal percent', 'literal%value', 'literal "%"'],
  ['literal exclamation', 'literal!value', 'literal "!"'],
  ['carriage return', 'line\rvalue', 'line break'],
  ['line feed', 'line\nvalue', 'line break'],
] as const;

function nativeArgumentCommand(values: string[]): [string, ...string[]] {
  const runtime = getRuntime();
  const code = runtime.id === 'deno'
    ? 'console.log(JSON.stringify(Deno.args))'
    : 'console.log(JSON.stringify(process.argv.slice(1)))';
  const prefix = runtime.id === 'deno' ? ['eval', code] : ['-e', code];
  return [runtime.getExecPath(), ...prefix, ...values];
}

async function writeBatchFile(
  dir: string,
  name: string,
  lines: string[],
): Promise<string> {
  const script = path.join(dir, name);
  await writeTextFile(script, lines.join('\r\n'));
  return script;
}

async function createBatchArgumentRecorder(
  ctx: TestSuite,
  name: string,
): Promise<string> {
  const dir = await ctx.tempDir(name);
  const recorder = path.join(dir, 'record-args.js');
  const runtime = getRuntime();
  const runtimeArgs = runtime.id === 'deno' ? ['run'] : [];
  await writeTextFile(
    recorder,
    "const args = typeof Deno === 'undefined' ? process.argv.slice(2) : Deno.args;\nconsole.log(JSON.stringify(args));",
  );
  const command = [runtime.getExecPath(), ...runtimeArgs]
    .map((value) => `"${value}"`).join(' ');
  return await writeBatchFile(
    dir,
    'record-args.cmd',
    // `%*` forwards original args; the runtime records argv without batch echo parsing.
    [`@${command} "%~dp0record-args.js" %*`],
  );
}

async function createBatch(ctx: TestSuite, name: string): Promise<string> {
  const dir = await ctx.tempDir(name);
  const script = path.join(dir, 'echo-args.cmd');
  // Safe batch pattern: capture args with quotes preserved (via %n), then use
  // delayed expansion + for/f to strip outer quotes safely. This avoids
  // exposing cmd.exe metacharacters (&, |, etc.) that %~n would activate
  // during parse-time expansion.
  const content = [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "raw1=%1"',
    'set "raw2=%2"',
    'setlocal EnableDelayedExpansion',
    'for /f "tokens=*" %%a in ("!raw1!") do set "arg1=%%~a"',
    'for /f "tokens=*" %%a in ("!raw2!") do set "arg2=%%~a"',
    'echo [!arg1!]',
    'echo [!arg2!]',
  ].join('\r\n');
  await writeTextFile(script, content);
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
    'batch commands reject literal exclamation values',
    async (ctx) => {
      const script = await createBatch(ctx, 'windows-cli-exclamation');
      await assertThrows(
        () => cli(script, 'literal!value'),
        Error,
        'literal "!"',
      );
    },
  );

  TEST(
    'Windows-CLI',
    'batch commands reject line break values',
    async (ctx) => {
      const script = await createBatch(ctx, 'windows-cli-newline');
      await assertThrows(
        () => cli(script, 'line\nvalue'),
        Error,
        'line break',
      );
    },
  );

  TEST(
    'Windows-CLI',
    'batch commands preserve pipe character',
    async (ctx) => {
      const script = await createBatch(ctx, 'windows-cli-pipe');
      const { exitCode, result } = await cli(script, 'first', 'a|b');
      assertEquals(exitCode, 0);
      assertEquals(result.trim().split(/\r?\n/), ['[first]', '[a|b]']);
    },
  );

  TEST(
    'Windows-CLI',
    'batch commands preserve redirection characters',
    async (ctx) => {
      const script = await createBatch(ctx, 'windows-cli-redirect');
      const { exitCode, result } = await cli(script, 'first', 'a>b<c');
      assertEquals(exitCode, 0);
      assertEquals(result.trim().split(/\r?\n/), ['[first]', '[a>b<c]']);
    },
  );

  TEST(
    'Windows-CLI',
    'batch commands preserve caret character',
    async (ctx) => {
      const script = await createBatch(ctx, 'windows-cli-caret');
      const { exitCode, result } = await cli(script, 'first', 'a^b');
      assertEquals(exitCode, 0);
      assertEquals(result.trim().split(/\r?\n/), ['[first]', '[a^b]']);
    },
  );

  TEST(
    'Windows-CLI',
    'batch commands preserve embedded double quotes',
    async (ctx) => {
      const script = await createBatch(ctx, 'windows-cli-embedded-quote');
      const { exitCode, result } = await cli(script, 'first', 'a"b');
      assertEquals(exitCode, 0);
      assertEquals(result.trim().split(/\r?\n/), ['[first]', '[a"b]']);
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
