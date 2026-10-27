/**
 * Worker entry point for test execution.
 *
 * This module runs in a Web Worker, separate from the main thread.
 * It executes tests and sends progress updates via postMessage,
 * allowing the main thread to render the TUI without blocking.
 *
 * Communication Protocol:
 *   Main → Worker:
 *     { type: 'run', payload: { suiteName?: string, testName?: string } }
 *
 *   Worker → Main:
 *     { type: 'ready', payload: { suiteCount, testCount } }
 *     { type: 'testStart', payload: { suiteName, testName, current, total } }
 *     { type: 'heartbeat', payload: { suiteName, testName, elapsedMs } }
 *     { type: 'testComplete', payload: { suiteName, testName, passed, skipped, duration, error? } }
 *     { type: 'done', payload: { exitCode, summary } }
 */

import {
  runTestCase,
  summaryExitCode,
  type TestResult,
  TestsRunner,
  type TestSummary,
} from './mod.ts';
import { registerAllTests } from './test-registry.ts';

/**
 * Message types for Worker ↔ Main thread communication.
 */
interface WorkerMessage {
  type: 'run';
  payload: {
    suiteName?: string;
    testName?: string;
  };
}

interface ReadyMessage {
  type: 'ready';
  payload: {
    suiteCount: number;
    testCount: number;
  };
}

interface TestStartMessage {
  type: 'testStart';
  payload: {
    suiteName: string;
    testName: string;
    current: number;
    total: number;
  };
}

interface HeartbeatMessage {
  type: 'heartbeat';
  payload: {
    suiteName: string;
    testName: string;
    elapsedMs: number;
  };
}

interface TestCompleteMessage {
  type: 'testComplete';
  payload: {
    suiteName: string;
    testName: string;
    passed: boolean;
    skipped: boolean;
    duration: number;
    error?: {
      name: string;
      message: string;
      stack?: string;
    };
  };
}

interface DoneMessage {
  type: 'done';
  payload: {
    exitCode: number;
    summary: TestSummary;
  };
}

type OutgoingMessage =
  | ReadyMessage
  | TestStartMessage
  | HeartbeatMessage
  | TestCompleteMessage
  | DoneMessage;

/**
 * How often the worker reports that it is still alive. The main thread treats a
 * stale heartbeat as evidence that the active test blocked the event loop
 * (for example a synchronous loop or an unbounded subprocess wait).
 */
const kHeartbeatIntervalMs = 10_000;

/**
 * Serializes an Error for postMessage (Error objects don't serialize).
 */
function serializeError(
  error: Error,
): { name: string; message: string; stack?: string } {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

/**
 * Registers all test suites with the default TestsRunner.
 * Delegates to central test-registry.ts for consistency.
 */
async function setupAllTests(): Promise<void> {
  await registerAllTests();
}

/**
 * Counts tests matching the filter.
 */
function countTests(suiteName?: string, testName?: string): {
  suiteCount: number;
  testCount: number;
} {
  return TestsRunner.default.getTestCount(suiteName, testName);
}

/**
 * Runs tests and sends progress via postMessage.
 */
async function runTests(
  suiteName?: string,
  testName?: string,
): Promise<TestSummary> {
  const runner = TestsRunner.default;
  const allResults: TestResult[] = [];
  const runStart = performance.now();

  const { testCount } = countTests(suiteName, testName);
  let currentTest = 0;

  const suites = runner.getSuites();

  for (const [name, suite] of suites.entries()) {
    if (suiteName && name !== suiteName) continue;

    const tests = suite.getTests();

    for (const [tName, testFn] of tests.entries()) {
      if (testName && tName !== testName) continue;

      currentTest++;

      // Notify main thread: test starting
      self.postMessage(
        {
          type: 'testStart',
          payload: {
            suiteName: name,
            testName: tName,
            current: currentTest,
            total: testCount,
          },
        } satisfies TestStartMessage,
      );

      const start = performance.now();
      const heartbeat = setInterval(() => {
        self.postMessage(
          {
            type: 'heartbeat',
            payload: {
              suiteName: name,
              testName: tName,
              elapsedMs: performance.now() - start,
            },
          } satisfies HeartbeatMessage,
        );
      }, kHeartbeatIntervalMs);

      let result: TestResult;
      try {
        result = await runTestCase(suite, tName, testFn);
      } finally {
        clearInterval(heartbeat);
      }
      allResults.push(result);

      // Notify main thread: test complete
      self.postMessage(
        {
          type: 'testComplete',
          payload: {
            suiteName: name,
            testName: tName,
            passed: result.passed,
            skipped: result.skipped,
            duration: result.duration,
            error: result.error ? serializeError(result.error) : undefined,
          },
        } satisfies TestCompleteMessage,
      );
    }

    // Clean up suite's temp directory (same as TestSuite.run() does)
    await suite.cleanup();
  }

  const totalDuration = performance.now() - runStart;
  const passed = allResults.filter((r) => r.passed).length;
  const skipped = allResults.filter((r) => r.skipped).length;
  const failed = allResults.length - passed - skipped;

  return {
    totalTests: allResults.length,
    passed,
    skipped,
    failed,
    duration: totalDuration,
    results: allResults,
  };
}

/**
 * Worker message handler.
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;

  if (type === 'run') {
    // Setup all tests first
    await setupAllTests();

    const { suiteCount, testCount } = countTests(
      payload.suiteName,
      payload.testName,
    );

    // Notify main thread: ready with counts
    self.postMessage(
      {
        type: 'ready',
        payload: { suiteCount, testCount },
      } satisfies ReadyMessage,
    );

    // Run the tests
    const summary = await runTests(payload.suiteName, payload.testName);

    // Notify main thread: all done
    const exitCode = summaryExitCode(summary);
    self.postMessage(
      {
        type: 'done',
        payload: { exitCode, summary },
      } satisfies DoneMessage,
    );
  }
};
