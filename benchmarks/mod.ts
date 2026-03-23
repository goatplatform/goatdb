import {
  type BenchmarkConfig,
  type BenchmarkStatistics,
  calculateStatistics,
  getDefaultBenchmarkConfig,
  getRuntimeId,
  type RunResult,
  type RunSummary,
  Suite,
} from '../shared/runner.ts';
import { getSystemInfo } from '../base/system-info.ts';
import { getEnvVar } from '../base/os.ts';
import { ProgressBar } from '../shared/progress.ts';
import { writeTextFile } from '../base/json-log/file-impl.ts';
import { Emitter } from '../base/emitter.ts';
import * as path from '@std/path';

/** Canonical operation ordering for comparison tables. */
export const OPERATION_ORDER = [
  // Database Lifecycle
  'Create instance',
  'Open database (empty)',
  'Open database (100k items)',

  // Single Item CRUD Operations (OLTP)
  'Create item',
  'Read item',
  'Update item',

  // Bulk Operations (Mixed OLTP/OLAP)
  'Bulk create 100 items',
  'Bulk read 100 items',
  'Write 100k items',
  'Read 100k items (cold)',
  'Read 100k items (warm)',

  // Query Operations (OLAP)
  'Filter query cold (100 items)',
  'Filter query warm (100 items)',
  'Filter query cold (100k \u2192 1k results)',
  'Filter query warm (100k \u2192 1k results)',
  'Filter query cold (100k \u2192 10k results)',
  'Filter query warm (100k \u2192 10k results)',
  'Filter + sort query cold (100 items)',
  'Filter + sort query warm (100 items)',
  'Live query update (100 items)',
  'Live query update (1k items)',
  'Live query update (10k items)',
  'Count operation',
  'Keys operation',
] as const;

/**
 * Cleanup function type
 */
export type CleanupFunc = () => Promise<void> | void;

/**
 * Benchmark function type with optional configuration and optional cleanup return
 */
export type BenchmarkFunc = (
  ctx: Suite,
) => Promise<void | CleanupFunc> | void | CleanupFunc;

/**
 * Benchmark event types
 */
export type BenchmarkEvent = 'progress' | 'benchmarkComplete';

/**
 * Enhanced benchmark runner with warmup, iterations, and statistics
 */
export class BenchmarkRunner extends Emitter<BenchmarkEvent> {
  private benchmarks: Map<
    string,
    Map<string, {
      fn: BenchmarkFunc;
      config?: BenchmarkConfig;
    }>
  > = new Map();

  static default = new BenchmarkRunner();

  /**
   * Register a benchmark with suite, name, and optional config
   */
  register(
    suite: string,
    name: string,
    fn: BenchmarkFunc,
    config?: BenchmarkConfig,
  ) {
    if (!this.benchmarks.has(suite)) {
      this.benchmarks.set(suite, new Map());
    }
    this.benchmarks.get(suite)!.set(name, { fn, config });
  }

  /**
   * Run all registered benchmarks with progress and statistics
   */
  async run(filter?: string, outputJson = false): Promise<RunSummary> {
    const results: RunResult[] = [];
    const startTime = performance.now();
    const runtime = getRuntimeId();

    // Count total benchmarks
    let totalBenchmarks = 0;
    const benchmarkList: Array<
      {
        suite: string;
        name: string;
        fn: BenchmarkFunc;
        config: BenchmarkConfig;
      }
    > = [];

    for (const [suiteName, benchmarks] of this.benchmarks) {
      for (const [benchmarkName, { fn, config }] of benchmarks) {
        if (filter) {
          const filterLower = filter.toLowerCase();
          const suiteMatch = suiteName.toLowerCase().includes(filterLower);
          const benchMatch = benchmarkName.toLowerCase().includes(filterLower);
          if (!suiteMatch && !benchMatch) continue;
        }
        totalBenchmarks++;
        const finalConfig = config || getDefaultBenchmarkConfig(benchmarkName);
        benchmarkList.push({
          suite: suiteName,
          name: benchmarkName,
          fn,
          config: finalConfig,
        });
      }
    }

    if (totalBenchmarks === 0) {
      console.log(
        'No benchmarks found' + (filter ? ` matching "${filter}"` : ''),
      );
      return {
        metadata: {
          type: 'benchmark',
          runtime,
          timestamp: new Date().toISOString(),
          duration: 0,
        },
        results: [],
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          suites: {},
        },
      };
    }

