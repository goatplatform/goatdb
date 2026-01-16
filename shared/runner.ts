/**
 * Shared infrastructure for tests and benchmarks.
 * Provides a generic Suite class that can be used for both test and benchmark execution.
 */

import { GoatDB } from '../db/db.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import { sleep } from '../base/time.ts';
import type { DBInstanceConfig } from '../db/db.ts';
import * as path from '../base/path.ts';
import type { Schema } from '../cfds/base/schema.ts';

/**
 * Result structure for both tests and benchmarks
 */
export interface RunResult {
  type: 'test' | 'benchmark';
  suite: string;
  name: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: string;
  timestamp: string;

  // Benchmark-specific statistics
  statistics?: BenchmarkStatistics;
  config?: BenchmarkConfig;
  rawSamples?: number[];
}

/**
 * Aggregated summary of a test or benchmark run.
 *
 * The RunSummary interface provides a structured overview of the results from a suite
 * of tests or benchmarks. It includes metadata about the run, a list of individual
 * results, and a summary of outcomes grouped by suite.
 *
 * @property metadata - General information about the run, such as type, runtime, timestamp, and total duration.
 * @property results - Array of individual RunResult objects for each test or benchmark executed.
 * @property summary - Aggregated statistics, including total, passed, and failed counts,
 *                     as well as per-suite breakdowns with average duration and (for benchmarks)
 *                     percentile metrics.
 */
export interface RunSummary {
  /**
   * General metadata about the run.
   * - type: Indicates whether this was a 'test' or 'benchmark' run.
   * - runtime: The JavaScript runtime environment ('deno', 'node', or 'browser').
   * - timestamp: ISO string representing when the run started.
   * - duration: Total duration of the run in milliseconds.
   */
  metadata: {
    type: 'test' | 'benchmark';
    runtime: 'deno' | 'node' | 'browser';
    timestamp: string;
    duration: number;
  };

  /**
   * List of individual test or benchmark results.
   */
  results: RunResult[];

  /**
   * Aggregated summary statistics for the run.
   * - total: Total number of tests or benchmarks executed.
   * - passed: Number of successful tests/benchmarks.
   * - failed: Number of failed tests/benchmarks.
   * - suites: Per-suite breakdown, keyed by suite name, with counts and timing statistics.
   *   - avgDuration: Average duration per test/benchmark in the suite.
   *   - p95, p99: 95th and 99th percentile durations (only for benchmarks).
   */
  summary: {
    total: number;
    passed: number;
    failed: number;
    suites: Record<string, {
      passed: number;
      failed: number;
      avgDuration: number;
      /**
       * 95th percentile duration (only present for benchmarks).
       */
      p95?: number;
      /**
       * 99th percentile duration (only present for benchmarks).
       */
      p99?: number;
    }>;
  };
}

/**
 * Configuration options for running a benchmark.
 *
 * @property warmup - Number of warmup iterations to perform before measuring
 *                    (optional).
 * @property iterations - Number of measured iterations to run (optional).
 * @property expectFailures - Whether failures are expected during the benchmark
 *                            (optional).
 * @property timeout - Timeout in milliseconds for each iteration (optional).
 * @property preserveData - Whether to preserve data between iterations
 *                          (default: false, optional).
 */
export interface BenchmarkConfig {
  warmup?: number;
  iterations?: number;
  expectFailures?: boolean;
  timeout?: number;
  preserveData?: boolean;
}

/**
 * Statistics collected from a benchmark run.
 *
 * @property mean - The average duration per iteration (in milliseconds)
 * @property min - The minimum duration observed (in milliseconds)
 * @property max - The maximum duration observed (in milliseconds)
 * @property p95 - The 95th percentile duration (in milliseconds)
 * @property p99 - The 99th percentile duration (in milliseconds)
 * @property stddev - The standard deviation of durations (in milliseconds)
 * @property throughput - The number of iterations per second
 * @property successRate - The fraction of successful iterations (0.0 - 1.0)
 * @property samples - The number of measured iterations (sample count)
 * @property warmupIterations - The number of warmup iterations performed
 * @property measuredIterations - The number of measured iterations performed
 */
