/**
 * Make all properties in T writable.
 */
export type Readwrite<T> = {
  -readonly [P in keyof T]: T[P];
};
