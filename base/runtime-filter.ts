import { formatNoMatchingTestsMessage } from '../tests/mod.ts';

export type RuntimeName = 'deno' | 'node' | 'browser';

export interface RuntimeMatchedOutcome {
  runtime: RuntimeName;
  status: 'matched';
}

export interface RuntimeNoMatchOutcome {
  runtime: RuntimeName;
  status: 'no-match';
}

export type RuntimeFilterOutcome =
  | RuntimeMatchedOutcome
  | RuntimeNoMatchOutcome;

export interface BrowserStructuredNoMatchResult {
  status: 'no-match';
  totalTests: number;
  passed: number;
  failed: number;
  duration: number;
  results: unknown[];
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  completed: boolean;
  exitCode: number;
}

export function isBrowserStructuredNoMatchResult(
  value: unknown,
): value is BrowserStructuredNoMatchResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const result = value as Partial<BrowserStructuredNoMatchResult>;
  const error = result.error;
  return result.status === 'no-match' &&
    result.totalTests === 0 &&
    result.passed === 0 &&
    result.failed === 0 &&
    typeof result.duration === 'number' &&
    Array.isArray(result.results) &&
    typeof error === 'object' &&
    error !== null &&
    typeof error.name === 'string' &&
    typeof error.message === 'string' &&
    (error.stack === undefined || typeof error.stack === 'string') &&
    result.completed === true &&
    typeof result.exitCode === 'number';
}

export function finalizeFilteredRuntimeOutcomes(
  outcomes: RuntimeFilterOutcome[],
  suite?: string,
  test?: string,
): void {
  if ((!suite && !test) || outcomes.length === 0) {
    return;
  }

  const matchedRuntimeCount =
    outcomes.filter((outcome) => outcome.status === 'matched').length;
  if (matchedRuntimeCount > 0) {
    return;
  }

  const noMatchRuntimeCount =
    outcomes.filter((outcome) => outcome.status === 'no-match').length;
  if (noMatchRuntimeCount === outcomes.length) {
    throw new Error(formatNoMatchingTestsMessage(suite, test));
  }
}
