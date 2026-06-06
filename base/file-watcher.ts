/**
 * Cross-runtime file watching abstraction.
 *
 * Provides a unified interface for watching file system changes across
 * Deno and Node.js environments.
 *
 * @module GoatDB/FileWatcher
 */
import { isDeno, isNode } from './common.ts';
import { notReached } from './error.ts';
import { log } from '../logging/log.ts';

/**
 * Represents a file system change event.
 */
export interface FileWatchEvent {
  /** The paths that changed */
  paths: string[];
  /** The type of change */
  kind: 'create' | 'modify' | 'remove' | 'any';
}

/**
 * Interface for a file system watcher.
 */
export interface FileWatcher {
  /** Async iterator that yields file change events */
  [Symbol.asyncIterator](): AsyncIterableIterator<FileWatchEvent>;
  /** Closes the watcher and releases resources */
  close(): void;
}

const kDefaultIgnored = ['node_modules', '.git', 'server-data', 'build'];

/**
 * Determines if a file change should trigger a rebuild.
 *
 * @param p The changed path (relative to watch directory)
 * @param ignored List of directories to ignore (defaults to common ignored dirs)
 * @returns true if the change should trigger a rebuild
 */
export function shouldRebuildAfterPathChange(
  p: string,
  ignored: string[] = kDefaultIgnored,
): boolean {
  // Deno writes .tmp during live-reload before atomic swap; skip to avoid spurious rebuilds
  if (p.endsWith('.tmp')) {
    return false;
  }
  // Ignore paths where any of the components start with '.' or are in ignored list
  const components = p.split(/[/\\]/);
  for (const comp of components) {
    if (comp.startsWith('.') || ignored.includes(comp)) {
      return false;
    }
  }
  return true;
}

/**
 * Creates a file watcher for the specified directory.
 *
 * @param dir The directory to watch
 * @returns A FileWatcher instance
 * @throws If called in an unsupported runtime (browser)
 */
export async function watchDirectory(dir: string): Promise<FileWatcher> {
  if (isDeno()) {
    return createDenoWatcher(dir);
  } else if (isNode()) {
    return await createNodeWatcher(dir);
  }
  notReached('File watching not supported in browser');
}

function createDenoWatcher(dir: string): FileWatcher {
  const watcher = Deno.watchFs(dir);
  let closed = false;
  let watcherClosed = false;

  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of watcher) {
        if (closed) break;
        yield {
          paths: event.paths,
          kind: event.kind as FileWatchEvent['kind'],
        };
      }
    },
    close() {
      if (watcherClosed) return;
      watcherClosed = true;
      closed = true;
      watcher.close();
    },
  };
}

async function createNodeWatcher(dir: string): Promise<FileWatcher> {
  // Try chokidar first (more reliable for recursive watching)
  let chokidarModule;
  try {
    chokidarModule = await import('chokidar');
  } catch {
    const fs = await import('node:fs');
    return await createNativeFsWatcher(fs, dir);
  }
  return createChokidarWatcher(chokidarModule.default || chokidarModule, dir);
}

/**
 * Creates a FileWatcher with event queue and async iterator.
 * Extracts common pattern from chokidar and native fs implementations.
 */
function createQueuedWatcher(
  onClose: () => void,
): { pushEvent: (event: FileWatchEvent) => void; watcher: FileWatcher } {
  const eventQueue: FileWatchEvent[] = [];
  let resolveNext: ((value: FileWatchEvent) => void) | null = null;
  let closed = false;
  let cleanedUp = false;

  function cleanup(): void {
    if (cleanedUp) return;
    cleanedUp = true;
    closed = true;
    if (resolveNext) {
      resolveNext({ paths: [], kind: 'any' });
      resolveNext = null;
    }
    onClose();
  }

  return {
    pushEvent(event: FileWatchEvent) {
      if (closed) return;
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        eventQueue.push(event);
      }
    },
    watcher: {
      async *[Symbol.asyncIterator]() {
        try {
          while (!closed) {
            if (eventQueue.length > 0) {
              yield eventQueue.shift()!;
            } else {
              const event = await new Promise<FileWatchEvent>((resolve) => {
                resolveNext = resolve;
              });
              if (!closed) {
                yield event;
              }
            }
          }
        } finally {
          cleanup();
        }
      },
      close() {
        cleanup();
      },
    },
  };
}

