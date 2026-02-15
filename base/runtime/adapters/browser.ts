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
import type { OperatingSystem } from '../../os.ts';
import type { FileImpl } from '../../json-log/file-impl-interface.ts';
import { notReached } from '../../error.ts';

/**
 * Browser-specific RuntimeAdapter implementation.
 */
export const BrowserAdapter: RuntimeAdapter = {
  id: 'browser',

  detect(): boolean {
    // Browser detection: has 'self' global but not Deno or Node.js.
    // Node.js workers also define 'self' (alias for globalThis since v13),
    // so we must explicitly exclude them.
    try {
      // deno-lint-ignore no-explicit-any
      const g = globalThis as any;
      return typeof g.self !== 'undefined' &&
        typeof g.Deno === 'undefined' &&
        !(typeof g.process !== 'undefined' && g.process.versions?.node);
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
    const worker = new Worker(url, { type: 'module' });
    URL.revokeObjectURL(url);
    return worker;
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

  getExecPath(): string {
    return notReached('getExecPath() is not available in browser');
  },

  getOS(): OperatingSystem {
    try {
      // Tier 1: User-Agent Client Hints (Chrome 93+, Edge 93+)
      // deno-lint-ignore no-explicit-any
      const uaPlatform = typeof navigator !== 'undefined'
        ? (navigator as any).userAgentData?.platform
        : undefined;
      if (uaPlatform) {
        const p = uaPlatform.toLowerCase();
        if (p.includes('win')) return 'windows';
        if (p === 'macos' || p.includes('mac')) return 'darwin';
        if (p.includes('android')) return 'android';
        if (p.includes('linux')) return 'linux';
      }

      // Tier 2: navigator.platform (deprecated but universally supported)
      if (typeof navigator !== 'undefined' && navigator.platform) {
        const platform = navigator.platform.toLowerCase();
        if (platform.includes('win')) return 'windows';
        if (platform.includes('mac')) return 'darwin';
        if (platform.includes('linux')) {
          // Android reports platform as 'Linux armv...' — disambiguate via UA
          if (navigator.userAgent?.toLowerCase().includes('android')) {
            return 'android';
          }
          return 'linux';
        }
      }

      // Tier 3: User-Agent string (last resort)
      if (typeof navigator !== 'undefined' && navigator.userAgent) {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('windows')) return 'windows';
        if (ua.includes('mac os') || ua.includes('macintosh')) return 'darwin';
        if (ua.includes('android')) return 'android';
        if (ua.includes('linux')) return 'linux';
      }
    } catch {
      // Ignore errors in restricted contexts
    }
    return 'unknown';
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
