/**
 * Shared generator helpers for coroutine tests.
 */

// deno-lint-ignore require-yield
export function* fail(error: Error): Generator<void, void> {
  throw error;
}

// deno-lint-ignore require-yield
export function* record(
  order: string[],
  label: string,
): Generator<void, void> {
  order.push(label);
}
