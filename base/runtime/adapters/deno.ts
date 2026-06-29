/**
 * Deno Runtime Adapter
 *
 * Implements RuntimeAdapter for Deno environments.
 * Uses Deno's native APIs for file I/O and system info.
 */

import type {
  RuntimeAdapter,
  RuntimeTestConfig,
  SystemInfo,
} from '../index.ts';
import type { OperatingSystem } from '../../os.ts';
import type { FileImpl } from '../../json-log/file-impl-interface.ts';
import { log } from '../../../logging/log.ts';
import {
  browserOpenCommand,
  invalidBrowserOpenUrlReason,
  isBrowserOpenUrl,
} from '../browser-open.ts';
import { wrapAsyncSignalHandler } from '../index.ts';

/**
 * Deno-specific RuntimeAdapter implementation.
 */
export const DenoAdapter: RuntimeAdapter = {
  id: 'deno',

  detect(): boolean {
    // Primary detection: WinterCG navigator.userAgent
    try {
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.userAgent === 'string' &&
        navigator.userAgent.startsWith('Deno/')
      ) {
        return true;
      }
    } catch {
      // navigator might not be accessible
    }

    // Fallback detection: Deno global
    try {
      // deno-lint-ignore no-explicit-any
      return typeof (globalThis as any).Deno !== 'undefined' &&
        // deno-lint-ignore no-explicit-any
        (globalThis as any).Deno.build !== undefined;
    } catch {
      return false;
    }
  },

  isInteractiveTTY(): boolean {
    try {
      // Deno 1.40+ uses isTerminal(), older versions use isatty()
      // deno-lint-ignore no-explicit-any
      const stdout = (Deno as any).stdout;
      if (typeof stdout?.isTerminal === 'function') {
        return stdout.isTerminal();
      }
      // Fallback for older Deno versions
      // deno-lint-ignore no-explicit-any
      if (typeof (Deno as any).isatty === 'function') {
        // deno-lint-ignore no-explicit-any
        return (Deno as any).isatty(stdout.rid);
      }
      return false;
    } catch {
      return false;
    }
  },

  async createFileImpl(): Promise<FileImpl<unknown>> {
    const { FileImplDeno } = await import('../../json-log/file-impl-deno.ts');
    return FileImplDeno;
  },

  createWorker(code: string): Worker {
    // Encode to base64 using Deno's built-in btoa
    const dataUrl = `data:text/javascript;base64,${btoa(code)}`;
    return new Worker(import.meta.resolve(dataUrl), { type: 'module' });
  },

  getSystemInfo(): SystemInfo {
    return {
      runtime: 'deno',
      os: Deno.build.os,
      arch: Deno.build.arch,
      version: Deno.version.deno,
      target: Deno.build.target,
      vendor: Deno.build.vendor,
      env: Deno.build.env ?? null,
    };
  },

  getArgs(): string[] {
    return [...Deno.args];
  },

  isMainModule(moduleUrl: string): boolean {
    try {
      const mainModule = (Deno as { mainModule?: string }).mainModule;
      return typeof mainModule === 'string' &&
        new URL(moduleUrl).href === new URL(mainModule).href;
    } catch {
      return false;
    }
  },

  getCWD(): string {
    return Deno.cwd();
  },

  getTempDir(): Promise<string> {
    // Deno.makeTempDir would create a new dir each time
    // Instead return the system temp directory
    const tempDir = Deno.env.get('TMPDIR') ||
      Deno.env.get('TMP') ||
      Deno.env.get('TEMP') ||
      '/tmp';
    return Promise.resolve(tempDir);
  },

  getExecPath(): string {
    return Deno.execPath();
  },

  getOS(): OperatingSystem {
    return Deno.build.os;
  },

  terminalSize(): { cols: number; rows: number } {
    try {
      // deno-lint-ignore no-explicit-any
      const size = (Deno as any).consoleSize?.();
      if (size) {
        return { cols: size.columns || 80, rows: size.rows || 24 };
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

  openBrowser(url: string): Promise<void> {
    if (!isBrowserOpenUrl(url)) {
      log({
        severity: 'WARNING',
        error: 'BadRequest',
        message: 'Refusing to open invalid browser URL ' +
          `(${invalidBrowserOpenUrlReason(url)}).`,
      });
      return Promise.resolve();
    }
    const os = this.getOS();
    const resolved = browserOpenCommand(os, url);
    if (!resolved) {
      log({
        severity: 'WARNING',
        error: 'MissingConfiguration',
        message: `Unable to open browser on unsupported OS: ${os}`,
      });
      return Promise.resolve();
    }
    const { cmd, args } = resolved;

    try {
      const process = new Deno.Command(cmd, {
        args,
        stdout: 'null',
        stderr: 'null',
      }).spawn();
      process.status.then(({ success, code }) => {
        if (!success) {
          log({
            severity: 'WARNING',
            error: 'MissingConfiguration',
            message: `Failed opening browser. Command: ${cmd}. Code: ${code}`,
          });
        }
      }).catch((err) => {
        log({
          severity: 'WARNING',
          error: 'MissingConfiguration',
          message: `Failed opening browser. Command: ${cmd}. Error: ${err}`,
        });
      });
    } catch (err) {
      log({
        severity: 'WARNING',
        error: 'MissingConfiguration',
        message: `Failed opening browser. Command: ${cmd}. Error: ${err}`,
      });
    }
    return Promise.resolve();
  },

  setupSignalHandler(
    signal: string,
    handler: () => Promise<void> | void,
  ): () => void {
    const wrapped = wrapAsyncSignalHandler(handler, signal);
    Deno.addSignalListener(signal as Deno.Signal, wrapped);
    return () => {
      try {
        Deno.removeSignalListener(signal as Deno.Signal, wrapped);
      } catch {
        // Ignore cleanup races during shutdown.
      }
    };
  },

  exit(code: number): never {
    Deno.exit(code);
  },
};
