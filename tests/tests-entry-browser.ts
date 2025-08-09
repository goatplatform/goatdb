/**
 * Main entry point for running tests in the browser.
 *
 * This module is loaded as the entry point when executing tests in a browser
 * environment (e.g., via Playwright or other browser automation tools). It
 * sets up and runs all browser-compatible test suites, configures logging to
 * reduce console noise, and reads test configuration from environment
 * variables or global config objects.
 *
 * To add new browser-compatible tests, import and call their setup functions
 * here.
 */

import { isBrowser } from '../base/common.ts';
import { TestsRunner, type TestSummary } from './mod.ts';
import { exit } from '../base/process.ts';
import {
  type LogEntry,
  type LogStream,
  setGlobalLoggerStreams,
} from '../logging/log.ts';
import { ConsoleLogStream } from '../logging/console-stream.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';

// All browser-compatible existing tests (no Server class usage)
import setupOrderstamp from './orderstamp-expose.test.ts';
import setupItemPath from './item-path.ts';
import setupCommit from './commit.test.ts';
import setupSession from './session.test.ts';
import setupTrusted from './db-trusted.test.ts';
import setupGoatRequest from './goat-request.test.ts';
import setupStaticAssetsEndpoint from './static-assets-endpoint.test.ts';
import setupHealthCheckEndpoint from './health-check-endpoint.test.ts';
import { getEnvVar } from '../base/os.ts';
import { notReached } from '../base/error.ts';

/**
 * Custom log stream for browser tests that filters out METRIC logs
 * to reduce console noise during testing.
 */
class TestConsoleLogStream implements LogStream {
  private consoleStream = new ConsoleLogStream();

  appendEntry(e: NormalizedLogEntry<LogEntry>): void {
    // Filter out METRIC logs in browser tests to reduce noise
    if (e.severity === 'METRIC') {
      return;
    }
    this.consoleStream.appendEntry(e);
  }
}

/**
 * Browser test entry point - all browser-compatible existing tests.
 */
async function main(): Promise<void> {
  // Install custom log stream to filter out metrics in browser tests
  if (isBrowser()) {
    setGlobalLoggerStreams([new TestConsoleLogStream()]);
  }

  // Same test execution order as existing tests-entry.ts
  // but excluding server-only tests

  // FAST UNIT TESTS (0-1ms each) - Pure logic, no I/O
  setupOrderstamp(); // Utility functions for distributed timestamps
  setupItemPath(); // Path validation and parsing logic
  setupHealthCheckEndpoint(); // Simple HTTP endpoint check

  // COMPONENT TESTS (0-50ms each) - Single components with minimal dependencies
  setupCommit(); // Core commit/versioning logic
  setupSession(); // Authentication and session management
  setupGoatRequest(); // HTTP request processing

  // INTEGRATION TESTS (100-500ms each) - Multiple components, file I/O
  setupTrusted(); // Database operations in trusted mode - CRITICAL for browser
  setupStaticAssetsEndpoint(); // File serving and asset management

  // Get test configuration
  const suiteName = getEnvVar('GOATDB_SUITE');
  const testName = getEnvVar('GOATDB_TEST');

  // Forward test events to browser UI
  TestsRunner.default.attach('testStart', (data) => {
    globalThis.dispatchEvent(new CustomEvent('testStart', { detail: data }));
  });
  
  TestsRunner.default.attach('testComplete', (data) => {
    globalThis.dispatchEvent(new CustomEvent('testComplete', { detail: data }));
  });

  // Run the tests
  const summary: TestSummary = await TestsRunner.default.run(
    suiteName,
    testName,
  );

  // Print summary (will be captured by browser automation)
  TestsRunner.printSummary(summary);

  if (isBrowser()) {
    // Mark summary as completed for browser automation
    (summary as any).completed = true;

    // In browser, also set global results for automation
    (globalThis as any).testResults = summary;
    globalThis.dispatchEvent(
      new CustomEvent('testsComplete', { detail: summary }),
    );
  }

  // Exit with appropriate code (handles browser signaling)
  const exitCode = summary.failed > 0 ? 1 : 0;
  exit(exitCode);
}

// Auto-run when used as entry point or in browser
if (isBrowser()) {
  main();
} else {
  notReached('Tests entry point should only be used in browser environment');
}
