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
  return getRuntime().exit(code);
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