function createChokidarWatcher(
  chokidar: typeof import('chokidar'),
  dir: string,
): FileWatcher {
  const underlying = chokidar.watch(dir, {
    ignored: kDefaultIgnored,
    persistent: true,
    ignoreInitial: true,
  });

  const { pushEvent, watcher } = createQueuedWatcher(() => underlying.close());

  underlying.on(
    'add',
    (path: string) => pushEvent({ paths: [path], kind: 'create' }),
  );
  underlying.on(
    'change',
    (path: string) => pushEvent({ paths: [path], kind: 'modify' }),
  );
  underlying.on(
    'unlink',
    (path: string) => pushEvent({ paths: [path], kind: 'remove' }),
  );

  return watcher;
}

async function createNativeFsWatcher(
  fs: typeof import('node:fs'),
  dir: string,
): Promise<FileWatcher> {
  const process = globalThis.process;
  // On Windows, recursive fs.watch via libuv has a known assertion crash
  // (src/win/fs-event.c:72, _wcsnicmp mismatch) due to short-path name
  // normalization. This is a regression in Node.js 24.16.0, tracked at
  // https://github.com/libuv/libuv/issues/5010. Use polling instead.
  if (process.platform === 'win32') {
    log({
      severity: 'WARNING',
      message: 'chokidar not available, using polling fallback on Windows',
    });
    return await createPollingWatcher(fs, dir);
  }

  log({
    severity: 'WARNING',
    message:
      'chokidar not available, using native fs.watch (may be unreliable on some platforms)',
  });

  // Resolve 8.3 short names to long paths on Windows to prevent libuv
  // assertion crash. Currently unreachable since Windows uses polling,
  // but kept for defense-in-depth if the branch above changes.
  let watchDir = dir;
  try {
    watchDir = fs.realpathSync(dir);
  } catch {
    // Fall through to original dir if resolution fails.
  }
  const underlying = fs.watch(watchDir, { recursive: true });

  const { pushEvent, watcher } = createQueuedWatcher(() => underlying.close());

  underlying.on('change', (eventType, filename) => {
    if (!filename) return;
    const kind: FileWatchEvent['kind'] = eventType === 'rename'
      ? 'any'
      : 'modify';
    pushEvent({ paths: [String(filename)], kind });
  });

  return watcher;
}

/**
 * Polling-based file watcher for Windows.
 *
 * Recursive fs.watch on Windows is unreliable due to a libuv assertion crash
 * (Node.js 24.16.0 regression, libuv#5010). This fallback periodically scans
 * the directory tree and emits events for new, modified, and deleted files.
 *
 * @param fs The node:fs module
 * @param dir The directory to watch
 * @param pollMs Polling interval in milliseconds (default 1000)
 * @returns A FileWatcher instance
 */