export interface BenchmarkStatistics {
  mean: number;
  min: number;
  max: number;
  p95: number;
  p99: number;
  std: number;
  stddev: number;
  throughput: number;
  successRate: number;
  samples: number;
  warmupIterations: number;
  measuredIterations: number;
}

/**
 * Function signature for tests and benchmarks
 */
export type RunFunc = (ctx: Suite) => Promise<void> | void;

/**
 * Generic Suite class for running tests or benchmarks.
 * Provides context utilities like temp directories and database creation.
 */
export class Suite {
  private _tempDir: string | undefined;
  private readonly results: RunResult[] = [];
  private readonly _dbs = new Map<string, GoatDB<Schema>>();
  private _customTiming: { start?: number; duration?: number } = {};

  /**
   * Creates a new suite with the given name.
   * @param name - The name of the suite
   * @param type - Whether this is a test or benchmark suite
   */
  constructor(
    readonly name: string,
    readonly type: 'test' | 'benchmark' = 'test',
  ) {}

  /**
   * Collects a result for later reporting
   */
  collectResult(result: RunResult) {
    this.results.push(result);
  }

  /**
   * Gets all collected results
   */
  getResults(): RunResult[] {
    return this.results;
  }

  /** Start precise timing measurement */
  start(): void {
    this._customTiming.start = performance.now();
  }

  /** End precise timing and capture duration */
  end(): void {
    if (this._customTiming.start === undefined) {
      throw new Error('ctx.start() must be called before ctx.end()');
    }
    this._customTiming.duration = performance.now() - this._customTiming.start;
    this._customTiming.start = undefined;
  }

  /** Get custom timing duration if available */
  getCustomDuration(): number | undefined {
    return this._customTiming.duration;
  }

  /** Reset timing state for next iteration */
  resetTiming(): void {
    this._customTiming = {};
  }

  /**
   * Cleans up any resources used by the suite.
   * Uses RuntimeTestConfig.cleanupDelayMs for platform-specific delays.
   */
  async cleanup() {
    // Close all open DBs first
    for (const db of this._dbs.values()) {
      await db.close();
    }
    this._dbs.clear();

    // Use RuntimeTestConfig for cleanup delay (OPFS needs ~10ms for handle release)
    const cleanupDelayMs = getRuntime().testConfig.cleanupDelayMs;
    if (cleanupDelayMs > 0) {
      await sleep(cleanupDelayMs);
    }

    if (this._tempDir) {
      await (await FileImplGet()).remove(this._tempDir);
      this._tempDir = undefined;
    }
  }

  /**
   * Gets or creates a temporary directory for this suite.
   * Creates the directory if it doesn't exist.
   * @param subPath - Optional subpath to append to the temp directory
   * @returns The full path to the temporary directory or subdirectory
   */
  async tempDir(subPath?: string): Promise<string> {
    if (!this._tempDir) {
      const fileImpl = await FileImplGet();
      const systemTempDir = await fileImpl.getTempDir();
      this._tempDir = path.join(systemTempDir, 'test-' + this.name);
    }
    const finalPath = subPath
      ? path.join(this._tempDir, subPath)
      : this._tempDir;

    // Ensure the directory exists
    const fileImpl = await FileImplGet();
    await fileImpl.mkdir(finalPath);

    return finalPath;
  }

