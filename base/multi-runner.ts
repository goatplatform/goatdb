import { compileForNodeWithEsbuild, nodeRun } from './node-runner.ts';
import { runBrowserTests } from './browser-runner.ts';
import { parseWorkerTimeoutMs } from './worker-timeout.ts';
import { ProgressManager, type TaskId } from '../shared/progress.ts';
import { failureCount, TestsRunner, type TestSummary } from '../tests/mod.ts';

/**
 * Worker message types for Deno test execution.
 */
interface WorkerReadyMessage {
  type: 'ready';
  payload: { suiteCount: number; testCount: number };
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

interface WorkerHeartbeatMessage {
  type: 'heartbeat';
  payload: {
    suiteName: string;
    testName: string;
    elapsedMs: number;
  };
}

interface WorkerTestCompleteMessage {
  type: 'testComplete';
  payload: {
    suiteName: string;
    testName: string;
    passed: boolean;
    skipped: boolean;
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
  | WorkerTestStartMessage
  | WorkerHeartbeatMessage
  | WorkerTestCompleteMessage
  | WorkerDoneMessage;

/**
 * Runs Deno tests using a Web Worker for responsive TUI.
 * The main thread handles TUI rendering while the Worker executes tests.
 */
async function runDenoWithWorker(
  timeoutMs: number,
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
    let activeSuite: string | undefined;
    let activeTest: string | undefined;
    let activeTestElapsedMs: number | undefined;
    let lastHeartbeatAt: number | undefined;

    // Start animation interval for spinner updates (100ms)
    animationInterval = setInterval(() => {
      // Trigger re-render to animate spinners without updating progress
      if (rootId) {
        pm.triggerRender();
      }
    }, 100);

    // Set up worker timeout to prevent indefinite hangs. The diagnostic is
    // deliberately explicit: a bare duration cannot distinguish a slow suite
    // from a single blocked test.
    timeoutId = setTimeout(() => {
      const heartbeatAge = lastHeartbeatAt === undefined
        ? 'never received'
        : `${((performance.now() - lastHeartbeatAt) / 1000).toFixed(1)}s ago`;
      const active = activeTest === undefined
        ? 'none (between tests or during suite cleanup)'
        : `${activeSuite} > ${activeTest}`;
      const testElapsed = activeTestElapsedMs === undefined
        ? 'unknown'
        : `${(activeTestElapsedMs / 1000).toFixed(1)}s`;

      if (animationInterval) {
        clearInterval(animationInterval);
      }
      pm.finish();
      worker.terminate();
      reject(
        new Error(
          `Worker timeout after ${(timeoutMs / 60000).toFixed(1)} minutes. ` +
            `Active test: ${active}. Active test elapsed: ${testElapsed}. ` +
            `Last heartbeat: ${heartbeatAge}.`,
        ),
      );
    }, timeoutMs) as ReturnType<typeof setTimeout>;

    // Handle Worker messages
    worker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'ready': {
          // Worker is ready with test counts
          totalTests = payload.testCount;
          // Use null for indeterminate if no tests match filter, otherwise use suite count
          // (ProgressManager requires total > 0 or null)
          const rootTotal = payload.suiteCount > 0 ? payload.suiteCount : null;
          rootId = pm.create('Running Tests', rootTotal);
          pm.update(rootId, 0);
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

          activeSuite = suiteName;
          activeTest = testName;
          activeTestElapsedMs = 0;
          lastHeartbeatAt = performance.now();
          break;
        }

        case 'heartbeat': {
          const { suiteName, testName, elapsedMs } = payload;
          if (suiteName === activeSuite && testName === activeTest) {
            activeTestElapsedMs = elapsedMs;
            lastHeartbeatAt = performance.now();
          }
          break;
        }

        case 'testComplete': {
          // Test completed
          const { suiteName, testName, passed, skipped, duration, error } =
            payload;
          const testKey = `${suiteName}::${testName}`;
          const testId = testTaskIds.get(testKey);

          if (testId) {
            pm.complete(testId, passed ? 'done' : 'failed');
          }

          activeSuite = undefined;
          activeTest = undefined;
          activeTestElapsedMs = undefined;
          lastHeartbeatAt = undefined;

          completedTests++;
          if (passed) {
            passedCount++;
          } else if (!skipped) {
            failedCount++;
          }

          // Update root progress
          if (rootId) {
            const suitesDone = new Set(
              [...testTaskIds.keys()]
                .filter((k) => {
                  const id = testTaskIds.get(k);
                  return id !== undefined;
                })
                .map((k) => k.split('::')[0]),
            );
            pm.update(rootId, suitesDone.size);
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
  const runtimeFailures: string[] = [];

  // Parse once for every runtime path: debug/benchmark subprocesses, Node and
  // browser never arm the worker timer, so a bad override must fail here
  // instead of being silently ignored.
  const workerTimeoutMs = parseWorkerTimeoutMs(
    Deno.env.get('GOATDB_TEST_TIMEOUT_MS'),
  );

  const runDeno = config.runtimes.includes('deno');
  const runNode = config.runtimes.includes('node');
  const runBrowser = config.runtimes.includes('browser');

  // Run in Deno if configured
  if (runDeno) {
    console.log('=== 🦖 Running in Deno... ===');

    // Use Worker for responsive TUI, unless debugging (debugger needs main process)
    if (!config.denoInspectBrk && config.mode === 'test') {
      // Worker-based execution for tests
      let denoFailed = 0;
      try {
        const result = await runDenoWithWorker(
          workerTimeoutMs,
          config.suite,
          config.test,
        );
        denoElapsed = result.elapsed;
        TestsRunner.printSummary(result.summary);
        // Honors GOATDB_FAIL_ON_SKIP: a skip counts as a failure when set.
        denoFailed = failureCount(result.summary);

        if (denoFailed > 0) {
          console.log(`=== 🦖 Deno: ${denoFailed} failed ===`);
        } else {
          console.log(`=== 🦖 Deno: all passed ===`);
        }
      } catch (error) {
        console.error('=== 🦖 Deno Worker execution failed ===');
        const message = (error as Error).message;
        console.error('Error:', message);
        // Record the failure and keep going: a red Deno run must not hide Node
        // or browser results. The aggregate throw below still fails the process.
        runtimeFailures.push(`Deno worker execution failed: ${message}`);
      }
      if (denoFailed > 0) {
        runtimeFailures.push(`Deno tests failed: ${denoFailed}`);
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
      // Debug/benchmark runs bypass the worker summary, so this status is the
      // only failure signal. Inherited stdio keeps the output visible.
      const denoResult = await denoCmd.output();
      if (!denoResult.success) {
        runtimeFailures.push(
          `Deno execution failed (exit code ${denoResult.code}${
            denoResult.signal ? `, signal ${denoResult.signal}` : ''
          })`,
        );
      }

      const denoEnd = performance.now();
      denoElapsed = (denoEnd - denoStart) / 1000;
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

    // Compile with esbuild before timing
    const outName = 'cross-platform-entry';
    console.log('🛠️ Bundling with esbuild for Node.js...');
    const esbuildStart = performance.now();
    let esbuildResult:
      | Awaited<ReturnType<typeof compileForNodeWithEsbuild>>
      | undefined;
    try {
      esbuildResult = await compileForNodeWithEsbuild(
        config.entryPointServer,
        outName,
      );
      const esbuildEnd = performance.now();
      esbuildElapsed = (esbuildEnd - esbuildStart) / 1000;
      console.log(
        `🛠️ esbuild bundling completed in ${esbuildElapsed.toFixed(2)}s`,
      );
    } catch (error) {
      console.error('=== ⚡️ Node.js bundling failed ===');
      const message = (error as Error).message;
      console.error('Error:', message);
      // Record the failure and keep going: a red Deno run and the browser phase
      // must stay visible. The aggregate throw below still fails the process.
      runtimeFailures.push(`Node.js bundling failed: ${message}`);
    }

    if (esbuildResult !== undefined) {
      const nodeStart = performance.now();
      // Execute Node.js (timing only the Node.js phase)
      const nodeResult = await nodeRun(
        esbuildResult,
        config.nodeInspectBrk,
        nodeEnv,
      );
      if (!nodeResult.success) {
        runtimeFailures.push(
          `Node.js execution failed (exit code ${nodeResult.code})`,
        );
      }
      const nodeEnd = performance.now();
      nodeElapsed = (nodeEnd - nodeStart) / 1000;
    }
  }

  // Run in Browser if configured
  if (runBrowser) {
    console.log('=== 🌐 Running in Browser... ===');

    try {
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

      if (config.onBrowserResult) await config.onBrowserResult(summary);

      // Handle both test and benchmark result formats
      const browserSummary = summary.summary ?? summary;
      const failed = failureCount(browserSummary as TestSummary);
      const passed = browserSummary.passed ?? 0;

      TestsRunner.printSummary(browserSummary);

      if (failed > 0) {
        runtimeFailures.push(
          `Browser tests failed: ${failed} (${passed} passed)`,
        );
        console.log(
          `=== 🌐 Browser: ${passed} passed, ${failed} failed ===`,
        );
      } else {
        console.log(
          `=== 🌐 Browser: ${passed} passed ===`,
        );
      }
    } catch (error) {
      console.error('=== 🌐 Browser execution failed ===');
      const message = (error as Error).message;
      console.error('Error:', message);
      // Keep Node and any collected failures visible; the aggregate throw below
      // still fails the process.
      runtimeFailures.push(`Browser execution failed: ${message}`);
    }
  }

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

  if (runtimeFailures.length > 0) {
    throw new Error(runtimeFailures.join('; '));
  }

  return {
    denoElapsed,
    nodeElapsed,
    esbuildElapsed,
    browserElapsed,
    totalElapsed,
  };
}
