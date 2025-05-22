import * as path from '@std/path';

// Minimal type for objects with a toString method (used in Node.js streams)
type Stringable = { toString(): string };

// Cache Node.js modules at the top level if in Node.js environment
let nodeModules: { childProcess: any } | undefined = undefined;
if (typeof require !== 'undefined') {
  nodeModules = {
    childProcess: require('node:child_process'),
  };
}

export function getEntryFilePath(): string {
  return path.fromFileUrl(import.meta.url);
}

export async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch (_: unknown) {
    return false;
  }
}

export async function getRepositoryPath(): Promise<string> {
  let candidate = path.dirname(getEntryFilePath());
  while (!(await dirExists(path.join(candidate, '.git')))) {
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
    debugger;
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
 * Executes a command line interface command and waits for it to complete.
 *
 * @param cmd - The command to execute
 * @param args - Additional arguments to pass to the command
 * @returns A promise that resolves with the result string and exit code
 *
 * @example
 * ```ts
 * const { result, exitCode } = await cli('deno', 'run', 'app.ts');
 * ```
 */
export async function cli(cmd: string, ...args: string[]): Promise<CliResult> {
  console.log(`Running: ${cmd} ${args.join(' ')}`);
  if (typeof Deno !== 'undefined') {
    const process = new Deno.Command(cmd, {
      args,
      stdout: 'piped',
      stderr: 'piped',
    });
    const { stdout, stderr, code } = await process.output();
    const decoder = new TextDecoder();
    const output = decoder.decode(stdout) + decoder.decode(stderr);
    return { result: output, exitCode: code };
  } else {
    // Node.js environment
    if (!nodeModules) {
      throw new Error('Node.js modules not available');
    }
    const { spawn } = nodeModules.childProcess;
    return new Promise((resolve) => {
      let result = '';
      const process = spawn(cmd, args);

      process.stdout.on('data', (data: Stringable) => {
        result += data.toString();
      });

      process.stderr.on('data', (data: Stringable) => {
        result += data.toString();
      });

      process.on('close', (code: number | null) => {
        resolve({ result, exitCode: code ?? 0 });
      });
    });
  }
}