    console.log(`Running ${totalBenchmarks} benchmarks...`);
    const progress = new ProgressBar(totalBenchmarks);
    let currentBenchmark = 0;

    // Run each benchmark
    for (const { suite: suiteName, name, fn, config } of benchmarkList) {
      currentBenchmark++;

      // Update progress once per benchmark
      progress.update(currentBenchmark, `${suiteName}/${name}`);

      // Emit progress event
      this.emit('progress', {
        current: currentBenchmark,
        total: totalBenchmarks,
        suite: suiteName,
        name: name,
      });

      // Track whether to preserve data between iterations
      const preserveData = config.preserveData ?? false;

      // If preserving data, create one suite for all iterations
      let persistentSuite: Suite | undefined;
      if (preserveData) {
        persistentSuite = new Suite(suiteName, 'benchmark');
      }

      // Warmup phase
      if (config.warmup && config.warmup > 0) {
        for (let i = 0; i < config.warmup; i++) {
          // Create new suite for each iteration if not preserving data
          const suite = preserveData
            ? persistentSuite!
            : new Suite(suiteName, 'benchmark');

          try {
            const result = await fn(suite);

            // Execute cleanup function if returned (not timed in warmup either)
            if (result && typeof result === 'function') {
              await result();
            }
          } catch (e) {
            // Check if this is a critical initialization error
            const errorMessage = e instanceof Error ? e.message : String(e);
            if (
              errorMessage.includes('OPFS') ||
              errorMessage.includes('readyPromise') ||
              errorMessage.includes('trust pool') ||
              errorMessage.includes('initialization')
            ) {
              // Critical initialization error - fail fast
              console.error(
                `\n❌ Critical initialization error in ${suiteName}/${name}: ${e}`,
              );
              throw e;
            }
            // Non-critical error - log if not expecting failures
            if (!config.expectFailures) {
              console.error(
                `\n⚠️  Warmup failed for ${suiteName}/${name}: ${e}`,
              );
            }
          } finally {
            // Clean up after each iteration if not preserving data
            if (!preserveData) {
              await suite.cleanup();
            }
          }
        }
      }

      // Measurement phase
      const samples: number[] = [];
      let failures = 0;
      const iterations = config.iterations || 10;

      for (let i = 0; i < iterations; i++) {
        // Create new suite for each iteration if not preserving data
        const suite = preserveData
          ? persistentSuite!
          : new Suite(suiteName, 'benchmark');

        const start = performance.now();
        try {
          const result = await fn(suite);
          const functionDuration = performance.now() - start;

          // Use custom timing if available, otherwise use function timing
          const duration = suite.getCustomDuration() ?? functionDuration;
          samples.push(duration);

          // Execute cleanup function if returned (not timed)
          if (result && typeof result === 'function') {
            await result();
          }
        } catch (error) {
          failures++;
          if (!config.expectFailures) {
            console.error(`\n❌ ${suiteName}/${name} failed: ${error}`);
            if (!preserveData) {
              await suite.cleanup();
            }
            break;
          }
        } finally {
          // Reset timing for next iteration
          suite.resetTiming();

          // Clean up after each iteration if not preserving data
          if (!preserveData && failures === 0) {
            await suite.cleanup();
          }
        }
      }

      // Calculate statistics
      const stats = calculateStatistics(samples, config, failures);

      // Determine pass/fail
      const passed = stats.successRate >= (config.expectFailures ? 0.5 : 1.0);

      // Collect result
      const result = {
        type: 'benchmark' as const,
        suite: suiteName,
        name,
        status: (passed ? 'passed' : 'failed') as 'passed' | 'failed',
        duration: stats.mean,
        timestamp: new Date().toISOString(),
        statistics: stats,
        config,
        rawSamples: samples,
      };

      results.push(result);

      // Emit benchmark completion event
      this.emit('benchmarkComplete', result);

      // Final cleanup for persistent suite
      if (preserveData && persistentSuite) {
        await persistentSuite.cleanup();
      }
    }