export async function createPollingWatcher(
  fs: typeof import('node:fs'),
  dir: string,
  pollMs: number = 1000,
  onPollCycle?: () => void,
): Promise<FileWatcher> {
  const { join } = await import('node:path');

  let pollerClosed = false;
  let previousState: Map<string, { mtimeMs: number; size: number }>;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let rootMissing = false;

  function isMissingFileSystemError(err: unknown): boolean {
    const code = (err as { code?: string } | null | undefined)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }

  function getRootStatus(): 'present' | 'missing' | 'unreadable' {
    try {
      fs.readdirSync(dir);
      return 'present';
    } catch (err) {
      return isMissingFileSystemError(err) ? 'missing' : 'unreadable';
    }
  }
  // Throttle per-path to at most one DEBUG log per 60s to avoid log floods
  // from persistently broken paths (e.g., permission denied, raced deletion).
  const lastFailureLog = new Map<string, number>();
  function logFailureThrottled(path: string, msg: string): void {
    const now = Date.now();
    const last = lastFailureLog.get(path) ?? 0;
    if (now - last >= 60_000) {
      lastFailureLog.set(path, now);
      log({ severity: 'DEBUG', message: msg });
    }
  }

  const { pushEvent, watcher } = createQueuedWatcher(() => {
    pollerClosed = true;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  });

  // Walk the directory tree and return a snapshot of absolute file path ->
  // change fingerprint. Size is tracked alongside mtimeMs because some
  // filesystems coarsen mtimes during rapid rewrites.
  function scan(): Map<string, { mtimeMs: number; size: number }> {
    const result = new Map<string, { mtimeMs: number; size: number }>();
    const walk = (currentDir: string): void => {
      let entries: string[];
      try {
        entries = fs.readdirSync(currentDir);
      } catch (err) {
        if (currentDir === dir && isMissingFileSystemError(err)) {
          return; // Root deletion is expected and handled by poll().
        }
        logFailureThrottled(
          currentDir,
          `Failed to read directory: ${currentDir}`,
        );
        return; // deleted or permission denied
      }
      for (const entry of entries) {
        if (kDefaultIgnored.includes(entry)) continue;
        const fullPath = join(currentDir, entry);
        try {
          const stat = fs.lstatSync(fullPath);
          if (stat.isSymbolicLink()) continue; // skip symlinks to prevent escape/cycle
          if (stat.isDirectory()) {
            walk(fullPath);
          } else {
            result.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size });
          }
        } catch {
          logFailureThrottled(fullPath, `Failed to stat file: ${fullPath}`);
          // raced with deletion
        }
      }
    };
    walk(dir);
    return result;
  }

  // Use recursive setTimeout instead of setInterval to prevent concurrent
  // scan() executions if one cycle takes longer than pollMs.
  function poll(): void {
    if (pollerClosed) return;
    const currentState = scan();

    // Empty snapshots are ambiguous: the tree may truly be empty, the root may
    // be deleted, or the root may be temporarily unreadable. Emit one root-
    // level event only on the transition to a missing root; unreadable roots
    // stay quiet to avoid false delete/recreate churn.
    if (currentState.size === 0) {
      const rootStatus = getRootStatus();
      if (rootStatus === 'missing') {
        if (!rootMissing) {
          pushEvent({ paths: [dir], kind: 'any' });
          rootMissing = true;
        }
        previousState = currentState;
        onPollCycle?.();
        if (!pollerClosed) {
          timeoutId = setTimeout(poll, pollMs);
        }
        return;
      }
      if (rootStatus === 'unreadable') {
        rootMissing = false;
        onPollCycle?.();
        if (!pollerClosed) {
          timeoutId = setTimeout(poll, pollMs);
        }
        return;
      }
      rootMissing = false;
    } else {
      rootMissing = false;
    }

    // New or modified files
    for (const [filePath, { mtimeMs, size }] of currentState) {
      const prev = previousState.get(filePath);
      if (prev === undefined) {
        pushEvent({ paths: [filePath], kind: 'create' });
      } else if (mtimeMs !== prev.mtimeMs || size !== prev.size) {
        pushEvent({ paths: [filePath], kind: 'modify' });
      }
    }

    // Deleted files
    for (const filePath of previousState.keys()) {
      if (!currentState.has(filePath)) {
        pushEvent({ paths: [filePath], kind: 'remove' });
      }
    }

    previousState = currentState;
    onPollCycle?.();
    if (!pollerClosed) {
      timeoutId = setTimeout(poll, pollMs);
    }
  }

  // Initial snapshot + start polling
  previousState = scan();
  timeoutId = setTimeout(poll, pollMs);

  return watcher;
}
