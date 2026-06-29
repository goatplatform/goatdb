/**
 * Node.js Runtime Adapter
 *
 * Implements RuntimeAdapter for Node.js environments.
 * Uses Node.js native modules for file I/O and system info.
 */

import type {
  RuntimeAdapter,
  RuntimeTestConfig,
  SystemInfo,
} from '../index.ts';
import type { OperatingSystem } from '../../os.ts';
import { normalizeNodePlatform } from '../../os.ts';
// Keep Node builtins out of module scope so this adapter can be loaded in
// non-Node hosts during runtime detection. Main-module detection therefore
// uses URL + string normalization instead of top-level node:path/node:url imports.
import type { FileImpl } from '../../json-log/file-impl-interface.ts';
import { log } from '../../../logging/log.ts';
import {
  browserOpenCommand,
  invalidBrowserOpenUrlReason,
  isBrowserOpenUrl,
} from '../browser-open.ts';
import { notReached } from '../../error.ts';
import { wrapAsyncSignalHandler } from '../index.ts';

/** Normalizes path separators: \\ → / */
function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Returns true for paths starting with //host/share */
function isUNCPath(p: string): boolean {
  return /^\/\/[^/]/.test(p);
}

/**
 * Resolves `.` and `..` segments within a path segment list.
 * `uncSegCount` is the number of leading UNC host+share segments to protect
 * from parent-directory traversal (0 if the path is not UNC).
 */
function resolvePathSegments(
  segments: string[],
  uncSegCount: number,
  isAbs: boolean,
): string[] {
  // Pre-populate with protected UNC host+share segments.
  const result: string[] = segments.slice(0, uncSegCount);
  for (let i = uncSegCount; i < segments.length; i++) {
    const s = segments[i];
    if (s === '..') {
      if (result.length > uncSegCount && result[result.length - 1] !== '..') {
        result.pop();
      } else if (!isAbs) {
        result.push('..');
      }
    } else if (s !== '.') {
      result.push(s);
    }
  }
  return result;
}

/**
 * Normalizes a filesystem path for main-module comparison.
 * Converts backslashes to forward slashes, resolves `.` and `..` segments,
 * and preserves UNC paths with host/share protection from parent traversal.
 *
 * On Windows, canonicalizes to lowercase for case-insensitive comparison
 * against process.argv[1] (guarded by runtime platform check so non-Windows
 * hosts don't incorrectly lowercase paths that happen to match the pattern).
 *
 * @param path - A filesystem path (absolute or relative, may use \ separators)
 * @returns The normalized path with / separators and resolved segments
 * @internal Exported for testing only — not part of the public API.
 */
export function normalizeMainModulePath(path: string): string {
  const normalized = normalizeSlashes(path);
  const isUNC = isUNCPath(normalized);
  const isAbs = isUNC || normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized);
  const segments = normalized.split('/').filter(Boolean);
  const uncSegCount = isUNC ? Math.min(2, segments.length) : 0;
  const resolved = resolvePathSegments(segments, uncSegCount, isAbs);

  let result = resolved.join('/');
  if (isUNC) result = '//' + result;
  else if (normalized.startsWith('/')) result = '/' + result;

  // Windows and UNC paths are case-insensitive; canonicalize before comparing
  // the file URL against process.argv[1]. Guard with platform check so
  // non-Windows hosts don't incorrectly lowercase paths that happen to match
  // the Windows pattern (e.g. in tests).
  if (
    (isUNC || /^[A-Za-z]:\//.test(result)) &&
    (globalThis as any).process?.platform === 'win32'
  ) result = result.toLowerCase();
  return result || '.';
}

/** @internal Exported for testing only — not part of the public API. */
export function resolveMainModuleEntry(entry: string, cwd: string): string {
  const normalizedEntry = entry.replace(/\\/g, '/');
  const normalizedCwd = cwd.replace(/\\/g, '/');
  const isAbs = /^\/\/[^/]/.test(normalizedEntry) ||
    normalizedEntry.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalizedEntry);
  if (isAbs) return normalizeMainModulePath(normalizedEntry);
  const base = normalizedCwd === '/' ? '' : normalizedCwd;
  return normalizeMainModulePath(`${base}/${normalizedEntry}`);
}

