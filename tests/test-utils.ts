/**
 * Shared test utilities for GoatDB tests.
 *
 * Consolidates commonly-reimplemented helpers into one location.
 */
import type { LogEntry, LogStream } from '../logging/log.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';
import type { PluginBuild } from 'esbuild';
import {
  getGlobalLoggerStreams,
  newLogger,
  setGlobalLoggerStreams,
} from '../logging/log.ts';
import * as path from '../base/path.ts';
import { writeTextFile } from '../base/json-log/file-impl.ts';
import {
  getRuntime,
  withTestCWD as _withTestCWD,
} from '../base/runtime/index.ts';

/**
 * Swaps in a capturing log stream for the duration of `fn`, then restores
 * the original streams. The captured array is passed to the callback.
 */
export function withLogCapture<T>(
  fn: (captured: NormalizedLogEntry<LogEntry>[]) => Promise<T>,
): Promise<T> {
  const captured: NormalizedLogEntry<LogEntry>[] = [];
  const prev = getGlobalLoggerStreams();
  setGlobalLoggerStreams([{
    appendEntry(e: NormalizedLogEntry<LogEntry>): void {
      captured.push(e);
    },
  }]);
  return fn(captured).finally(() => setGlobalLoggerStreams(prev));
}

/**
 * Creates a logger backed by a capturing log stream.
 * Returns the captured entries array and the logger.
 */
export function createCapturedLogger(): {
  captured: NormalizedLogEntry<LogEntry>[];
  logger: ReturnType<typeof newLogger>;
} {
  const captured: NormalizedLogEntry<LogEntry>[] = [];
  const stream: LogStream = {
    appendEntry(e): void {
      captured.push(e);
    },
  };
  return {
    captured,
    logger: newLogger([stream]),
  };
}

/**
 * @internal Temporarily overrides the effective CWD for the duration of fn.
 * Delegates to the scoped _testCWD mechanism in base/runtime/index.ts
 * instead of mutating the runtime adapter singleton.
 */
export function withTestCWD<T>(
  cwd: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  return _withTestCWD(cwd, () => Promise.resolve(fn()));
}

// Node-only utility — lazy-initialized once at module scope.
let _realpathSync: ((p: string) => string) | undefined;
export async function getRealpathSync(): Promise<(p: string) => string> {
  if (!_realpathSync) {
    const mod = await import('node:fs');
    _realpathSync = mod.realpathSync;
  }
  return _realpathSync!;
}

export async function runNodeCommand(
  args: string[],
  cwd: string = getRuntime().getCWD(),
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { spawn } = await import('node:child_process');
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * Shared helper: creates a temp dir, writes an entry file, compiles to Node ESM,
 * spawns it, and asserts exit code 0. Used by Node adapter spawned-process tests.
 *
 * @param ctx - test context for tempDir
 * @param dirSuffix - unique suffix for the temp directory name
 * @param entryBody - the TypeScript source of the entry module body (no import needed)
 * @param runtimeUrl - file URL/path to base/runtime/index.ts
 * @param extraArgs - extra CLI arguments to pass to the spawned Node process
 */
export async function testNodeSpawnedEntry(
  ctx: { tempDir(suffix: string): Promise<string> },
  dirSuffix: string,
  entryBody: string[],
  runtimeUrl: string,
  extraArgs: string[] = [],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await ctx.tempDir(dirSuffix);
  const entryPath = path.join(dir, 'entry.ts');
  const outputPath = path.join(dir, 'entry.mjs');
  await writeTextFile(
    entryPath,
    [`import { getRuntime } from ${JSON.stringify(runtimeUrl)};`]
      .concat(entryBody)
      .join('\n'),
  );
  await compileToNodeEsm(entryPath, outputPath);
  const { realpathSync } = await import('node:fs');
  const result = await runNodeCommand(
    [realpathSync(outputPath), ...extraArgs],
    dir,
  );
  return result;
}

export async function compileToNodeEsm(
  inputFile: string,
  outputFile: string,
  stubbedImportPaths: Record<string, string> = {},
): Promise<void> {
  const { getEsbuild, runEsbuild, stopEsbuildWorker } = await import(
    '../build.ts'
  );
  const { dirname, join } = await import('node:path');
  const { existsSync } = await import('node:fs');
  const esbuild = await getEsbuild();
  const resolveLocalJsImports = {
    name: 'test-node-esm-local-js-imports',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^\.+\/.+\.js$/ }, (args: any) => {
        const resolved = join(dirname(args.importer), args.path);
        const tsPath = resolved.slice(0, -3) + '.ts';
        if (existsSync(tsPath)) return { path: tsPath, namespace: 'file' };
        const tsxPath = resolved.slice(0, -3) + '.tsx';
        return existsSync(tsxPath)
          ? { path: tsxPath, namespace: 'file' }
          : undefined;
      });
    },
  };
  const stubPlugin = {
    name: 'test-node-esm-stubs',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args: any) => {
        const stubPath = stubbedImportPaths[
          args.path as keyof typeof stubbedImportPaths
        ];
        return stubPath ? { path: stubPath, namespace: 'file' } : undefined;
      });
    },
  };

  try {
    await runEsbuild(() =>
      esbuild.build({
        entryPoints: [inputFile],
        outfile: outputFile,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node26',
        write: true,
        plugins: [resolveLocalJsImports, stubPlugin],
        logOverride: {
          'empty-import-meta': 'silent',
          'direct-eval': 'silent',
        },
      })
    );
  } finally {
    // Safe under sequential test execution — stopEsbuildWorker clears the
    // shared singleton worker. Must not be used concurrently within a suite.
    await stopEsbuildWorker();
  }
}
