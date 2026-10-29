// Ambient declarations for the optional, untyped chokidar dependency.
// Used by the npm type check (tsconfig.npm.json); tsup does not bundle it.
declare module 'chokidar' {
  export interface FSWatcher {
    on(
      event: 'add' | 'change' | 'unlink',
      listener: (path: string) => void,
    ): FSWatcher;
    close(): void | Promise<void>;
  }

  export function watch(
    paths: string | string[],
    options?: {
      ignored?: unknown;
      persistent?: boolean;
      ignoreInitial?: boolean;
    },
  ): FSWatcher;

  export default { watch };
}
