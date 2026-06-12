import { getRuntime } from './runtime/index.ts';

/**
 * Exits the current process with the specified exit code.
 *
 * Browser code must use signalBrowserTestCompletion() instead. Browser
 * JavaScript cannot terminate the process, so exit has no browser meaning.
 *
 * @param code The exit code (0 for success, non-zero for failure)
 * @returns Never returns (process terminates or test execution halts)
 * @throws Error if on an unsupported platform
 */
export function exit(code: number): never {
  if (_testExitOverride) {
    _testExitOverride(code);
    // Must still satisfy the never return type — throw so callers never
    // see a resolved path after exit().
    throw new Error(`exit(${code}) intercepted by test override`);
  }
  return getRuntime().exit(code);
}

// ── Test hooks ──────────────────────────────────────────────────────────────
/** @internal Test-only: overrides exit() to capture the exit code instead of terminating. */
// Note: module-level globals are safe under sequential test execution. If
// parallel test execution is ever enabled, these must move to a per-test
// isolation strategy (e.g. AsyncLocalStorage or test-scoped contexts).
let _testExitOverride: ((code: number) => void) | undefined;

/**
 * @internal Test-only scoped override for exit().
 * When set, exit() calls the override instead of the runtime adapter.
 * Pass undefined to restore normal behavior.
 *
 * Since exit() returns never, the override must throw or the caller must
 * accept that the code after exit() is dead.
 */
export async function withTestExitOverride<T>(
  override: ((code: number) => void) | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = _testExitOverride;
  _testExitOverride = override;
  try {
    return await fn();
  } finally {
    _testExitOverride = prev;
  }
}

/**
 * Signals test completion in browser environment.
 * Browser tests cannot exit the process, so they notify automation explicitly.
 */
export function signalBrowserTestCompletion(code: number): Promise<void> {
  // Use existing test results if available, otherwise create minimal summary
  let summary = (globalThis as any).testResults;
  if (!summary) {
    summary = {
      passed: code === 0 ? 1 : 0,
      failed: code === 0 ? 0 : 1,
      duration: performance.now(),
      exitCode: code,
      completed: true,
    };

    // Set global test results for Playwright to read
    (globalThis as any).testResults = summary;

    // Dispatch completion event
    globalThis.dispatchEvent(
      new CustomEvent('testsComplete', {
        detail: summary,
      }),
    );
  } else {
    // Ensure existing summary is marked as completed with correct exit code
    summary.completed = true;
    summary.exitCode = code;
  }

  // Update DOM if test runner page exists
  updateBrowserTestDisplay(summary);

  return Promise.resolve();
}

function updateBrowserTestDisplay(summary: any): void {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.className = `status ${
      summary.exitCode === 0 ? 'passed' : 'failed'
    }`;
    statusEl.textContent = summary.exitCode === 0
      ? 'Tests completed successfully'
      : `Tests failed with exit code ${summary.exitCode}`;
  }
}
