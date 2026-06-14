/**
 * Runtime Abstraction Layer
 *
 * Provides a unified interface for runtime-specific operations across
 * Deno, Node.js, and browser environments. The registry pattern allows
 * clean extensibility for future runtimes (Bun, Electron).
 *
 * Usage:
 * ```typescript
 * import { getRuntime } from './base/runtime/index.ts';
 *
 * const runtime = getRuntime();
 * console.log(runtime.id); // 'deno' | 'node' | 'browser'
 * const fileImpl = await runtime.createFileImpl();
 * ```
 */

import { notReached } from '../error.ts';
import type { FileImpl } from '../json-log/file-impl-interface.ts';
import type { OperatingSystem } from '../os.ts';
import { log } from '../../logging/log.ts';

/**
 * Identifies a JavaScript runtime environment.
 * Standard runtimes are 'deno', 'node', 'browser'.
 * Extensible to support 'bun', 'electron', or custom runtimes.
 */
export type RuntimeId =
  | 'deno'
  | 'node'
  | 'browser'
  | 'bun'
  | 'electron'
  | string;

/**
 * Platform-specific test configuration.
 * Each adapter provides values appropriate for its runtime.
 */
export interface RuntimeTestConfig {
  /** Delay in ms before cleanup (OPFS needs ~10ms for handle release) */
  readonly cleanupDelayMs: number;
  /** Whether the runtime supports creating HTTP servers */
  readonly supportsHttpServer: boolean;
  /** Default database configuration for tests (inlined to avoid base→db dependency) */
  readonly dbDefaults: { trusted?: boolean };
}

/**
 * System information structure.
 */
export interface SystemInfo {
  readonly runtime: RuntimeId;
  readonly os?: string;
  readonly arch?: string;
  readonly version?: string;
}

/**
 * Unified interface for runtime-specific operations.
 *
 * Each runtime (Deno, Node.js, Browser) provides an adapter that implements
 * this interface. The registry selects the appropriate adapter at runtime.
 */
export interface RuntimeAdapter {
  /** Unique identifier for this runtime */
  readonly id: RuntimeId;

  /**
   * Detects if this adapter matches the current environment.
   * Uses WinterCG navigator.userAgent as primary, with fallback checks.
   */
  detect(): boolean;

  /**
   * Checks if stdout is an interactive terminal (TTY).
   * Returns false in browsers or when output is piped.
   */
  isInteractiveTTY(): boolean;

  /**
   * Creates the appropriate FileImpl for this runtime.
   * - Deno: Deno.FsFile-based
   * - Node: fs.promises.FileHandle-based
   * - Browser: OPFS-based
   */
  createFileImpl(): Promise<FileImpl<unknown>>;

  /**
   * Creates a worker for background thread execution.
   * - Deno: Uses data URL with import.meta.resolve
   * - Node: Uses worker_threads with eval mode
   * - Browser: Uses Blob URL
   *
   * @param code - The JavaScript code to execute in the worker
   * @returns A Worker instance (platform-specific type)
   */
  createWorker(code: string): Worker | unknown;

  /**
   * Gets system information (OS, arch, runtime version).
   */
  getSystemInfo(): SystemInfo;

  /**
   * Gets the current working directory.
   * Browser returns '/' as root.
   */
  getCWD(): string;

  /**
   * Gets a temporary directory path.
   * Browser returns '/temp' in OPFS.
   */
  getTempDir(): Promise<string>;

  /**
   * Gets the path to the current runtime executable.
   * Throws in browsers (not applicable).
   */
  getExecPath(): string;

  /**
   * Gets the operating system identifier.
   */
  getOS(): OperatingSystem;

  /**
   * Gets terminal dimensions (columns and rows).
   * Returns default {cols: 80, rows: 24} if unavailable.
   */
  terminalSize(): { cols: number; rows: number };

  /**
   * Platform-specific test configuration.
   */
  readonly testConfig: RuntimeTestConfig;

  /**
   * Opens a validated http(s) URL in the default browser.
   * Uses platform-specific commands (open, xdg-open, start).
   *
   * @param url - The URL to open
   */
  openBrowser(url: string): Promise<void>;

