/**
 * Assertion utilities for tests, compatible with Deno, Node, and the browser.
 *
 * This module provides simple assertion helpers for use in test suites.
 * These functions throw errors when assertions fail, making them suitable for
 * any JavaScript/TypeScript environment.
 */

import {
  getGlobalLoggerStreams,
  setGlobalLoggerStreams,
} from '../logging/log.ts';

/**
 * Custom error class for assertion failures.
 */
export class AssertionError extends Error {
  override readonly name = 'AssertionError';
}

/**
 * Asserts that a boolean value is true.
 * @param value - The boolean value to check
 * @param message - Optional error message to display if assertion fails
 * @throws {Error} If the value is false
 */
export function assertTrue(value: boolean, message?: string) {
  if (!value) {
    throw new AssertionError(message || 'Assertion failed');
  }
}

export function assertFalse(value: boolean, message?: string) {
  if (value) {
    throw new AssertionError(message || 'Expected false but got true');
  }
}

/**
 * Asserts that two values are equal, using strict equality or JSON string comparison.
 * @param actual - The actual value to check
 * @param expected - The expected value to compare against
 * @param message - Optional error message to display if assertion fails
 * @throws {Error} If the values are not equal
 */
export function assertEquals(
  actual: unknown,
  expected: unknown,
  message?: string,
) {
  if (
    actual !== expected && JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new AssertionError(
      message ||
        `assertEquals failed: expected ${JSON.stringify(expected)}, got ${
          JSON.stringify(actual)
        }`,
    );
  }
}

/**
 * Asserts that a value exists (is not null or undefined).
 * @param value - The value to check for existence
 * @param message - Optional error message to display if assertion fails
 * @throws {Error} If the value is null or undefined
 */
export function assertExists(
  value: unknown,
  message?: string,
): asserts value is NonNullable<typeof value> {
  if (value === undefined || value === null) {
    throw new AssertionError(
      message || `assertExists failed: value is ${value}`,
    );
  }
}

export function assertNotExists(value: unknown, message?: string) {
  if (value !== undefined && value !== null) {
    throw new AssertionError(
      message || `assertNotExists failed: value is ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Asserts that an array contains a specific value.
 * @param array - The array to check
 * @param value - The value to look for in the array
 * @param message - Optional error message to display if assertion fails
 * @throws {Error} If the array does not contain the value
 */
export function expectToContain(
  array: unknown[],
  value: unknown,
  message?: string,
) {
  if (!Array.isArray(array) || !array.includes(value)) {
    throw new AssertionError(
      message ||
        `expectToContain failed: array does not contain ${
          JSON.stringify(value)
        }`,
    );
  }
}

/**
 * Asserts that a function throws an error when called.
 *
 * Overloads:
 *   assertThrows(fn, message?)
 *   assertThrows(fn, ErrorClass, msgSubstring?)
 *
 * @param fn - The function expected to throw (may return a Promise)
 * @param errorClassOrMessage - Optional: an Error constructor to check instanceof, or a failure message string
 * @param msgSubstring - Optional substring that must appear in the thrown error's message
 * @throws {AssertionError} If the function does not throw, or the thrown error fails the optional checks
 */
export function assertThrows(
  fn: () => unknown,
  // deno-lint-ignore no-explicit-any
  errorClassOrMessage?: (new (...args: any[]) => Error) | string,
  msgSubstring?: string,
): void | Promise<void> {
  // deno-lint-ignore no-explicit-any
  const errorClass: (new (...args: any[]) => Error) | undefined =
    typeof errorClassOrMessage === 'function' ? errorClassOrMessage : undefined;
  const failMessage = typeof errorClassOrMessage === 'string'
    ? errorClassOrMessage
    : undefined;

  function checkCaughtError(e: unknown): void {
    if (errorClass !== undefined && !(e instanceof errorClass)) {
      throw new AssertionError(
        `Expected error to be instance of ${errorClass.name}, got ${
          e instanceof Error ? e.constructor.name : typeof e
        }`,
      );
    }
    if (
      msgSubstring !== undefined &&
      !(e instanceof Error && e.message.includes(msgSubstring))
    ) {
      throw new AssertionError(
        `Expected error message to include "${msgSubstring}", got: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  let isAsync = false;
  const logStreams = getGlobalLoggerStreams();
  setGlobalLoggerStreams([]);
  let threw = false;
  let caughtError: unknown;
  try {
    const result = fn();
    if (result instanceof Promise) {
      isAsync = true;
      setGlobalLoggerStreams(logStreams);
      return result.then(
        () => {
          throw new AssertionError(
            failMessage || 'Expected function to throw, but it did not',
          );
        },
        (e: unknown) => {
          checkCaughtError(e);
        },
      );
    }
  } catch (e) {
    threw = true;
    caughtError = e;
  } finally {
    if (!isAsync) setGlobalLoggerStreams(logStreams);
  }
  if (!threw) {
    throw new AssertionError(
      failMessage || 'Expected function to throw, but it did not',
    );
  }
  checkCaughtError(caughtError);
}

/**
 * Asserts that a number is less than another number.
 * @param actual - The actual number to check
 * @param expected - The number that actual should be less than
 * @param message - Optional error message to display if assertion fails
 * @throws {AssertionError} If actual is greater than or equal to expected
 */
export function assertLessThan(
  actual: number,
  expected: number,
  message?: string,
): void {
  if (actual >= expected) {
    throw new AssertionError(
      message || `Expected ${actual} to be less than ${expected}`,
    );
  }
}
