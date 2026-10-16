/**
 * Filesystem error identity shared by every FileImpl.
 *
 * WHY: reading a directory must fail on every runtime. Windows reports a
 * directory's length as 0 (Win32 file size describes a data stream), so the
 * size-driven read loop never fires and the OS never raises EISDIR. The impls
 * therefore reject directories at open() and throw this normalized error, so
 * callers and the worker error transport (which preserves name + code) see one
 * stable identity. Regression contracts: worker-boundary identity in
 * tests/json-log-worker-io.test.ts; per-impl behavior in tests/file-impl.test.ts.
 */
export function eisdirError(path: string): Error {
  return Object.assign(
    new Error(`EISDIR: illegal operation on a directory, open '${path}'`),
    { code: 'EISDIR' },
  );
}
