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
import type { FileImpl } from '../../json-log/file-impl-interface.ts';
import { notReached } from '../../error.ts';
import { log } from '../../../logging/log.ts';

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
    // Dynamic import to avoid bundling node:worker_threads in browser builds
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

    return {
      runtime: 'node',
      os: normalizeNodePlatform(platform || 'unknown'),
      arch: os?.arch?.() || proc?.arch,
      version: proc?.versions?.node,
    };
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
      return notReached('getExecPath() is not available in this environment');
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
    const os = this.getOS();
    try {
      // Lazy-load child_process
      const { spawn } = await import('node:child_process');
      let cmd: string;
      let args: string[];

      if (os === 'darwin') {
        cmd = 'open';
        args = [url];
      } else if (os === 'linux') {
        cmd = 'xdg-open';
        args = [url];
      } else if (os === 'windows') {
        cmd = 'cmd';
        args = ['/c', 'start', url];
      } else {
        log({
          severity: 'WARNING',
          error: 'MissingConfiguration',
          message: `Unable to open browser on unsupported OS: ${os}`,
        });
        return;
      }

      const child = spawn(cmd, args, {
        shell: os === 'windows',
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
  ): void {
    // deno-lint-ignore no-explicit-any
    const proc = (globalThis as any).process;
    proc.on(signal, () => {
      const result = handler();
      if (result instanceof Promise) {
        result.catch((err) => {
          log({
            severity: 'ERROR',
            error: 'UncaughtServerError',
            message: `Signal handler for ${signal} failed: ${err}`,
          });
        });
      }
    });
  },

  exit(code: number): never {
    // deno-lint-ignore no-explicit-any
    const proc = (globalThis as any).process;
    proc.exit(code);
    return notReached('exit() should not return');
  },
};
