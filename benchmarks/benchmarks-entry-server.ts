/**
 * Main entry point for running all benchmarks using custom benchmark system.
 */

import { BenchmarkRunner } from './mod.ts';
import { getEnvVar } from '../base/os.ts';
import { exit } from '../base/process.ts';
import { isBrowser } from '../base/common.ts';

// Import benchmark setup functions
import setupGoatDB from './goatdb.bench.ts';
import setupSQLite from './sqlite.bench.ts';
import setupSQLiteFastUnsafe from './sqlite-fast-unsafe.bench.ts';
import setupSQLiteBrowser from './sqlite-browser.bench.ts';

async function main(): Promise<void> {
  // Register all benchmarks
  setupGoatDB();

  // Register platform-specific SQLite benchmarks
  if (isBrowser()) {
    setupSQLiteBrowser(); // Browser SQLite with OPFS
  } else {
    setupSQLite(); // Node/Deno SQLite with filesystem
    setupSQLiteFastUnsafe(); // Node/Deno SQLite with unsafe optimizations
  }

  // Get benchmark filter from environment
  const benchmarkName = getEnvVar('GOATDB_BENCHMARK');
  const outputJson = getEnvVar('GOATDB_OUTPUT_JSON') === 'true';

  // Run our custom benchmark system with new parameters
  const summary = await BenchmarkRunner.default.run(benchmarkName, outputJson);

  if (isBrowser()) {
    // In browser, set global results for automation with completed flag
    (globalThis as any).testResults = { ...summary, completed: true };
    globalThis.dispatchEvent(
      new CustomEvent('benchmarksComplete', { detail: summary }),
    );
  }

  // Exit with code 1 if any benchmarks failed, 0 if all passed
  const exitCode = summary.summary.failed > 0 ? 1 : 0;
  await exit(exitCode);
}

main();
