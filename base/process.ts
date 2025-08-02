import { isDeno, isNode, isBrowser } from './common.ts';
import { notReached } from './error.ts';

/**
 * Exits the current process with the specified exit code.
 * 
 * In browser test context, this signals test completion to automation
 * rather than terminating the browser process.
 *
 * @param code The exit code (0 for success, non-zero for failure)
 * @returns Never returns (process terminates or test execution halts)
 * @throws Error if on an unsupported platform
 */
export async function exit(code: number): Promise<never> {
  if (isNode()) {
    const { exit } = await import('node:process');
    exit(code);
  } else if (isDeno()) {
    Deno.exit(code);
  } else if (isBrowser()) {
    // In browser, "exit" means signal test completion
    return await signalBrowserTestCompletion(code);
  }
  notReached('Platform not supported');
}

/**
 * Signals test completion in browser environment.
 * This is what browser "exit" means - notify automation of completion.
 */
function signalBrowserTestCompletion(code: number): Promise<never> {
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
    globalThis.dispatchEvent(new CustomEvent('testsComplete', { 
      detail: summary 
    }));
  } else {
    // Ensure existing summary is marked as completed with correct exit code
    summary.completed = true;
    summary.exitCode = code;
  }
  
  // Update DOM if test runner page exists
  updateBrowserTestDisplay(summary);
  
  // For browser, we throw to halt execution since we can't actually exit
  // if (code === 0) {
  //   throw new Error('TEST_COMPLETION_SUCCESS');
  // } else {
  //   throw new Error(`TEST_COMPLETION_FAILURE: exit code ${code}`);
  // }
  return Promise.resolve(undefined as never);
}

function updateBrowserTestDisplay(summary: any): void {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.className = `status ${summary.exitCode === 0 ? 'passed' : 'failed'}`;
    statusEl.textContent = summary.exitCode === 0 
      ? 'Tests completed successfully'
      : `Tests failed with exit code ${summary.exitCode}`;
  }
}
