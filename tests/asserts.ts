/**
 * Assertion utilities for tests, compatible with Deno, Node, and the browser.
 *
 * This module provides simple assertion helpers for use in test suites.
 * These functions throw errors when assertions fail, making them suitable for
 * any JavaScript/TypeScript environment.
 */

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
export function assertExists(value: unknown, message?: string) {
  if (value === undefined || value === null) {
    throw new AssertionError(
      message || `assertExists failed: value is ${value}`,
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
 * @param fn - The function expected to throw
 * @param message - Optional error message to display if assertion fails
 * @throws {AssertionError} If the function does not throw
 */
export function assertThrows(
  fn: () => unknown | Promise<unknown>,
  message?: string,
): void | Promise<void> {
  let threw = false;
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        () => {
          throw new AssertionError(
            message || 'Expected function to throw, but it did not',
          );
        },
        () => {
          // Threw as expected (rejected)
        },
      );
    }
  } catch (_e) {
    threw = true;
  }
  if (!threw) {
    throw new AssertionError(
      message || 'Expected function to throw, but it did not',
    );
  }
}
