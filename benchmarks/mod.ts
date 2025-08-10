import {
  type BenchmarkConfig,
  type BenchmarkStatistics,
  calculateStatistics,
  getDefaultBenchmarkConfig,
  getRuntime,
  type RunResult,
  type RunSummary,
  Suite,
} from '../shared/runner.ts';
import { getSystemInfo } from '../base/system-info.ts';
import { ProgressBar } from '../shared/progress.ts';
import { writeTextFile } from '../base/json-log/file-impl.ts';
import { Emitter } from '../base/emitter.ts';
import * as path from '@std/path';

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
    const runtime = getRuntime();

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
        const avgSoFar = samples.length > 0
          ? (samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1)
          : '0';

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
        type: 'benchmark',
        suite: suiteName,
        name,
        status: passed ? 'passed' : 'failed',
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

    // Save JSON if requested
    if (outputJson) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const jsonPath = path.join(
        '/tmp',
        `goatdb-bench-results-${timestamp}.json`,
      );
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
    return `${(ms * 1000).toFixed(1)}μs`;
  } else {
    return `${ms.toFixed(1)}ms`;
  }
}

/**
 * Format individual results in a clean table
 */
function formatResults(results: RunResult[]): string {
  if (results.length === 0) return '';

  const lines: string[] = [];

  // Group results by suite
  const suites = new Map<string, RunResult[]>();
  for (const result of results) {
    if (!suites.has(result.suite)) {
      suites.set(result.suite, []);
    }
    suites.get(result.suite)!.push(result);
  }

  lines.push('Benchmark Results');
  lines.push('=================');

  // Process each suite
  for (const [suiteName, suiteResults] of suites) {
    lines.push('');
    lines.push(suiteName);
    lines.push('-'.repeat(suiteName.length));

    // Find max name length for alignment
    let maxNameLen = 0;
    for (const result of suiteResults) {
      maxNameLen = Math.max(maxNameLen, result.name.length);
    }

    // Output each benchmark in the suite
    for (const result of suiteResults) {
      const icon = result.status === 'passed' ? '✅' : '❌';
      const stats = result.statistics;
      if (stats) {
        const name = result.name.padEnd(maxNameLen);
        const mean = formatDuration(stats.mean).padStart(9);
        const p95 = formatDuration(stats.p95).padStart(9);
        const p99 = formatDuration(stats.p99).padStart(9);
        const samples = stats.samples.toString().padStart(6);

        lines.push(`  ${icon} ${name}  ${mean} ${p95} ${p99} ${samples}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format summary for console output
 */
async function formatSummary(summary: RunSummary): Promise<string> {
  const lines: string[] = [];

  // System information header
  const systemInfo = await getSystemInfo();
  lines.push(`System: ${systemInfo.hardware.cpu || 'unknown'}, ${systemInfo.hardware.memory || 'unknown'} RAM`);
  lines.push(`Storage: ${systemInfo.hardware.storage}`);
  lines.push(`Runtime: ${systemInfo.runtime.runtime} ${systemInfo.runtime.version} (${systemInfo.runtime.platform})`);
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

  // Normalize operation names for comparison
  const normalizeOperation = (name: string): string => {
    const mapping: Record<string, string> = {
      'Open repository (empty)': 'Open database (empty)',
      'Open repository (100k items)': 'Open database (100k items)',
      'Create table': 'Open database (empty)',
      'Read item by path': 'Read item by ID',
      'Create single item': 'Create item',
      'Read 100k items': 'Read 100k items',
      'Bulk create 100 items': 'Bulk create 100 items',
      'Bulk read 100 items': 'Bulk read 100 items',
      'Repository operations: count': 'Count operation',
      'Repository operations: keys': 'Keys operation',
    };
    return mapping[name] || name;
  };

  // Group results by normalized operation
  const operationResults = new Map<string, RunResult[]>();
  for (const result of summary.results) {
    const normalizedName = normalizeOperation(result.name);
    if (!operationResults.has(normalizedName)) {
      operationResults.set(normalizedName, []);
    }
    operationResults.get(normalizedName)!.push(result);
  }

  // Sort operations in logical order for clear performance story
  const operations = Array.from(operationResults.keys()).sort((a, b) => {
    // Define logical order categories
    const order = [
      // 1. Database Lifecycle
      'Create instance',
      'Create table',
      'Open database (empty)',
      'Open database (100k items)',

      // 2. Single Item CRUD Operations (OLTP)
      'Create item',
      'Create single item',
      'Read item by ID',
      'Read item by path',
      'Update item',

      // 3. Bulk Operations (Mixed OLTP/OLAP)
      'Bulk create 100 items',
      'Bulk read 100 items',
      'Read 100k items',

      // 4. Query Operations (OLAP)
      'Simple query',
      'Complex query with sort',
      'Count operation',
      'Keys operation',
      'Repository operations: count',
      'Repository operations: keys',
    ];

    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);

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

  // Table 1: ACID Compliant Comparison
  const acidSuites = ['GoatDB', 'GoatDB Trusted', 'SQLite'];
  const availableAcidSuites = acidSuites.filter((suite) =>
    summary.summary.suites[suite]
  );

  if (availableAcidSuites.length > 0) {
    lines.push('Durable Mode Performance Comparison');
    lines.push('');
    lines.push(
      ...createComparisonTableForSuites(
        operations,
        operationResults,
        availableAcidSuites,
      ),
    );
    lines.push('');
  }

  // Table 2: Performance Optimized Comparison
  const fastSuites = ['GoatDB Fast', 'SQLite Fast-Unsafe'];
  const availableFastSuites = fastSuites.filter((suite) =>
    summary.summary.suites[suite]
  );

  if (availableFastSuites.length > 0) {
    lines.push('Performance Optimized Comparison');
    lines.push('');
    lines.push(
      ...createComparisonTableForSuites(
        operations,
        operationResults,
        availableFastSuites,
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
  const colWidth = 18; // Increased to accommodate "SQLite-Fast-Unsafe"

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
    const operationResults_filtered = results.filter((r) =>
      suites.includes(r.suite)
    );

    if (operationResults_filtered.length === 0) continue;

    let row = operation.padEnd(maxOpLen);

    // Find winner and loser within this group
    const validResults = operationResults_filtered.filter((r) => r.statistics);
    const times = validResults.map((r) => r.statistics!.mean);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    for (const suite of suites) {
      const result = operationResults_filtered.find((r) => r.suite === suite);
      const value = result?.statistics
        ? formatDuration(result.statistics.mean)
        : '-';
      let coloredValue = value;

      // Add color highlighting
      if (result?.statistics && times.length > 1) {
        const time = result.statistics.mean;
        if (time === minTime) {
          coloredValue = `\x1b[32m${value}\x1b[0m`;
        } else if (time === maxTime) {
          coloredValue = `\x1b[31m${value}\x1b[0m`;
        }
      }

      // Proper padding
      const padding = colWidth - value.length;
      row += ' │ ' + ' '.repeat(Math.max(0, padding)) + coloredValue;
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
    const header = 'Operation'.padEnd(maxOpLen) + ' │ ' +
      'Average'.padStart(10) + ' │ ' +
      'p95'.padStart(10) + ' │ ' +
      'p99'.padStart(10) + ' │ ' +
      'Samples'.padStart(8);

    lines.push(header);
    lines.push(
      '─'.repeat(maxOpLen) + '─┼─' +
        '─'.repeat(10) + '─┼─' +
        '─'.repeat(10) + '─┼─' +
        '─'.repeat(10) + '─┼─' +
        '─'.repeat(8),
    );

    // Data rows
    for (const result of suiteResults) {
      const stats = result.statistics;
      if (!stats) continue;

      const row = result.name.padEnd(maxOpLen) + ' │ ' +
        formatDuration(stats.mean).padStart(10) + ' │ ' +
        formatDuration(stats.p95).padStart(10) + ' │ ' +
        formatDuration(stats.p99).padStart(10) + ' │ ' +
        stats.samples.toString().padStart(8);

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