    // Clear the progress bar before outputting summary
    progress.finish();

    const endTime = performance.now();
    const totalDuration = endTime - startTime;

    // Calculate summary
    const summary = createSummary(results, runtime, totalDuration);

    // Output results in a clean table format
    console.log('\n' + await formatSummary(summary));

    // Attach system info to summary
    summary.metadata.systemInfo = await getSystemInfo();

    // Save JSON if requested
    if (outputJson) {
      const outputDir = getEnvVar('GOATDB_BENCH_OUTPUT_DIR') || '/tmp';
      const jsonPath = path.join(outputDir, `goatdb-bench-${runtime}.json`);
      await writeTextFile(jsonPath, JSON.stringify(summary, null, 2));
      console.log(`📄 Results saved to: ${jsonPath}`);
    }

    return summary;
  }
}

/**
 * Create summary from results
 */
function createSummary(
  results: RunResult[],
  runtime: string,
  duration: number,
): RunSummary {
  const suites: Record<string, {
    passed: number;
    failed: number;
    avgDuration: number;
    p95?: number;
    p99?: number;
  }> = {};

  // Group by suite
  for (const result of results) {
    if (!suites[result.suite]) {
      suites[result.suite] = { passed: 0, failed: 0, avgDuration: 0 };
    }

    const suite = suites[result.suite];
    if (result.status === 'passed') {
      suite.passed++;
    } else {
      suite.failed++;
    }
  }

  // Calculate averages and percentiles
  for (const suiteName of Object.keys(suites)) {
    const suiteResults = results.filter((r) => r.suite === suiteName);
    const durations = suiteResults.map((r) => r.duration);
    const stats = suiteResults
      .map((r) => r.statistics)
      .filter((s) => s !== undefined) as BenchmarkStatistics[];

    if (durations.length > 0) {
      suites[suiteName].avgDuration = durations.reduce((a, b) => a + b, 0) /
        durations.length;
    }

    if (stats.length > 0) {
      // Average of p95 and p99 across all benchmarks in suite
      suites[suiteName].p95 = stats.reduce((sum, s) => sum + s.p95, 0) /
        stats.length;
      suites[suiteName].p99 = stats.reduce((sum, s) => sum + s.p99, 0) /
        stats.length;
    }
  }

  return {
    metadata: {
      type: 'benchmark',
      runtime: runtime as 'deno' | 'node' | 'browser',
      timestamp: new Date().toISOString(),
      duration,
    },
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      suites,
    },
  };
}

/**
 * Format duration with appropriate units (μs/ms)
 */
function formatDuration(ms: number): string {
  if (ms < 1.0) {
    if (ms * 1000 < 0.05) return '<0.1\u00B5s';
    return `${(ms * 1000).toFixed(1)}\u00B5s`;
  } else {
    return `${ms.toFixed(1)}ms`;
  }
}

/**
 * Format summary for console output
 */
async function formatSummary(summary: RunSummary): Promise<string> {
  const lines: string[] = [];

  // System information header
  const systemInfo = await getSystemInfo();
  lines.push(
    `System: ${systemInfo.hardware.cpu || 'unknown'}, ${
      systemInfo.hardware.memory || 'unknown'
    } RAM`,
  );
  lines.push(`Storage: ${systemInfo.hardware.storage}`);
  lines.push(
    `Runtime: ${systemInfo.runtime.runtime} ${systemInfo.runtime.version} (${systemInfo.runtime.platform})`,
  );
  lines.push('');

  lines.push('Benchmark Results');
  lines.push('=================');
  lines.push('');

  // Create operation vs config comparison table
  lines.push(...createComparisonTable(summary));
  lines.push('');

  // Create per-suite detailed tables
  lines.push(...createDetailedTables(summary));

  lines.push('');
  lines.push(
    `Total: ${summary.summary.passed} passed, ${summary.summary.failed} failed ` +
      `(${(summary.metadata.duration / 1000).toFixed(1)}s)`,
  );

  return lines.join('\n');
}