  /**
   * Sets up a signal handler for the given signal.
   * Common signals: 'SIGTERM', 'SIGINT'.
   *
   * @param signal - The signal name (e.g., 'SIGTERM')
   * @param handler - The handler function to call
   */
  setupSignalHandler(
    signal: string,
    handler: () => Promise<void> | void,
  ): () => void;

  /**
   * Exits the process with the given exit code.
   * Throws in environments where process exit is not applicable (e.g., browser).
   * Browser test completion must use an explicit browser signaling API instead.
   *
   * @param code - The exit code
   */
  exit(code: number): never;
}

// ── Test hooks ──────────────────────────────────────────────────────────────
/** @internal Test-only: overrides getEffectiveRuntimeId(). */
let _testRuntimeId: string | undefined;
/** @internal Test-only: overrides getEffectiveCWD(). */
let _testCWD: string | undefined;
/** @internal Test-only: overrides browser opening. */
let _testOpenBrowser: ((url: string) => Promise<void>) | undefined;
// Note: module-level globals are safe under sequential test execution. If
// parallel test execution is ever enabled, these must move to a per-test
// isolation strategy (e.g. AsyncLocalStorage or test-scoped contexts).

async function withTestOverride<T, V>(
  get: () => V,
  set: (value: V) => void,
  value: V,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = get();
  set(value);
  try {
    return await fn();
  } finally {
    set(prev);
  }
}

/**
 * @internal Test-only scoped override for the effective runtime ID.
 *
 * IMPORTANT: This override only affects code that calls
 * `getEffectiveRuntimeId()`. Code that directly accesses platform globals
 * (`Deno.*`, `process.*`, `navigator.*`) will still use the host runtime's
 * actual globals. Tests that override to 'deno' on a Node host (or vice
 * versa) will crash if the code path touches those globals.
 *
 * Safe patterns:
 * - `withTestRuntimeId('browser', ...)` — browser branches use literals
 * - `withTestRuntimeId('node', ...)` on Deno — Deno provides Node compat
 *
 * Unsafe pattern:
 * - `withTestRuntimeId('deno', ...)` on Node — `Deno.*` globals don't exist
 */
export function withTestRuntimeId<T>(
  id: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withTestOverride(
    () => _testRuntimeId,
    (value) => {
      _testRuntimeId = value;
    },
    id,
    fn,
  );
}

/**
 * @internal Test-only scoped override for the effective CWD.
 */
export function withTestCWD<T>(
  dir: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withTestOverride(
    () => _testCWD,
    (value) => {
      _testCWD = value;
    },
    dir,
    fn,
  );
}

/**
 * @internal Test-only scoped override for browser opening.
 */
export function withTestOpenBrowser<T>(
  open: (url: string) => Promise<void>,
  fn: () => Promise<T>,
): Promise<T> {
  return withTestOverride(
    () => _testOpenBrowser,
    (value) => {
      _testOpenBrowser = value;
    },
    open,
    fn,
  );
}

/**
 * Returns the effective runtime ID.
 * In production, delegates to `getRuntime().id`. Tests can override via
 * `withTestRuntimeId()` to simulate unsupported runtimes without mutating
 * the global adapter singleton.
 */
export function getEffectiveRuntimeId(): string {
  return _testRuntimeId ?? getRuntime().id;
}

/**
 * Returns the effective current working directory.
 * In production, delegates to `getRuntime().getCWD()`. Tests can override
 * via `withTestCWD()` without mutating the global adapter singleton.
 */
export function getEffectiveCWD(): string {
  return _testCWD ?? getRuntime().getCWD();
}

/**
 * Opens a URL via the effective runtime adapter.
 * Tests can override via `withTestOpenBrowser()` without mutating the global
 * adapter singleton.
 */
export function openBrowser(url: string): Promise<void> {
  return _testOpenBrowser
    ? _testOpenBrowser(url)
    : getRuntime().openBrowser(url);
}

// Registry state
const adapters: RuntimeAdapter[] = [];
let cachedRuntime: RuntimeAdapter | undefined;