  /**
   * Creates a GoatDB instance configured for the current test environment.
   * Uses RuntimeTestConfig.dbDefaults for platform-specific defaults.
   *
   * @param testId - Unique identifier for this test database within the suite
   * @param config - Additional configuration to merge with environment defaults
   * @returns Configured GoatDB instance ready for testing
   */
  async createDB<S extends Schema = Schema>(
    testId: string,
    config: Partial<DBInstanceConfig> = {},
  ): Promise<GoatDB<S>> {
    const runtime = getRuntime();

    // If there's already a DB with this testId, close it first
    const existingDb = this._dbs.get(testId);
    if (existingDb) {
      await existingDb.close();
      this._dbs.delete(testId);
      // Use RuntimeTestConfig for cleanup delay
      const cleanupDelayMs = runtime.testConfig.cleanupDelayMs;
      if (cleanupDelayMs > 0) {
        await sleep(cleanupDelayMs);
      }
    }

    // Use same tempDir mechanism for both environments
    const tempPath = await this.tempDir(testId);

    // Create DB with RuntimeTestConfig defaults
    const db = new GoatDB<S>({
      path: tempPath,
      ...runtime.testConfig.dbDefaults,
      ...config,
    });

    // Ensure DB is ready before returning
    try {
      await db.readyPromise();
    } catch (error) {
      // Clean up on initialization failure
      await db.close();
      throw new Error(
        `DB initialization failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Track this DB instance
    this._dbs.set(testId, db as unknown as GoatDB<Schema>);
    return db;
  }
}

/**
 * Calculates statistical metrics for a set of benchmark samples.
 *
 * This function computes the mean, min, max, 95th percentile (p95), 99th
 * percentile (p99), standard deviation, throughput (operations per second),
 * success rate, and other relevant statistics for a given array of sample
 * durations (in milliseconds).
 *
 * @param samples - Array of sample durations (in milliseconds) to analyze.
 * @param config - The benchmark configuration, used to determine warmup
 *                 iterations.
 * @param failures - (Optional) The number of failed iterations to include in
 *                   the success rate calculation. Defaults to 0.
 * @returns An object containing calculated statistics for the benchmark run.
 */
export function calculateStatistics(
  samples: number[],
  config: BenchmarkConfig,
  failures: number = 0,
): BenchmarkStatistics {
  // Sort the samples to facilitate percentile and min/max calculations
  const sorted = samples.slice().sort((a, b) => a - b);
  const n = sorted.length;

  // If there are no samples, return zeroed statistics
  if (n === 0) {
    return {
      mean: 0,
      min: 0,
      max: 0,
      p95: 0,
      p99: 0,
      stddev: 0,
      throughput: 0,
      successRate: 0,
      samples: 0,
      warmupIterations: config.warmup || 0,
      measuredIterations: 0,
    };
  }

  // Calculate the mean (average) duration
  const mean = samples.reduce((a, b) => a + b, 0) / n;

  // Calculate the variance and standard deviation
  const variance = samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) /
    n;
  const stddev = Math.sqrt(variance);

  // Calculate percentiles (p95 and p99)
  // Use Math.floor to get the index, fallback to the last sample if out of
  // bounds
  const p95 = sorted[Math.floor(n * 0.95)] || sorted[n - 1];
  const p99 = sorted[Math.floor(n * 0.99)] || sorted[n - 1];

  // Throughput is calculated as operations per second (1000 ms / mean duration)
  // If mean is zero, throughput is zero to avoid division by zero
  const throughput = mean > 0 ? 1000 / mean : 0;

  // Success rate is the ratio of successful samples to total attempts
  // (including failures)
  const successRate = n / (n + failures);

  return {
    mean,
    min: sorted[0],
    max: sorted[n - 1],
    p95,
    p99,
    std: stddev,
    stddev,
    throughput,
    successRate,
    samples: n,
    warmupIterations: config.warmup || 0,
    measuredIterations: n,
  };
}

/**
 * Get default benchmark configuration based on operation name
 */
export function getDefaultBenchmarkConfig(name: string): BenchmarkConfig {
  // I/O heavy operations - no warmup, fewer iterations
  if (
    name.includes('100k') || name.includes('Open database') ||
    name.includes('Open repository')
  ) {
    return { warmup: 0, iterations: 3 };
  }

  // Sync operations - expect some failures, more iterations for variance
  if (
    name.includes('Sync') || name.includes('sync') || name.includes('network')
  ) {
    return { warmup: 1, iterations: 12, expectFailures: true };
  }

  // Default: CPU-bound operations benefit from warmup
  return { warmup: 5, iterations: 10 };
}

/**
 * Detects the current JavaScript runtime environment.
 * Uses the RuntimeAdapter registry for detection.
 *
 * @returns {'deno' | 'node' | 'browser'} - The detected runtime.
 */
export function getRuntimeId(): 'deno' | 'node' | 'browser' {
  return getRuntime().id as 'deno' | 'node' | 'browser';
}
