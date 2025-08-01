/**
 * Make all properties in T writable.
 * @internal
 */
export type Readwrite<T> = {
  -readonly [P in keyof T]: T[P];
};