/**
 * Create operation vs configuration comparison tables
 */
function createComparisonTable(summary: RunSummary): string[] {
  const lines: string[] = [];

  // Group results by operation name
  const operationResults = new Map<string, RunResult[]>();
  for (const result of summary.results) {
    if (!operationResults.has(result.name)) {
      operationResults.set(result.name, []);
    }
    operationResults.get(result.name)!.push(result);
  }

  // Sort operations in logical order for clear performance story
  const operations = Array.from(operationResults.keys()).sort((a, b) => {
    const indexA = OPERATION_ORDER.indexOf(a as typeof OPERATION_ORDER[number]);
    const indexB = OPERATION_ORDER.indexOf(b as typeof OPERATION_ORDER[number]);

    // If both operations are in the defined order, sort by position
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }

    // If only one is in the order, it comes first
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;

    // If neither is in the order, sort alphabetically
    return a.localeCompare(b);
  });

  // Table 1: Default Configuration Performance (headline)
  const defaultSuites = ['GoatDB', 'SQLite'];
  const availableDefaultSuites = defaultSuites.filter((suite) =>
    summary.summary.suites[suite]
  );

  if (availableDefaultSuites.length > 0) {
    lines.push('Default Configuration Performance');
    lines.push('');
    lines.push(
      ...createComparisonTableForSuites(
        operations,
        operationResults,
        availableDefaultSuites,
      ),
    );
    lines.push('');
  }

  // Table 2: Durable Mode Comparison
  const durableSuites = [
    'GoatDB (Durable)',
    'GoatDB',
    'SQLite',
    'SQLite Fast-Unsafe',
  ];
  const availableDurableSuites = durableSuites.filter((suite) =>
    summary.summary.suites[suite]
  );

  if (availableDurableSuites.length > 0) {
    lines.push('Durable Mode Comparison');
    lines.push('');
    lines.push(
      ...createComparisonTableForSuites(
        operations,
        operationResults,
        availableDurableSuites,
      ),
    );
  }

  // Table 3: Storage Format Comparison
  const storageSuites = ['GoatDB', 'GoatDB JSONL'];
  const availableStorageSuites = storageSuites.filter((suite) =>
    summary.summary.suites[suite]
  );
  if (availableStorageSuites.length > 0) {
    lines.push('');
    lines.push('Storage Format Comparison');
    lines.push('');
    lines.push(
      ...createComparisonTableForSuites(
        operations,
        operationResults,
        availableStorageSuites,
      ),
    );
  }

  return lines;
}

/**
 * Create a comparison table for specific suites
 */
function createComparisonTableForSuites(
  operations: string[],
  operationResults: Map<string, RunResult[]>,
  suites: string[],
): string[] {
  const lines: string[] = [];
  const maxOpLen = Math.max(12, ...operations.map((op) => op.length));
  const colWidth = 24;

  // Create header
  let header = 'Operation'.padEnd(maxOpLen);
  for (const suite of suites) {
    const displayName = suite.replace('GoatDB ', 'GoatDB-').replace(
      'SQLite ',
      'SQLite-',
    );
    header += ' │ ' + displayName.padStart(colWidth);
  }
  lines.push(header);

  // Add separator
  let separator = '─'.repeat(maxOpLen);
  for (let i = 0; i < suites.length; i++) {
    separator += '─┼─' + '─'.repeat(colWidth);
  }
  lines.push(separator);

  // Add data rows
  for (const operation of operations) {
    const results = operationResults.get(operation) || [];
    const filtered = results.filter((r) => suites.includes(r.suite));

    if (filtered.length === 0) continue;

    let row = operation.padEnd(maxOpLen);

    // Find winner and loser within this group
    const validResults = filtered.filter((r) => r.statistics);
    const times = validResults.map((r) => r.statistics!.mean);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    for (const suite of suites) {
      const result = filtered.find((r) => r.suite === suite);
      const baseValue = result?.statistics
        ? formatDuration(result.statistics.mean)
        : '-';
      let displayValue = baseValue;

      // Add color highlighting and speedup ratio
      if (result?.statistics && times.length > 1) {
        const time = result.statistics.mean;
        if (time === minTime) {
          displayValue = `\x1b[32m${baseValue}\x1b[0m`;
        } else {
          const ratio = (time / minTime).toFixed(1);
          const withRatio = `${baseValue} (${ratio}x)`;
          if (time === maxTime) {
            displayValue = `\x1b[31m${withRatio}\x1b[0m`;
          } else {
            displayValue = withRatio;
          }
          const padding = colWidth - withRatio.length;
          row += ' │ ' + ' '.repeat(Math.max(0, padding)) + displayValue;
          continue;
        }
      }

      // Proper padding
      const padding = colWidth - baseValue.length;
      row += ' │ ' + ' '.repeat(Math.max(0, padding)) + displayValue;
    }
    lines.push(row);
  }

  return lines;
}

