import { compileForNodeWithEsbuild, nodeRun } from './node-runner.ts';
import {
  finalizeFilteredRuntimeOutcomes,
  isBrowserStructuredNoMatchResult,
  type RuntimeFilterOutcome,
} from './runtime-filter.ts';
import {
  EXIT_CODE_NO_MATCH,
  NO_MATCH_MESSAGE_PREFIX,
  NoMatchError,
} from './test-runner-error.ts';
import { ProgressManager, type TaskId } from '../shared/progress.ts';
import { TestsRunner, type TestSummary } from '../tests/mod.ts';

/**
 * Worker message types for Deno test execution.
 */
interface WorkerReadyMessage {
  type: 'ready';
  payload: { suiteCount: number; testCount: number };
}

interface WorkerNoMatchMessage {
  type: 'no-match';
  payload: { suiteName?: string; testName?: string };
}

interface WorkerTestStartMessage {
  type: 'testStart';
  payload: {
    suiteName: string;
    testName: string;
    current: number;
    total: number;
  };
}

interface WorkerTestCompleteMessage {
  type: 'testComplete';
  payload: {
    suiteName: string;
    testName: string;
    passed: boolean;
    duration: number;
    error?: { name: string; message: string; stack?: string };
  };
}

interface WorkerDoneMessage {
  type: 'done';
  payload: { exitCode: number; summary: TestSummary };
}

type WorkerOutgoingMessage =
  | WorkerReadyMessage
  | WorkerNoMatchMessage
  | WorkerTestStartMessage
  | WorkerTestCompleteMessage
  | WorkerDoneMessage;

/** Worker execution timeout (5 minutes) */
const WORKER_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Runs Deno tests using a Web Worker for responsive TUI.
 * The main thread handles TUI rendering while the Worker executes tests.
 */
async function runDenoWithWorker(
  suite?: string,
  test?: string,
): Promise<{ elapsed: number; summary: TestSummary }> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Create Worker
    const worker = new Worker(
      new URL('../tests/worker-runner.ts', import.meta.url).href,
      { type: 'module' },
    );

    // Progress manager for TUI
    const pm = new ProgressManager();
    let rootId: TaskId | undefined;
    const suiteTaskIds = new Map<string, TaskId>();
    const testTaskIds = new Map<string, TaskId>();
    let animationInterval: ReturnType<typeof setInterval> | undefined;
    let totalTests = 0;
    let completedTests = 0;
    let failedCount = 0;
    let passedCount = 0;
    let testSummary: TestSummary | undefined;

    // Start animation interval for spinner updates (100ms)
    animationInterval = setInterval(() => {
      // Trigger re-render to animate spinners without updating progress
      if (rootId) {
        pm.triggerRender();
      }
    }, 100);

    // Set up worker timeout to prevent indefinite hangs
    timeoutId = setTimeout(() => {
      if (animationInterval) {
        clearInterval(animationInterval);
      }
      pm.finish();
      worker.terminate();
      reject(
        new Error(
          `Worker timeout after ${WORKER_TIMEOUT_MS / 1000 / 60} minutes`,
        ),
      );
    }, WORKER_TIMEOUT_MS) as unknown as number;

    // Handle Worker messages
    worker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'ready': {
          // Worker is ready with test counts
          totalTests = payload.testCount;
          // suiteCount is expected > 0 at this point (no-match is caught earlier),
          // but null guards against an empty registry to avoid crashing ProgressManager.
          rootId = pm.create(
            'Running Tests',
            payload.suiteCount > 0 ? payload.suiteCount : null,
          );
          pm.update(rootId, 0);
          break;
        }

        case 'no-match': {
          if (timeoutId) clearTimeout(timeoutId);
          if (animationInterval) clearInterval(animationInterval);
          pm.finish();
          worker.terminate();
          reject(new NoMatchError(payload.suiteName, payload.testName));
          break;
        }

        case 'testStart': {
          // Test starting - create progress tasks if needed
          const { suiteName, testName, current, total } = payload;

          // Create suite task if not exists
          if (!suiteTaskIds.has(suiteName)) {
            const suiteId = pm.create(suiteName, 1, rootId);
            suiteTaskIds.set(suiteName, suiteId);
          }

          // Create test task
          const testKey = `${suiteName}::${testName}`;
          const suiteId = suiteTaskIds.get(suiteName)!;
          const testId = pm.create(testName, 1, suiteId);
          testTaskIds.set(testKey, testId);
          pm.update(testId, 0, 'running');
          break;
        }

        case 'testComplete': {
          // Test completed
          const { suiteName, testName, passed, duration, error } = payload;
          const testKey = `${suiteName}::${testName}`;
          const testId = testTaskIds.get(testKey);

          if (testId) {
            pm.complete(testId, passed ? 'done' : 'failed');
          }

          completedTests++;
          if (passed) {
            passedCount++;
          } else {
            failedCount++;
          }

          // Update root progress
          if (rootId) {
            const startedSuites = new Set(
              [...testTaskIds.keys()].map((k) => k.split('::')[0]),
            );
            pm.update(rootId, startedSuites.size);
          }
          break;
        }

        case 'done': {
          // All tests completed
          testSummary = payload.summary;

          // Cleanup
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          if (animationInterval) {
            clearInterval(animationInterval);
          }

          // Complete all tasks
          for (const suiteId of suiteTaskIds.values()) {
            pm.complete(suiteId);
          }
          if (rootId) {
            pm.complete(rootId);
          }
          pm.finish();

          // Terminate worker
          worker.terminate();

          const elapsed = (performance.now() - start) / 1000;
          resolve({ elapsed, summary: payload.summary });
          break;
        }
      }
    };

    // Handle Worker errors
    // Cleanup order: interval first (prevents animation during cleanup), then timeout, then finish
    worker.onerror = (error) => {
      if (animationInterval) clearInterval(animationInterval);
      if (timeoutId) clearTimeout(timeoutId);
      pm.finish();
      worker.terminate();
      reject(new Error(`Worker error: ${error.message}`));
    };

    // Start test execution
    worker.postMessage({
      type: 'run',
      payload: { suiteName: suite, testName: test },
    });
  });
}

