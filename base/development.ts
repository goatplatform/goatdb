import * as path from './path.ts';
import { isDeno, isNode } from './common.ts';
import { pathExists } from './json-log/file-impl.ts';

// Minimal type for objects with a toString method (used in Node.js streams)
type Stringable = { toString(): string };

// Cache Node.js child_process module (loaded lazily)
let childProcessModule: any = undefined;

export function getEntryFilePath(): string {
  return path.fromFileUrl(import.meta.url);
}

export async function getRepositoryPath(): Promise<string> {
  let candidate = path.dirname(getEntryFilePath());
  while (!(await pathExists(path.join(candidate, '.git')))) {
    candidate = path.dirname(candidate);
  }
  return candidate;
}

export async function getImportMapPath(): Promise<string> {
  return path.join(await getRepositoryPath(), 'import-map.json');
}

export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (Deno.build.os === 'darwin') {
      const process = new Deno.Command('pbcopy', {
        stdin: 'piped',
      }).spawn();
      const encoder = new TextEncoder();
      const writer = process.stdin.getWriter();
      await writer.write(encoder.encode(value));
      // await writer.write(encoder.encode('\u0004'));
      await writer.close();
      // await process.stdin.close();
      await process.output();
      return true;
    }
    if (Deno.build.os === 'windows') {
      console.log(`Copy:\n\n${value}\n`);
      return true;
    }
  } catch (_err: unknown) {
    // Clipboard operations may fail in non-browser environments
  }
  return false;
}

/**
 * Result of a CLI command execution
 */
export interface CliResult {
  /** The combined stdout and stderr output */
  result: string;
  /** The process exit code */
  exitCode: number;
}

/**
 * Options for CLI command execution
 */
export interface CliOptions {
  /** Working directory for the command */
  cwd?: string;
}

function isCliOptions(arg: unknown): arg is CliOptions {
  return typeof arg === 'object' && arg !== null && !Array.isArray(arg);
}

/**
 * Executes a command line interface command and waits for it to complete.
 *
 * @param cmd - The command to execute
 * @param args - Additional arguments to pass to the command (or options if last arg is CliOptions)
 * @returns A promise that resolves with the result string and exit code
 *
 * @example
 * ```ts
 * const { result, exitCode } = await cli('deno', 'run', 'app.ts');
 * const { result, exitCode } = await cli('npm', 'install', { cwd: '/path/to/project' });
 * ```
 */
export async function cli(cmd: string, ...args: (string | CliOptions)[]): Promise<CliResult> {
  // Extract options if the last argument is an options object
  let options: CliOptions = {};
  let cmdArgs: string[];

  const lastArg = args[args.length - 1];
  if (args.length > 0 && isCliOptions(lastArg)) {
    options = lastArg;
    cmdArgs = args.slice(0, -1) as string[];
  } else {
    cmdArgs = args as string[];
  }

  // console.log(`Running: ${cmd} ${cmdArgs.join(' ')}`);
  if (isDeno()) {
    const process = new Deno.Command(cmd, {
      args: cmdArgs,
      stdout: 'piped',
      stderr: 'piped',
      cwd: options.cwd,
    });
    const { stdout, stderr, code } = await process.output();
    const decoder = new TextDecoder();
    const output = decoder.decode(stdout) + decoder.decode(stderr);
    return { result: output, exitCode: code };
  } else if (isNode()) {
    // Node.js environment - lazy load child_process module
    if (!childProcessModule) {
      childProcessModule = await import('node:child_process');
    }
    const { spawn } = childProcessModule;
    return new Promise((resolve) => {
      let result = '';
      const spawnOptions = options.cwd ? { cwd: options.cwd } : {};
      const process = spawn(cmd, cmdArgs, spawnOptions);

      process.stdout.on('data', (data: Stringable) => {
        result += data.toString();
      });

      process.stderr.on('data', (data: Stringable) => {
        result += data.toString();
      });

      process.on('close', (code: number | null) => {
        resolve({ result, exitCode: code ?? 0 });
      });

      process.on('error', (err: Error) => {
        resolve({ result: err.message, exitCode: 1 });
      });
    });
  } else {
    throw new Error('CLI execution not supported in browser environment');
  }
}