/** @internal Exported for testing only — not part of the public API. */
export function fileUrlToMainModulePath(moduleUrl: string): string {
  const url = new URL(moduleUrl);
  if (url.protocol !== 'file:') {
    throw new TypeError('Node main-module detection only supports file URLs');
  }
  let path = decodeURIComponent(url.pathname);
  if (url.host && url.host !== 'localhost') {
    return normalizeMainModulePath(`//${url.host}${path}`);
  }
  if (/^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  return normalizeMainModulePath(path);
}

function realpathMainModulePath(path: string): string {
  const normalized = normalizeMainModulePath(path);
  try {
    // Node ESM resolves import.meta.url to the real file path, while
    // process.argv[1] preserves the invoked path. Realpath both sides so
    // symlinked entrypoints still count as the main module.
    // deno-lint-ignore no-explicit-any
    const fs = (globalThis as any).process?.getBuiltinModule?.('node:fs');
    const realpathSync = fs?.realpathSync;
    if (typeof realpathSync === 'function') {
      const resolved = typeof realpathSync.native === 'function'
        ? realpathSync.native(normalized)
        : realpathSync(normalized);
      return normalizeMainModulePath(resolved);
    }
  } catch {
    // Fall back to string normalization when realpath lookup is unavailable.
  }
  return normalized;
}

/**
 * Node.js-specific RuntimeAdapter implementation.
 */
export const NodeAdapter: RuntimeAdapter = {
  id: 'node',

  detect(): boolean {
    // Primary detection: WinterCG navigator.userAgent (Node.js 21+)
    try {
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.userAgent === 'string' &&
        navigator.userAgent.startsWith('Node.js/')
      ) {
        return true;
      }
    } catch {
      // navigator might not be accessible
    }

    // Fallback detection: process.versions.node
    try {
      // deno-lint-ignore no-explicit-any
      const proc = (globalThis as any).process;
      if (proc?.versions?.node && !proc?.versions?.deno) {
        return true;
      }
    } catch {
      // process might not be accessible
    }

    return false;
  },

  isInteractiveTTY(): boolean {
    try {
      // deno-lint-ignore no-explicit-any
      return (globalThis as any).process?.stdout?.isTTY === true;
    } catch {
      return false;
    }
  },

  async createFileImpl(): Promise<FileImpl<unknown>> {
    const { FileImplNode } = await import('../../json-log/file-impl-node.ts');
    return FileImplNode;
  },

  createWorker(code: string): unknown {
    // Lazy require keeps node:worker_threads out of non-Node bundle analysis.
    // deno-lint-ignore no-explicit-any
    const { Worker } = (globalThis as any).require('node:worker_threads');
    // deno-lint-ignore no-process-global
    const inspect = process.execArgv.includes('--inspect-brk') ||
      // deno-lint-ignore no-process-global
      process.execArgv.includes('--inspect');
    return new Worker(
      'data:' + code,
      {
        eval: true,
        name: 'json-log-worker',
        execArgv: inspect ? ['--inspect'] : [],
      },
    );
  },

  getSystemInfo(): SystemInfo {
    // deno-lint-ignore no-explicit-any
    const proc = (globalThis as any).process;
    // deno-lint-ignore no-explicit-any
    const os = (globalThis as any).require?.('node:os');
    const platform = os?.platform?.() || proc?.platform;
    const arch = os?.arch?.() || proc?.arch;

    const osName = normalizeNodePlatform(platform || 'unknown');

    return {
      runtime: 'node',
      os: osName,
      arch,
      version: proc?.versions?.node,
      target: arch ? `${osName}-${arch}` : undefined,
      vendor: 'node',
      env: null,
    };
  },

  getArgs(): string[] {
    // deno-lint-ignore no-explicit-any
    return [...(((globalThis as any).process?.argv?.slice(2)) ?? [])];
  },

  isMainModule(moduleUrl: string): boolean {
    try {
      // deno-lint-ignore no-explicit-any
      const proc = (globalThis as any).process;
      const entry = proc?.argv?.[1];
      const cwd = proc?.cwd?.();
      if (typeof entry !== 'string' || typeof cwd !== 'string') return false;
      return realpathMainModulePath(fileUrlToMainModulePath(moduleUrl)) ===
        realpathMainModulePath(resolveMainModuleEntry(entry, cwd));
    } catch (err) {
      log({
        severity: 'WARNING',
        message: `isMainModule failed for URL "${moduleUrl}": ${err}`,
      });
      return false;
    }
  },

  getCWD(): string {
    // deno-lint-ignore no-explicit-any
    return (globalThis as any).process?.cwd?.() || '/';
  },

  getTempDir(): Promise<string> {
    // deno-lint-ignore no-explicit-any
    const os = (globalThis as any).require?.('node:os');
    if (os?.tmpdir) {
      return Promise.resolve(os.tmpdir());
    }
    // deno-lint-ignore no-explicit-any
    const proc = (globalThis as any).process;
    return Promise.resolve(
      proc?.env?.TMPDIR || proc?.env?.TMP || proc?.env?.TEMP || '/tmp',
    );
  },

  getExecPath(): string {
    // deno-lint-ignore no-explicit-any
    const execPath = (globalThis as any).process?.execPath;
    if (!execPath) {
      // Defensive throw — proc.execPath is required by Node's contract,
      // and the process would be in an unrecoverable state if missing.
      throw new Error('getExecPath() is not available in this environment');
    }
    return execPath;
  },

  getOS(): OperatingSystem {
    // deno-lint-ignore no-explicit-any
    const os = (globalThis as any).require?.('node:os');
    const platform: string = os?.platform?.() ||
      // deno-lint-ignore no-explicit-any
      (globalThis as any).process?.platform || 'unknown';
    return normalizeNodePlatform(platform);
  },

  terminalSize(): { cols: number; rows: number } {
    try {
      // deno-lint-ignore no-explicit-any
      const proc = (globalThis as any).process;
      if (proc?.stdout) {
        return {
          cols: proc.stdout.columns || 80,
          rows: proc.stdout.rows || 24,
        };
      }
    } catch {
      // Ignore errors
    }
    return { cols: 80, rows: 24 };
  },

  testConfig: Object.freeze({
    cleanupDelayMs: 0,
    supportsHttpServer: true,
    dbDefaults: { trusted: true },
  }) as RuntimeTestConfig,

  async openBrowser(url: string): Promise<void> {
    if (!isBrowserOpenUrl(url)) {
      log({
        severity: 'WARNING',
        error: 'BadRequest',
        message: 'Refusing to open invalid browser URL ' +
          `(${invalidBrowserOpenUrlReason(url)}).`,
      });
      return;
    }
    const os = this.getOS();
    const resolved = browserOpenCommand(os, url);
    if (!resolved) {
      log({
        severity: 'WARNING',
        error: 'MissingConfiguration',
        message: `Unable to open browser on unsupported OS: ${os}`,
      });
      return;
    }
    const { cmd, args } = resolved;

    try {
      const { spawn } = await import('node:child_process');
      const child = spawn(cmd, args, {
        stdio: 'ignore',
      });
      child.on('error', (err) => {
        log({
          severity: 'WARNING',
          error: 'MissingConfiguration',
          message: `Failed opening browser. Command: ${cmd}. Error: ${err}`,
        });
      });
      child.unref();
    } catch (err) {
      log({
        severity: 'WARNING',
        error: 'MissingConfiguration',
        message: `Failed opening browser. Error: ${err}`,
      });
    }
  },

  setupSignalHandler(
    signal: string,
    handler: () => Promise<void> | void,
  ): () => void {
    // deno-lint-ignore no-explicit-any
    const proc = (globalThis as any).process;
    const wrapped = wrapAsyncSignalHandler(handler, signal);
    proc.on(signal, wrapped);
    return () => {
      try {
        proc.off(signal, wrapped);
      } catch {
        // Ignore cleanup races during shutdown.
      }
    };
  },

  exit(code: number): never {
    // deno-lint-ignore no-explicit-any
    const proc = (globalThis as any).process;
    proc.exit(code);
    return notReached('exit() should not return');
  },
};
