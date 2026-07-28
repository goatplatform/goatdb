import { getEnvVar } from './os.ts';
import * as path from './path.ts';
import { getEffectiveRuntimeId } from './runtime/index.ts';

export interface WindowsCommand {
  command: string;
  args: string[];
  requiresRawWindowsCommandLine: boolean;
}

const kDefaultPathExtensions = ['.COM', '.EXE', '.BAT', '.CMD'];

function isBatchFile(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command);
}

function isPathLike(command: string): boolean {
  return /[\\/]/.test(command) || path.isAbsolute(command);
}

function pathExtensions(command: string): string[] {
  if (path.extname(command)) return [''];
  const pathext = getEnvVar('PATHEXT');
  return [
    '',
    ...(pathext?.split(';').filter(Boolean) ?? kDefaultPathExtensions),
  ];
}

function commandSearchPaths(command: string, cwd: string): string[] {
  if (isPathLike(command)) {
    return [path.isAbsolute(command) ? command : path.join(cwd, command)];
  }
  const directories = (getEnvVar('PATH') ?? '').split(';').filter(Boolean);
  return [cwd, ...directories.map((directory) => directory.replaceAll('"', ''))]
    .map((directory) => path.join(directory, command));
}

function commandCandidates(command: string, cwd: string): string[] {
  const extensions = pathExtensions(command);
  return commandSearchPaths(command, cwd).flatMap((candidate) =>
    extensions.map((extension) => candidate + extension)
  );
}

async function denoFileExists(candidate: string): Promise<boolean> {
  try {
    return (await Deno.stat(candidate)).isFile;
  } catch (_) {
    return false;
  }
}

async function nodeFileExists(candidate: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises');
    return (await stat(candidate)).isFile();
  } catch (_) {
    return false;
  }
}

function commandFileExists(candidate: string): Promise<boolean> {
  return getEffectiveRuntimeId() === 'deno'
    ? denoFileExists(candidate)
    : nodeFileExists(candidate);
}

async function resolveCommand(
  command: string,
  cwd: string,
): Promise<{ command: string; found: boolean }> {
  for (const candidate of commandCandidates(command, cwd)) {
    if (await commandFileExists(candidate)) {
      return { command: candidate, found: true };
    }
  }
  return { command, found: false };
}

function isAbsoluteCommandProcessor(
  value: string | undefined,
): value is string {
  return !!value && path.isAbsolute(value) &&
    path.basename(value).toLowerCase() === 'cmd.exe';
}

function systemCommandProcessor(): string | undefined {
  const systemRoot = getEnvVar('SystemRoot') ?? getEnvVar('WINDIR');
  return systemRoot && path.isAbsolute(systemRoot)
    ? path.join(systemRoot, 'System32', 'cmd.exe')
    : undefined;
}

function windowsCommandProcessor(): string {
  const comSpec = getEnvVar('ComSpec') ?? getEnvVar('COMSPEC');
  if (isAbsoluteCommandProcessor(comSpec)) return comSpec;
  const fallback = systemCommandProcessor();
  if (fallback) return fallback;
  throw new Error('Windows command processor must be an absolute cmd.exe path');
}

function assertSafeBatchValues(values: string[]): void {
  if (values.some((value) => value.includes('%'))) {
    throw new Error(
      'Cannot execute a batch command with literal "%": cmd.exe expands environment variables',
    );
  }
  if (values.some((value) => value.includes('!'))) {
    throw new Error(
      'Cannot execute a batch command with literal "!": cmd.exe delayed expansion corrupts values',
    );
  }
  if (values.some((value) => /[\r\n]/.test(value))) {
    throw new Error('Cannot execute a batch command with a line break');
  }
}

function quoteBatchValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function serializeBatchCommand(command: string, args: string[]): string {
  const values = [command, ...args];
  assertSafeBatchValues(values);
  return `"${values.map(quoteBatchValue).join(' ')}"`;
}

function batchCommand(command: string, args: string[]): WindowsCommand {
  return {
    command: windowsCommandProcessor(),
    args: ['/d', '/v:off', '/s', '/c', serializeBatchCommand(command, args)],
    requiresRawWindowsCommandLine: true,
  };
}

/** Resolves batch files before choosing whether a Windows shell is needed. */
export async function resolveWindowsCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<WindowsCommand> {
  const resolved = await resolveCommand(command, cwd);
  return resolved.found && isBatchFile(resolved.command)
    ? batchCommand(resolved.command, args)
    : {
      command: resolved.command,
      args,
      requiresRawWindowsCommandLine: false,
    };
}