/**
 * Registers a runtime adapter.
 *
 * Registration order matters: first adapter where detect() returns true wins.
 * Standard order: Deno, Browser, Node (Node is the fallback).
 *
 * @param adapter - The runtime adapter to register
 */
export function registerRuntime(adapter: RuntimeAdapter): void {
  adapters.push(adapter);
}

/**
 * Gets the RuntimeAdapter for the current environment.
 *
 * The result is cached after first detection. Detection order is determined
 * by registration order (Deno > Browser > Node).
 *
 * @returns The RuntimeAdapter for the current runtime
 * @throws If no adapter matches the current environment
 */
export function getRuntime(): RuntimeAdapter {
  if (cachedRuntime) {
    return cachedRuntime;
  }

  for (const adapter of adapters) {
    if (adapter.detect()) {
      cachedRuntime = adapter;
      return adapter;
    }
  }

  notReached('No runtime adapter matched');
}

/**
 * Clears the cached runtime adapter.
 * Used primarily for testing the detection logic.
 */
export function clearRuntimeCache(): void {
  cachedRuntime = undefined;
}

/**
 * Gets all registered adapters.
 * Used primarily for testing.
 */
export function getRegisteredAdapters(): readonly RuntimeAdapter[] {
  return adapters;
}

/**
 * Wraps an async signal handler so rejections are logged, not unhandled.
 * Shared by Deno and Node adapters — avoids duplicating the catch logic.
 *
 * IMPORTANT: The returned wrapper does NOT await async handlers. Signal
 * handlers must be synchronous or fire-and-forget. Async cleanup (flushing
 * DB, closing connections) may not complete before the process exits. If
 * reliable async shutdown is needed, coordinate externally (e.g., wait for
 * a promise before calling exit()).
 */
export function wrapAsyncSignalHandler(
  handler: () => Promise<void> | void,
  signal: string,
): () => void {
  return () => {
    try {
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
    } catch (err) {
      log({
        severity: 'ERROR',
        error: 'UncaughtServerError',
        message: `Sync signal handler for ${signal} failed: ${err}`,
      });
    }
  };
}

/**
 * Checks if stdout is an interactive terminal (TTY).
 * Returns false in browsers or when output is piped/redirected.
 *
 * This is a convenience wrapper around `getRuntime().isInteractiveTTY()`.
 *
 * @returns True if stdout is a TTY, false otherwise
 */
export function isInteractiveTerminal(): boolean {
  return getRuntime().isInteractiveTTY();
}

/**
 * Gets terminal dimensions (columns and rows).
 * Returns default {cols: 80, rows: 24} if unavailable.
 *
 * This is a convenience wrapper around `getRuntime().terminalSize()`.
 *
 * @returns Terminal dimensions
 */
export function terminalSize(): { cols: number; rows: number } {
  return getRuntime().terminalSize();
}

// Import and register adapters in correct order
// Registration happens at module load time
import { DenoAdapter } from './adapters/deno.ts';
import { BrowserAdapter } from './adapters/browser.ts';
import { NodeAdapter } from './adapters/node.ts';

// Build-time target: replaced by esbuild's `define` option with a string
// literal (e.g. "browser" or "node"). When running unbundled, the typeof
// check prevents a ReferenceError and all adapters register.
declare const __BUNDLE_TARGET__: string | undefined;

// Registration order: Deno first (most specific), Browser second, Node last
// (fallback). This order is critical: Deno has both 'Deno' global and 'self',
// so must check first.
// Note: Deno runs unbundled (__BUNDLE_TARGET__ undefined); the 'deno' check
// is kept for potential future Deno bundling support.
if (
  typeof __BUNDLE_TARGET__ === 'undefined' || __BUNDLE_TARGET__ === 'deno'
) {
  registerRuntime(DenoAdapter);
}
if (
  typeof __BUNDLE_TARGET__ === 'undefined' || __BUNDLE_TARGET__ === 'browser'
) {
  registerRuntime(BrowserAdapter);
}
if (
  typeof __BUNDLE_TARGET__ === 'undefined' || __BUNDLE_TARGET__ === 'node'
) {
  registerRuntime(NodeAdapter);
}
