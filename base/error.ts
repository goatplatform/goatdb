import { log } from '../logging/log.ts';

export function notImplemented(): never {
  const error = new Error('Not Implemented');
  log({ severity: 'ERROR', error: 'NotImplemented', trace: error.stack });
  throw error;
}

export function notReached(msg?: string): never {
  const error = new Error(msg);
  log({
    severity: 'ERROR',
    error: 'NotReached',
    message: msg,
    trace: error.stack,
  });
  throw error;
}

export function assert(condition: boolean, msg?: string): asserts condition {
  if (!condition) {
    msg = msg ? `Failed Assertion: "${msg}"` : 'Failed Assertion';
    const error = new Error(msg);
    log({
      severity: 'ERROR',
      error: 'FailedAssertion',
      message: msg,
      trace: error.stack,
    });
    throw error;
  }
}

/**
 * Formats a human-readable message for when no tests match the provided filters.
 */
export function formatNoMatchingTestsMessage(
  suiteName?: string,
  testName?: string,
): string {
  const filters: string[] = [];
  if (suiteName) {
    filters.push(`--suite=${JSON.stringify(suiteName)}`);
  }
  if (testName) {
    filters.push(`--test=${JSON.stringify(testName)}`);
  }
  if (filters.length === 0) {
    notReached('NoMatchError requires at least one filter');
  }
  return `No tests matched ${filters.join(' ')}`;
}

/** Exit code used when no tests match the provided --suite/--test filters. */
export const EXIT_CODE_NO_MATCH = 2;

/**
 * Thrown when no tests match the provided --suite/--test filters.
 * Uses instanceof checks instead of string matching for reliable error handling.
 */
export class NoMatchError extends Error {
  constructor(suiteName?: string, testName?: string) {
    super(formatNoMatchingTestsMessage(suiteName, testName));
    this.name = 'NoMatchError';
  }
}
