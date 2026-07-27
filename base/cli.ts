import { isWindows } from './os.ts';
import { getEffectiveCWD, getEffectiveRuntimeId } from './runtime/index.ts';
import { log } from '../logging/log.ts';
import { resolveWindowsCommand } from './windows-cli.ts';

// Minimal type for objects with a toString method (used in Node.js streams)
type Stringable = { toString(): string };

// Cache Node.js child_process module (loaded lazily)
let childProcessModule: any = undefined;

/** Result of a CLI command execution. */
export interface CliResult {
  /** The combined stdout and stderr output. */
  result: string;
  /** The process exit code. */
  exitCode: number;
}

/** Options for CLI command execution. */
export interface CliOptions {
  /** Working directory for the command. */
  cwd?: string;
  /** Timeout in milliseconds. Process is killed if it exceeds this. */
  timeout?: number;
}

function isCliOptions(arg: unknown): arg is CliOptions {
  return typeof arg === 'object' && arg !== null && !Array.isArray(arg);
}

function splitCliArguments(args: (string | CliOptions)[]): {
  options: CliOptions;
  commandArgs: string[];
} {
  const lastArg = args[args.length - 1];
  return args.length > 0 && isCliOptions(lastArg)
    ? { options: lastArg, commandArgs: args.slice(0, -1) as string[] }
    : { options: {}, commandArgs: args as string[] };
}

function timeoutResult(timeout: number): CliResult {
  return { result: `Process timed out after ${timeout}ms`, exitCode: 124 };
}

function logTimeout(timeout: number, command: string, args: string[]): void {
  log({
    severity: 'WARNING',
    message: `CLI subprocess timed out after ${timeout}ms: ${command} ${
      args.join(' ')
    }`,
  });
}

async function runDenoCommand(
  command: string,
  args: string[],
  options: CliOptions,
): Promise<CliResult> {
  const execution = isWindows()
    ? await resolveWindowsCommand(
      command,
      args,
      options.cwd ?? getEffectiveCWD(),
    )
    : { command, args };
  const controller = options.timeout ? new AbortController() : undefined;
  const timer = controller && options.timeout
    ? setTimeout(() => controller.abort(), options.timeout)
    : undefined;
  try {
    const process = new Deno.Command(execution.command, {
      args: execution.args,
      stdout: 'piped',
      stderr: 'piped',
      cwd: options.cwd,
      signal: controller?.signal,
    }).spawn();
    const { stdout, stderr, code } = await process.output();
    if (controller?.signal.aborted) {
      logTimeout(options.timeout!, command, args);
      return timeoutResult(options.timeout!);
    }
    const decoder = new TextDecoder();
    return {
      result: decoder.decode(stdout) + decoder.decode(stderr),
      exitCode: code,
    };
  } catch (error: unknown) {
    if (controller?.signal.aborted) {
      logTimeout(options.timeout!, command, args);
      return timeoutResult(options.timeout!);
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function getChildProcess(): Promise<any> {
  childProcessModule ??= await import('node:child_process');
  return childProcessModule;
}

function nodeSpawnOptions(options: CliOptions): Record<string, unknown> {
  return options.cwd ? { cwd: options.cwd } : {};
}

function killWindowsProcessTree(proc: any, spawn: any): void {
  try {
    if (proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f']);
  } catch (_) {
    // The process may already have exited before taskkill starts.
  }
}

function killNodeProcess(proc: any, signal: 'SIGTERM' | 'SIGKILL'): void {
  try {
    proc.kill(signal);
  } catch (_) {
    // The process may already have exited before the signal is sent.
  }
}

function startNodeTimeout(
  proc: any,
  spawn: any,
  command: string,
  args: string[],
  timeout: number,
  onTimeout: () => void,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    onTimeout();
    logTimeout(timeout, command, args);
    if (isWindows()) return killWindowsProcessTree(proc, spawn);
    killNodeProcess(proc, 'SIGTERM');
  }, timeout);
}

function forceKillAfterGracePeriod(proc: any): ReturnType<typeof setTimeout> {
  return setTimeout(() => killNodeProcess(proc, 'SIGKILL'), 2_000);
}

async function runNodeCommand(
  command: string,
  args: string[],
  options: CliOptions,
): Promise<CliResult> {
  const { spawn } = await getChildProcess();
  const execution = isWindows()
    ? await resolveWindowsCommand(
      command,
      args,
      options.cwd ?? getEffectiveCWD(),
    )
    : { command, args };
  return new Promise((resolve) => {
    let result = '';
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const proc = spawn(
      execution.command,
      execution.args,
      nodeSpawnOptions(options),
    );
    const settle = (value: CliResult) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve(value);
    };
    if (options.timeout) {
      timer = startNodeTimeout(
        proc,
        spawn,
        command,
        args,
        options.timeout,
        () => {
          timedOut = true;
          if (!isWindows()) killTimer = forceKillAfterGracePeriod(proc);
        },
      );
    }
    proc.stdout.on('data', (data: Stringable) => result += data.toString());
    proc.stderr.on('data', (data: Stringable) => result += data.toString());
    proc.on('close', (code: number | null) => {
      settle(
        timedOut
          ? timeoutResult(options.timeout!)
          : { result, exitCode: code ?? 0 },
      );
    });
    proc.on(
      'error',
      (error: Error) => settle({ result: error.message, exitCode: 1 }),
    );
  });
}

/** Executes a command and captures its combined stdout and stderr output. */
export async function cli(
  command: string,
  ...args: (string | CliOptions)[]
): Promise<CliResult> {
  const { options, commandArgs } = splitCliArguments(args);
  switch (getEffectiveRuntimeId()) {
    case 'deno':
      return await runDenoCommand(command, commandArgs, options);
    case 'node':
      return await runNodeCommand(command, commandArgs, options);
    default:
      throw new Error('CLI execution not supported in browser environment');
  }
}
