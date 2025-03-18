export function assertTrue(value: boolean) {
  if (!value) {
    throw new Error('Assertion failed');
  }
}