/**
 * Create detailed statistics tables for each suite
 */
function createDetailedTables(summary: RunSummary): string[] {
  const lines: string[] = [];

  const suites = Object.keys(summary.summary.suites).sort();

  for (const suiteName of suites) {
    const suiteResults = summary.results.filter((r) => r.suite === suiteName);
    if (suiteResults.length === 0) continue;

    lines.push(`Detailed Statistics: ${suiteName}`);
    lines.push('─'.repeat(60));

    // Table header
    const maxOpLen = Math.max(12, ...suiteResults.map((r) => r.name.length));
    const header = 'Operation'.padEnd(maxOpLen) + ' | ' +
      'Average'.padStart(10) + ' | ' +
      'Median'.padStart(10) + ' | ' +
      'Stddev'.padStart(10) + ' | ' +
      'CV'.padStart(6) + ' | ' +
      'p95'.padStart(10) + ' | ' +
      'p99'.padStart(10) + ' | ' +
      'Samples'.padStart(8) + ' | ' +
      'Throughput'.padStart(14);

    lines.push(header);
    lines.push(
      '-'.repeat(maxOpLen) + '-+-' +
        '-'.repeat(10) + '-+-' +
        '-'.repeat(10) + '-+-' +
        '-'.repeat(10) + '-+-' +
        '-'.repeat(6) + '-+-' +
        '-'.repeat(10) + '-+-' +
        '-'.repeat(10) + '-+-' +
        '-'.repeat(8) + '-+-' +
        '-'.repeat(14),
    );

    // Data rows
    for (const result of suiteResults) {
      const stats = result.statistics;
      if (!stats) continue;

      const medianStr = stats.median !== undefined
        ? formatDuration(stats.median)
        : '-';
      const cvStr = stats.cv !== undefined
        ? `${(stats.cv * 100).toFixed(0)}%`
        : '-';
      const p95 = stats.samples < 20 ? '-' : formatDuration(stats.p95);
      const p99 = stats.samples < 100 ? '-' : formatDuration(stats.p99);
      const throughput = stats.throughput >= 10
        ? `${Math.round(stats.throughput)} ops/s`
        : '-';

      const row = result.name.padEnd(maxOpLen) + ' | ' +
        formatDuration(stats.mean).padStart(10) + ' | ' +
        medianStr.padStart(10) + ' | ' +
        formatDuration(stats.stddev).padStart(10) + ' | ' +
        cvStr.padStart(6) + ' | ' +
        p95.padStart(10) + ' | ' +
        p99.padStart(10) + ' | ' +
        stats.samples.toString().padStart(8) + ' | ' +
        throughput.padStart(14);

      lines.push(row);
    }

    lines.push('');
  }

  return lines;
}

/**
 * Register a benchmark - supports both simple and configured forms
 */
export function BENCHMARK(
  suite: string,
  name: string,
  fnOrConfig: BenchmarkFunc | BenchmarkConfig,
  fn?: BenchmarkFunc,
) {
  if (typeof fnOrConfig === 'function') {
    // Simple form: BENCHMARK(suite, name, fn)
    BenchmarkRunner.default.register(suite, name, fnOrConfig);
  } else {
    // Configured form: BENCHMARK(suite, name, config, fn)
    if (!fn) {
      throw new Error('Benchmark function required when using config');
    }
    BenchmarkRunner.default.register(suite, name, fn, fnOrConfig);
  }
}
