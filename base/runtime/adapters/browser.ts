/**
 * Browser Runtime Adapter
 *
 * Implements RuntimeAdapter for browser environments.
 * Uses OPFS for file I/O.
 */

import type {
  RuntimeAdapter,
  RuntimeTestConfig,
  SystemInfo,
} from '../index.ts';
import type { FileImpl } from '../../json-log/file-impl-interface.ts';

/**
 * Browser-specific RuntimeAdapter implementation.
 */
export const BrowserAdapter: RuntimeAdapter = {
  id: 'browser',

  detect(): boolean {
    // Browser detection: has 'self' global but not Deno
    try {
      // deno-lint-ignore no-explicit-any
      const hasSelf = typeof (globalThis as any).self !== 'undefined';
      // deno-lint-ignore no-explicit-any
      const hasDeno = typeof (globalThis as any).Deno !== 'undefined';
      return hasSelf && !hasDeno;
    } catch {
      return false;
    }
  },

  isInteractiveTTY(): boolean {
    // Browsers don't have TTY
    return false;
  },

  async createFileImpl(): Promise<FileImpl<unknown>> {
    const { FileImplOPFS } = await import('../../json-log/file-impl-opfs.ts');
    return FileImplOPFS;
  },

  createWorker(code: string): Worker {
    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    return new Worker(url, { type: 'module' });
  },

  getSystemInfo(): SystemInfo {
    const info: SystemInfo = {
      runtime: 'browser',
    };

    // Try to extract browser info from navigator
    try {
      if (typeof navigator !== 'undefined') {
        // deno-lint-ignore no-explicit-any
        const nav = navigator as any;
        // Get platform if available
        if (nav.platform) {
          // deno-lint-ignore no-explicit-any
          (info as any).os = nav.platform;
        }
        // Get user agent for version info
        if (nav.userAgent) {
          // deno-lint-ignore no-explicit-any
          (info as any).version = nav.userAgent;
        }
      }
    } catch {
      // Ignore errors accessing navigator
    }

    return info;
  },

  getCWD(): string {
    // Browser doesn't have a working directory concept
    // Return root for OPFS paths
    return '/';
  },

  async getTempDir(): Promise<string> {
    // Return a standard temp location in OPFS
    return '/temp';
  },

  getOS(): string {
    // Try to detect from navigator.platform
    try {
      if (typeof navigator !== 'undefined' && navigator.platform) {
        const platform = navigator.platform.toLowerCase();
        if (platform.includes('win')) return 'windows';
        if (platform.includes('mac')) return 'darwin';
        if (platform.includes('linux')) return 'linux';
        return platform;
      }
    } catch {
      // Ignore errors
    }
    return 'browser';
  },

  terminalSize(): { cols: number; rows: number } {
    // Browsers don't have terminal dimensions
    return { cols: 80, rows: 24 };
  },

  testConfig: Object.freeze({
    // OPFS needs delay for handle release
    cleanupDelayMs: 10,
    // Browser cannot create HTTP servers
    supportsHttpServer: false,
    // Default DB config for tests
    dbDefaults: { trusted: true },
  }) as RuntimeTestConfig,
};
