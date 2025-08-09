/**
 * Main entry point for running benchmarks in the browser.
 * This module is loaded as the entry point when executing benchmarks in a browser
 * environment via Playwright automation.
 */

import { isBrowser } from '../base/common.ts';
import { BenchmarkRunner } from './mod.ts';
import { getEnvVar } from '../base/os.ts';
import { exit } from '../base/process.ts';
import { notReached } from '../base/error.ts';
import {
  type LogEntry,
  type LogStream,
  setGlobalLoggerStreams,
} from '../logging/log.ts';
import { ConsoleLogStream } from '../logging/console-stream.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';

// Import benchmark setup functions
import setupGoatDB from './goatdb.bench.ts';
import setupSQLiteBrowser from './sqlite-browser.bench.ts';

/**
 * Custom log stream for browser benchmarks that filters out METRIC logs
 * to reduce console noise during benchmarking.
 */
class BenchmarkConsoleLogStream implements LogStream {
  private consoleStream = new ConsoleLogStream();

  appendEntry(e: NormalizedLogEntry<LogEntry>): void {
    // Filter out METRIC logs in browser benchmarks to reduce noise
    if (e.severity === 'METRIC') {
      return;
    }
    this.consoleStream.appendEntry(e);
  }
}

/**
 * Browser benchmark entry point.
 */
async function main(): Promise<void> {
  // Install custom log stream to filter out metrics in browser benchmarks
  if (isBrowser()) {
    setGlobalLoggerStreams([new BenchmarkConsoleLogStream()]);

    // Forward benchmark events to DOM
    BenchmarkRunner.default.attach('progress', (data: any) => {
      globalThis.dispatchEvent(
        new CustomEvent('benchmarkStart', { detail: data })
      );
    });

    BenchmarkRunner.default.attach('benchmarkComplete', (result: any) => {
      globalThis.dispatchEvent(
        new CustomEvent('benchmarkComplete', { detail: result })
      );
    });
  }

  console.log('Running benchmarks in browser environment...');
  
  // Register all browser-compatible benchmarks
  setupGoatDB();
  setupSQLiteBrowser(); // Browser-specific SQLite with OPFS
  
  // Get benchmark filter from environment/config
  const benchmarkName = getEnvVar('GOATDB_BENCHMARK') || 
    (window as any).GoatDBConfig?.benchmark;
  const outputJson = getEnvVar('GOATDB_OUTPUT_JSON') === 'true';
  
  // Run benchmarks
  const summary = await BenchmarkRunner.default.run(benchmarkName, outputJson);
  
  if (isBrowser()) {
    // Set global results for automation with completed flag
    (globalThis as any).testResults = { ...summary, completed: true };
    globalThis.dispatchEvent(
      new CustomEvent('benchmarksComplete', { detail: summary }),
    );
  }
  
  // Exit with appropriate code
  const exitCode = summary.summary.failed > 0 ? 1 : 0;
  await exit(exitCode);
}

// Auto-run when used as entry point in browser
if (isBrowser()) {
  main();
} else {
  notReached('Benchmarks browser entry point should only be used in browser environment');
}