/**
 * Configuration options for running code across multiple JavaScript runtimes.
 *
 * @property entryPointServer - Path to the entry point file for server-side
 *                             (Deno/Node) execution.
 * @property entryPointBrowser - Path to the entry point file for browser
 *                              execution.
 * @property suite - (Optional) Name of the test suite to run.
 * @property test - (Optional) Name of a specific test to run.
 * @property benchmark - (Optional) Name of a specific benchmark to run.
 * @property runtimes - Array of runtimes to execute in. Valid values: 'deno',
 *                      'node', 'browser'.
 * @property debug - (Optional) If true, enables debug mode for verbose output.
 * @property headless - (Optional) If true, runs browser in headless mode.
 * @property denoInspectBrk - (Optional) If true, runs Deno with the
 *                           --inspect-brk flag for debugging.
 * @property nodeInspectBrk - (Optional) If true, runs Node.js with the
 *                           --inspect-brk flag for debugging.
 * @property mode - (Optional) Run mode: 'test' for tests, 'benchmark' for
 *                  benchmarks.
 */
export interface RunConfig {
  entryPointServer: string;
  entryPointBrowser: string;
  suite?: string;
  test?: string;
  benchmark?: string;
  runtimes: Array<'deno' | 'node' | 'browser'>;
  debug?: boolean;
  headless?: boolean;
  denoInspectBrk?: boolean;
  nodeInspectBrk?: boolean;
  mode?: 'test' | 'benchmark';
  onBrowserResult?: (summary: unknown) => Promise<void>;
}

/**
 * Represents the timing results for running code across multiple runtimes.
 *
 * @property denoElapsed - Time elapsed (in milliseconds) for the Deno run.
 * @property nodeElapsed - Time elapsed (in milliseconds) for the Node.js run.
 * @property esbuildElapsed - Time elapsed (in milliseconds) for the esbuild
 *                            compilation step.
 * @property browserElapsed - Time elapsed (in milliseconds) for the browser run.
 * @property totalElapsed - Total time elapsed (in milliseconds) for all
 *                          configured runs.
 */
export interface RunResult {
  denoElapsed: number;
  nodeElapsed: number;
  esbuildElapsed: number;
  browserElapsed: number;
  totalElapsed: number;
}

/**
 * Runs TypeScript code across multiple JavaScript runtimes (Deno, Node.js,
 * Browser).
 * This is the generic orchestrator extracted from tests/run.ts.
 */
