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
import type { FileImpl } from '../../json-log/file-impl-interface.ts';

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
    // deno-lint-ignore no-explicit-any no-process-global
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

    return {
      runtime: 'node',
      os: os?.platform?.() || proc?.platform,
      arch: os?.arch?.() || proc?.arch,
      version: proc?.versions?.node,
    };
  },

  getCWD(): string {
    // deno-lint-ignore no-explicit-any
    return (globalThis as any).process?.cwd?.() || '/';
  },

  async getTempDir(): Promise<string> {
    // deno-lint-ignore no-explicit-any
    const os = (globalThis as any).require?.('node:os');
    if (os?.tmpdir) {
      return os.tmpdir();
    }
    // deno-lint-ignore no-explicit-any
    const proc = (globalThis as any).process;
    return proc?.env?.TMPDIR || proc?.env?.TMP || proc?.env?.TEMP || '/tmp';
  },

  getOS(): string {
    // deno-lint-ignore no-explicit-any
    const os = (globalThis as any).require?.('node:os');
    if (os?.platform) {
      return os.platform();
    }
    // deno-lint-ignore no-explicit-any
    return (globalThis as any).process?.platform || 'unknown';
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
};
