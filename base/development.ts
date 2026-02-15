import { isDeno, isNode } from './common.ts';

// Minimal type for objects with a toString method (used in Node.js streams)
type Stringable = { toString(): string };

// Cache Node.js child_process module (loaded lazily)
let childProcessModule: any = undefined;

export async function copyToClipboard(value: string): Promise<boolean> {
  if (!isDeno()) return false;
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
  /** Timeout in milliseconds. Process is killed if it exceeds this. */
  timeout?: number;
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
export async function cli(
  cmd: string,
  ...args: (string | CliOptions)[]
): Promise<CliResult> {
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

  if (isDeno()) {
    const ac = options.timeout ? new AbortController() : undefined;
    let timer: number | undefined;
    if (ac && options.timeout) {
      timer = setTimeout(
        () => ac.abort(),
        options.timeout,
      ) as unknown as number;
    }
    const process = new Deno.Command(cmd, {
      args: cmdArgs,
      stdout: 'piped',
      stderr: 'piped',
      cwd: options.cwd,
      signal: ac?.signal,
    });
    try {
      const { stdout, stderr, code } = await process.output();
      const decoder = new TextDecoder();
      const output = decoder.decode(stdout) + decoder.decode(stderr);
      return { result: output, exitCode: code };
    } catch (e: unknown) {
      if (ac?.signal.aborted) {
        return {
          result: `Process timed out after ${options.timeout}ms`,
          exitCode: 124,
        };
      }
      throw e;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } else if (isNode()) {
    // Node.js environment - lazy load child_process module
    if (!childProcessModule) {
      childProcessModule = await import('node:child_process');
    }
    const { spawn } = childProcessModule;
    return new Promise((resolve) => {
      let result = '';
      const spawnOptions: Record<string, unknown> = {};
      if (options.cwd) spawnOptions.cwd = options.cwd;

      const proc = spawn(cmd, cmdArgs, spawnOptions);
      let settled = false;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      function settle(value: CliResult): void {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        resolve(value);
      }

      if (options.timeout) {
        timer = setTimeout(() => {
          timedOut = true;
          try {
            proc.kill('SIGTERM');
          } catch (_) {
            // Process already exited
          }
          killTimer = setTimeout(() => {
            try {
              proc.kill('SIGKILL');
            } catch (_) {
              // Process already exited
            }
          }, 2_000);
        }, options.timeout);
      }

      proc.stdout.on('data', (data: Stringable) => {
        result += data.toString();
      });

      proc.stderr.on('data', (data: Stringable) => {
        result += data.toString();
      });

      proc.on('close', (code: number | null) => {
        if (timedOut) {
          settle({
            result: `Process timed out after ${options.timeout}ms`,
            exitCode: 124,
          });
        } else {
          settle({ result, exitCode: code ?? 0 });
        }
      });

      proc.on('error', (err: Error) => {
        settle({ result: err.message, exitCode: 1 });
      });
    });
  } else {
    throw new Error('CLI execution not supported in browser environment');
  }
}