export async function runAcrossPlatforms(
  config: RunConfig,
): Promise<RunResult> {
  const start = performance.now();
  let denoElapsed = 0;
  let nodeElapsed = 0;
  let esbuildElapsed = 0;
  let browserElapsed = 0;
  const runtimeOutcomes: RuntimeFilterOutcome[] = [];

  const runDeno = config.runtimes.includes('deno');
  const runNode = config.runtimes.includes('node');
  const runBrowser = config.runtimes.includes('browser');
  const hasExactFilter = config.mode === 'test' &&
    (!!config.suite || !!config.test);
  const isAggregateRun = config.runtimes.length > 1;
  const shouldAllowRuntimeNoMatch = hasExactFilter && isAggregateRun;

  // Run in Deno if configured
  if (runDeno) {
    console.log('=== 🦖 Running in Deno... ===');

    // Use Worker for responsive TUI, unless debugging (debugger needs main process)
    if (!config.denoInspectBrk && config.mode === 'test') {
      // Worker-based execution for tests
      try {
        const result = await runDenoWithWorker(config.suite, config.test);
        denoElapsed = result.elapsed;
        TestsRunner.printSummary(result.summary);
        runtimeOutcomes.push({ runtime: 'deno', status: 'matched' });

        if (result.summary.failed > 0) {
          console.log(
            `=== 🦖 Deno: ${result.summary.failed} failed ===`,
          );
          throw new Error(`Deno tests failed: ${result.summary.failed} failed`);
        } else {
          console.log(`=== 🦖 Deno: all passed ===`);
        }
      } catch (error) {
        if (error instanceof NoMatchError && shouldAllowRuntimeNoMatch) {
          console.log(
            '=== 🦖 Deno: no matching tests in this runtime, skipping ===',
          );
          runtimeOutcomes.push({ runtime: 'deno', status: 'no-match' });
        } else {
          console.error('=== 🦖 Deno Worker execution failed ===');
          console.error('Error:', (error as Error).message);
          throw error;
        }
      }
    } else {
      // Subprocess execution for debugging or benchmarks
      const denoStart = performance.now();

      // Configure Deno command
      const denoArgs = ['run', '-A'];
      if (config.denoInspectBrk) {
        denoArgs.push('--inspect-brk');
      }
      denoArgs.push(config.entryPointServer);

      // Set up environment variables
      const denoEnv: Record<string, string> = { ...Deno.env.toObject() };
      if (config.suite) {
        denoEnv['GOATDB_SUITE'] = config.suite;
      }
      if (config.test) {
        denoEnv['GOATDB_TEST'] = config.test;
      }
      if (config.benchmark) {
        denoEnv['GOATDB_BENCHMARK'] = config.benchmark;
      }

      // Execute Deno
      const denoCmd = new Deno.Command('deno', {
        args: denoArgs,
        stdout: 'inherit',
        stderr: 'inherit',
        env: denoEnv,
      });
      const denoResult = await denoCmd.output();
      if (!denoResult.success) {
        if (denoResult.code === EXIT_CODE_NO_MATCH) {
          if (shouldAllowRuntimeNoMatch) {
            console.log(
              '=== 🦖 Deno: no matching tests in this runtime, skipping ===',
            );
            runtimeOutcomes.push({ runtime: 'deno', status: 'no-match' });
          } else {
            throw new NoMatchError(config.suite, config.test);
          }
        } else {
          throw new Error(
            `Deno execution failed with exit code ${denoResult.code}`,
          );
        }
      } else {
        const denoEnd = performance.now();
        denoElapsed = (denoEnd - denoStart) / 1000;
        runtimeOutcomes.push({ runtime: 'deno', status: 'matched' });
      }
    }
  }

  // Run in Node.js if configured
  if (runNode) {
    console.log('=== ⚡️ Running in Node.js... ===');

    // Set up environment variables
    const nodeEnv: Record<string, string> = { ...Deno.env.toObject() };
    if (config.suite) {
      nodeEnv['GOATDB_SUITE'] = config.suite;
    }
    if (config.test) {
      nodeEnv['GOATDB_TEST'] = config.test;
    }
    if (config.benchmark) {
      nodeEnv['GOATDB_BENCHMARK'] = config.benchmark;
    }

    // esbuild always runs; no-match is detected reactively after Node executes.
    const outName = 'cross-platform-entry';
    console.log('🛠️ Bundling with esbuild for Node.js...');
    const esbuildStart = performance.now();
    const esbuildResult = await compileForNodeWithEsbuild(
      config.entryPointServer,
      outName,
    );
    const esbuildEnd = performance.now();
    esbuildElapsed = (esbuildEnd - esbuildStart) / 1000;
    console.log(
      `🛠️ esbuild bundling completed in ${esbuildElapsed.toFixed(2)}s`,
    );

    const nodeStart = performance.now();
    // Execute Node.js (timing only the Node.js phase)
    const nodeResult = await nodeRun(
      esbuildResult,
      config.nodeInspectBrk,
      nodeEnv,
    );
    if (!nodeResult.success) {
      if (
        nodeResult.exitCode === EXIT_CODE_NO_MATCH &&
        nodeResult.stderrText.includes(NO_MATCH_MESSAGE_PREFIX)
      ) {
        if (shouldAllowRuntimeNoMatch) {
          console.log(
            '=== ⚡️ Node.js: no matching tests in this runtime, skipping ===',
          );
          runtimeOutcomes.push({ runtime: 'node', status: 'no-match' });
        } else {
          throw new NoMatchError(config.suite, config.test);
        }
      } else {
        throw new Error(
          `Node.js execution failed with exit code ${nodeResult.exitCode}`,
        );
      }
    } else {
      const nodeEnd = performance.now();
      nodeElapsed = (nodeEnd - nodeStart) / 1000;
      runtimeOutcomes.push({ runtime: 'node', status: 'matched' });
      console.log('=== ⚡️ Node.js: all passed ===');
    }
  }

  // Run in Browser if configured
  if (runBrowser) {
    console.log('=== 🌐 Running in Browser... ===');

    let browserTestFailure: Error | undefined;
    try {
      const { runBrowserTests } = await import('./browser-runner.ts');
      const browserStart = performance.now();
      const summary = await runBrowserTests({
        suite: config.suite,
        test: config.test,
        benchmark: config.benchmark,
        debug: config.debug,
        headless: config.headless,
        mode: config.mode || 'test',
      });

      const browserEnd = performance.now();
      browserElapsed = (browserEnd - browserStart) / 1000;

      if (config.mode === 'test' && isBrowserStructuredNoMatchResult(summary)) {
        console.log('=== 🌐 Browser: no matching tests in this runtime, skipping ===');
        runtimeOutcomes.push({ runtime: 'browser', status: 'no-match' });
      } else {
        runtimeOutcomes.push({ runtime: 'browser', status: 'matched' });
      }

      if (config.onBrowserResult) await config.onBrowserResult(summary);

      // Handle both test and benchmark result formats
      const browserSummary = summary.summary ?? summary;
      const failed = browserSummary.failed ?? 0;
      const passed = browserSummary.passed ?? 0;

      if (!isBrowserStructuredNoMatchResult(summary)) {
        TestsRunner.printSummary(browserSummary);
      }

      if (isBrowserStructuredNoMatchResult(summary)) {
        // No per-runtime browser tests matched the exact filter.
      } else if (failed > 0) {
        console.log(
          `=== 🌐 Browser: ${passed} passed, ${failed} failed ===`,
        );
        browserTestFailure = new Error(
          `Browser tests failed: ${failed} failed`,
        );
      } else {
        console.log(
          `=== 🌐 Browser: ${passed} passed ===`,
        );
      }
    } catch (error) {
      console.error('=== 🌐 Browser execution failed ===');
      console.error('Error:', (error as Error).message);
      throw error;
    }
    if (browserTestFailure) throw browserTestFailure;
  }

  finalizeFilteredRuntimeOutcomes(
    runtimeOutcomes,
    config.suite,
    config.test,
  );

  // Print summary of execution times
  const end = performance.now();
  const totalElapsed = (end - start) / 1000;
  let summary = '=== 🕒 Summary:';
  if (runDeno) {
    summary += ` Deno: ${denoElapsed.toFixed(2)}s`;
  }
  if (runNode) {
    summary += ` | esbuild: ${esbuildElapsed.toFixed(2)}s | Node.js: ${
      nodeElapsed.toFixed(2)
    }s`;
  }
  if (runBrowser) {
    summary += ` | Browser: ${browserElapsed.toFixed(2)}s`;
  }
  summary += ` | Total: ${totalElapsed.toFixed(2)}s ===`;
  console.log(summary);

  return {
    denoElapsed,
    nodeElapsed,
    esbuildElapsed,
    browserElapsed,
    totalElapsed,
  };
}
