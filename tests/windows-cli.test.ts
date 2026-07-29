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
import { serializeBatchCommand } from '../base/windows-cli.ts';

const kSupportedBatchValues = [
  'space value',
  'amp&value',
  'pipe|value',
  'redirect>out<input',
  'caret^value',
  'quote"value',
  '',
  'trailing\\',
  'double trailing\\\\',
  'back\\"slash',
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

async function copyRuntimeAsLocalCommandProcessor(dir: string): Promise<void> {
  const runtime = getRuntime();
  await writeFile(
    path.join(dir, 'cmd.exe'),
    await readFile(runtime.getExecPath()),
  );
}

function setupNativeArgumentTests(): void {
  TEST(
    'Windows-CLI',
    'native executables preserve raw argv values',
    async () => {
      const values = [
        ...kSupportedBatchValues,
        'percent%value',
        'exclamation!value',
      ];
      const [command, ...args] = nativeArgumentCommand(values);
      const { exitCode, result } = await cli(command, ...args);
      assertEquals(exitCode, 0);
      assertEquals(JSON.parse(result), values);
    },
  );
}

function setupBatchArgumentTests(): void {
  TEST(
    'Windows-CLI',
    'batch commands preserve supported values',
    async (ctx) => {
      const script = await createBatchArgumentRecorder(
        ctx,
        'windows cli batch',
      );
      const { exitCode, result } = await cli(script, ...kSupportedBatchValues);
      assertEquals(exitCode, 0);
      assertEquals(JSON.parse(result), kSupportedBatchValues);
    },
  );
}

function setupRejectedBatchArgumentTests(): void {
  for (const [name, value, message] of kRejectedBatchValues) {
    TEST('Windows-CLI', `batch commands reject ${name}`, async (ctx) => {
      const script = await createBatchArgumentRecorder(
        ctx,
        `windows-cli-${name.replaceAll(' ', '-')}`,
      );
      await assertThrows(() => cli(script, value), Error, message);
    });
  }
}

function setupCommandProcessorTests(): void {
  TEST(
    'Windows-CLI',
    'batch commands do not select a local cmd.exe',
    async (ctx) => {
      const dir = await ctx.tempDir('windows-cli-command-processor');
      const script = await writeBatchFile(dir, 'sentinel.cmd', [
        '@echo sentinel',
      ]);
      await copyRuntimeAsLocalCommandProcessor(dir);
      const { exitCode, result } = await cli(script, { cwd: dir });
      assertEquals(exitCode, 0);
      assertEquals(result.trim(), 'sentinel');
    },
  );
}

/**
 * Implements the documented MSVCRT / CommandLineToArgvW argv rules used by the
 * final exe on Windows: 2n backslashes + `"` toggle quoting, 2n+1 backslashes
 * + `"` yield a literal quote, and inside quotes `""` is a literal quote.
 */
function parseMsvcrtCommandLine(commandLine: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let hasArg = false;
  for (let i = 0; i < commandLine.length;) {
    let backslashes = 0;
    while (commandLine[i] === '\\') {
      backslashes++;
      i++;
    }
    if (commandLine[i] === '"') {
      current += '\\'.repeat(backslashes >> 1);
      if (backslashes % 2 === 0) {
        if (inQuotes && commandLine[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else {
        current += '"';
      }
      hasArg = true;
      i++;
    } else {
      current += '\\'.repeat(backslashes);
      if (commandLine[i] === undefined) break;
      if ((commandLine[i] === ' ' || commandLine[i] === '\t') && !inQuotes) {
        args.push(current);
        current = '';
        hasArg = false;
        while (commandLine[i] === ' ' || commandLine[i] === '\t') i++;
      } else {
        current += commandLine[i];
        hasArg = true;
        i++;
      }
    }
  }
  if (hasArg || current.length > 0) args.push(current);
  return args;
}

// Pure string round-trip: registered on every platform so non-Windows CI also
// guards the serialization contract. The execution tests below only run when
// this file's setup is registered on Windows (see test-registry.ts).
export function setupBatchSerializationTests(): void {
  TEST(
    'Windows-CLI',
    'batch serialization survives MSVCRT argv parsing',
    () => {
      const values = ['batch.cmd', ...kSupportedBatchValues];
      const serialized = serializeBatchCommand(
        'batch.cmd',
        kSupportedBatchValues,
      );
      // cmd.exe /s strips the outer quotes before the final exe parses argv.
      const commandLine = serialized.slice(1, -1);
      assertEquals(parseMsvcrtCommandLine(commandLine), values);
    },
  );
}

export default function setupWindowsCliTests(): void {
  setupNativeArgumentTests();
  setupBatchArgumentTests();
  setupRejectedBatchArgumentTests();
  setupCommandProcessorTests();
}
