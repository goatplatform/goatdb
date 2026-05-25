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
 *   Worker → Main (mutually exclusive paths):
 *     No-match path: { type: 'no-match', payload: { suiteName?, testName? } }
 *     Run path:      { type: 'ready', payload: { suiteCount, testCount } }
 *                    { type: 'testStart', payload: { suiteName, testName, current, total } }* (zero or more)
 *                    { type: 'testComplete', payload: { suiteName, testName, passed, duration, error? } }* (zero or more)
 *                    { type: 'done', payload: { exitCode, summary } }
 */

import { type TestResult, TestsRunner, type TestSummary } from './mod.ts';
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

interface TestCompleteMessage {
  type: 'testComplete';
  payload: {
    suiteName: string;
    testName: string;
    passed: boolean;
    duration: number;
    error?: {
      name: string;
      message: string;
      stack?: string;
    };
  };
}

interface NoMatchMessage {
  type: 'no-match';
  payload: {
    suiteName?: string;
    testName?: string;
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
  | NoMatchMessage
  | TestStartMessage
  | TestCompleteMessage
  | DoneMessage;

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
 * Runs tests and sends progress via postMessage.
 */
async function runTests(
  suiteName?: string,
  testName?: string,
): Promise<TestSummary> {
  const runner = TestsRunner.default;
  const allResults: TestResult[] = [];
  const runStart = performance.now();

  const { testCount } = TestsRunner.default.getTestCount(suiteName, testName);
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
      let passed = true;
      let error: Error | undefined;

      try {
        // Execute the test with suite context
        await testFn(suite);
      } catch (e) {
        passed = false;
        error = e instanceof Error ? e : new Error(String(e));
      }

      const duration = performance.now() - start;

      const result: TestResult = {
        suiteName: name,
        testName: tName,
        passed,
        duration,
        error,
      };
      allResults.push(result);

      // Notify main thread: test complete
      self.postMessage(
        {
          type: 'testComplete',
          payload: {
            suiteName: name,
            testName: tName,
            passed,
            duration,
            error: error ? serializeError(error) : undefined,
          },
        } satisfies TestCompleteMessage,
      );
    }

    // Clean up suite's temp directory (same as TestSuite.run() does)
    await suite.cleanup();
  }

  const totalDuration = performance.now() - runStart;
  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.length - passed;

  return {
    totalTests: allResults.length,
    passed,
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
    await registerAllTests();

    const { suiteCount, testCount } = TestsRunner.default.getTestCount(
      payload.suiteName,
      payload.testName,
    );

    // No tests match the filter — notify main thread and stop before posting
    // ready. This avoids creating a transient progress root that would get
    // immediately torn down by the no-match handler.
    if (testCount === 0 && (payload.suiteName || payload.testName)) {
      self.postMessage(
        {
          type: 'no-match',
          payload: {
            suiteName: payload.suiteName,
            testName: payload.testName,
          },
        } satisfies NoMatchMessage,
      );
      return;
    }

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
    const exitCode = summary.failed > 0 ? 1 : 0;
    self.postMessage(
      {
        type: 'done',
        payload: { exitCode, summary },
      } satisfies DoneMessage,
    );
  }
};
