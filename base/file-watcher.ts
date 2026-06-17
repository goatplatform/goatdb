/**
 * Cross-runtime file watching abstraction.
 *
 * Provides a unified interface for watching file system changes across
 * Deno and Node.js environments. Node-based watchers suppress hidden
 * paths before events reach callers when the underlying backend exposes
 * enough path information to identify them reliably.
 *
 * @module GoatDB/FileWatcher
 */
import { getRuntime } from './runtime/index.ts';
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
  /**
   * Async iterator that yields file change events.
   * When close() is called while the iterator is awaiting the next event,
   * the pending await is resolved immediately, allowing the iterator to
   * terminate cleanly.
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<FileWatchEvent>;
  /** Closes the watcher and releases resources */
  close(): void;
}

interface ChokidarLikeWatcher {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): ChokidarLikeWatcher;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, handler: (...args: any[]) => void): ChokidarLikeWatcher;
  close(): void;
}

interface ChokidarLike {
  watch(path: string, options: Record<string, unknown>): ChokidarLikeWatcher;
}

const kDefaultIgnored = ['node_modules', '.git', 'server-data', 'build'];

/**
 * Returns true when any path component is a dotfile (starts with '.')
 * or belongs to a known ignored directory.
 *
 * Dotfiles are excluded because they are not application data; watching
 * them wastes scan cycles and delays the chokidar ready signal past
 * the files that actually matter.
 */
function pathHasIgnoredComponent(
  p: string,
  ignored: string[] = kDefaultIgnored,
): boolean {
  const components = p.split(/[/\\]/);
  return components.some((comp) =>
    // Exclude '.' and '..' — they are path traversal components, not dotfiles.
    (comp !== '.' && comp !== '..' && comp.startsWith('.')) ||
    ignored.includes(comp)
  );
}

/**
 * Normalize an absolute chokidar path relative to the watch root, so
 * that `pathHasIgnoredComponent` checks only components under the root.
 * Paths outside the root are returned unchanged so they are evaluated
 * against the full absolute path. Handles both POSIX and Windows.
 */
/** @internal */
export function relativeWatchedPath(
  watchedPath: string,
  normalizedDir: string,
  posix: typeof import('node:path').posix,
  win32: typeof import('node:path').win32,
): string {
  const pathApi = watchedPath.includes('\\') || normalizedDir.includes('\\')
    ? win32
    : posix;
  if (!pathApi.isAbsolute(watchedPath)) return watchedPath;
  const relativePath = pathApi.relative(normalizedDir, watchedPath);
  // Accept empty string (root itself) or forward-relative paths;
  // reject ..-prefixed and absolute paths (outside root).
  if (
    relativePath === '' || (!relativePath.startsWith('..') &&
      !pathApi.isAbsolute(relativePath))
  ) {
    return relativePath;
  }
  return watchedPath;
}

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
  return !pathHasIgnoredComponent(p, ignored);
}

/**
 * Creates a file watcher for the specified directory.
 *
 * @param dir The directory to watch
 * @returns A FileWatcher instance
 * @throws If called in an unsupported runtime (browser)
 */
export async function watchDirectory(dir: string): Promise<FileWatcher> {
  const runtime = getRuntime().id;
  if (runtime === 'deno') {
    return createDenoWatcher(dir);
  } else if (runtime === 'node') {
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

const kChokidarSpecifier = 'chokidar';

async function createNodeWatcher(dir: string): Promise<FileWatcher> {
  // Try chokidar first (more reliable for recursive watching)
  let chokidarModule;
  try {
    chokidarModule = await import(kChokidarSpecifier);
  } catch {
    const fs = await import('node:fs');
    return await createNativeFsWatcher(fs, dir);
  }
  return await createChokidarWatcher(
    chokidarModule.default || chokidarModule,
    dir,
  );
}

/**
 * Creates a FileWatcher with event queue and async iterator.
 * Extracts common pattern from chokidar and native fs implementations.
 */
function createQueuedWatcher(
  onClose: () => void,
): {
  pushEvent: (event: FileWatchEvent) => void;
  fail: (err: unknown) => void;
  watcher: FileWatcher;
} {
  const eventQueue: FileWatchEvent[] = [];
  let resolveNext: ((value: FileWatchEvent) => void) | null = null;
  let rejectNext: ((reason?: unknown) => void) | null = null;
  let closed = false;
  let cleanedUp = false;
  let terminalError: Error | undefined;

  function cleanup(): void {
    if (cleanedUp) return;
    cleanedUp = true;
    closed = true;
    if (resolveNext) {
      resolveNext({ paths: [], kind: 'any' });
      resolveNext = null;
      rejectNext = null;
    }
    onClose();
  }

  return {
    pushEvent(event: FileWatchEvent) {
      if (closed || terminalError) return;
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
        rejectNext = null;
      } else {
        eventQueue.push(event);
      }
    },
    fail(err: unknown) {
      if (closed || terminalError) return;
      terminalError = err instanceof Error ? err : new Error(String(err));
      eventQueue.length = 0;
      closed = true;
      cleanedUp = true;
      if (rejectNext) {
        rejectNext(terminalError);
        resolveNext = null;
        rejectNext = null;
      }
      onClose();
    },
    watcher: {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            if (terminalError) throw terminalError;
            if (eventQueue.length > 0) {
              yield eventQueue.shift()!;
              continue;
            }
            if (closed) break;
            const event = await new Promise<FileWatchEvent>(
              (resolve, reject) => {
                resolveNext = resolve;
                rejectNext = reject;
              },
            );
            if (terminalError) throw terminalError;
            if (!closed) {
              yield event;
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

/**
 * Creates a FileWatcher backed by chokidar.
 * @internal
 *
 * Waits for chokidar's `ready` event before resolving, ensuring the
 * initial scan completes and no startup events are missed. Event
 * handlers are attached only after `ready`, so `ignoreInitial: true`
 * must be set to suppress pre-ready events. Rejects if chokidar
 * emits an error before `ready`.
 *
 * @param chokidar The chokidar module (default or namespace export)
 * @param dir The directory to watch
 * @returns A FileWatcher instance (resolves after initial scan)
 */
/** @internal */
export async function createChokidarWatcher(
  chokidar: ChokidarLike,
  dir: string,
): Promise<FileWatcher> {
  const { posix, win32 } = await import('node:path');
  // Normalize dir to strip trailing separators — path.relative on some Node
  // versions returns '..' instead of '' when one arg has a trailing sep.
  const dirPathApi = dir.includes('\\') ? win32 : posix;
  const normalizedDir = dirPathApi.resolve(dir);

  // Chokidar usually passes absolute paths into `ignored`. Filter relative
  // to the watch root so hidden/ignored ancestors outside the root do not
  // suppress the entire project tree.
  const ignored = (watchedPath: string) =>
    pathHasIgnoredComponent(
      relativeWatchedPath(watchedPath, normalizedDir, posix, win32),
    );

  const underlying = chokidar.watch(normalizedDir, {
    ignored,
    persistent: true,
    ignoreInitial: true,
  });

  const { pushEvent, fail, watcher } = createQueuedWatcher(() =>
    underlying.close()
  );

  const onAdd = (path: string) => pushEvent({ paths: [path], kind: 'create' });
  const onChange = (path: string) =>
    pushEvent({ paths: [path], kind: 'modify' });
  const onUnlink = (path: string) =>
    pushEvent({ paths: [path], kind: 'remove' });
  const attachEventHandlers = () => {
    underlying.on('add', onAdd);
    underlying.on('change', onChange);
    underlying.on('unlink', onUnlink);
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      underlying.off('ready', onReady);
      underlying.off('error', onSetupError);
    };
    const onReady = () => {
      if (settled) return;
      settled = true;
      cleanup();
      attachEventHandlers();
      underlying.on('error', fail);
      resolve();
    };
    const onSetupError = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      fail(err);
      reject(err);
    };
    underlying.on('ready', onReady);
    underlying.on('error', onSetupError);
  });

  return watcher;
}

/** @internal */
export async function createNativeFsWatcher(
  fs: typeof import('node:fs'),
  dir: string,
  platform?: string,
): Promise<FileWatcher> {
  const processPlatform = platform ?? globalThis.process.platform;
  // On Windows, recursive fs.watch via libuv has a known assertion crash
  // (src/win/fs-event.c:72, _wcsnicmp mismatch) due to short-path name
  // normalization. This is a regression in Node.js 24.16.0, tracked at
  // https://github.com/libuv/libuv/issues/5010. Use polling instead.
  if (processPlatform === 'win32') {
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
    const path = String(filename);
    // On Linux, fs.watch provides only the basename, not the full relative
    // path. This means only dotfile detection works; directory-based
    // filtering (e.g., 'node_modules') requires the full path. This is
    // acceptable because createNativeFsWatcher is a fallback used only
    // when chokidar is unavailable.
    if (pathHasIgnoredComponent(path)) return;
    const kind: FileWatchEvent['kind'] = eventType === 'rename'
      ? 'any'
      : 'modify';
    pushEvent({ paths: [path], kind });
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
  const { join, win32 } = await import('node:path');

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
      fs.accessSync(dir, fs.constants.F_OK);
      // Verify read permission (stat doesn't distinguish chmod 000 for owner)
      try {
        fs.accessSync(dir, fs.constants.R_OK);
        return 'present';
      } catch {
        return 'unreadable';
      }
    } catch (err) {
      return isMissingFileSystemError(err) ? 'missing' : 'unreadable';
    }
  }
  // Throttle per-path to at most one DEBUG log per 60s to avoid log floods
  // from persistently broken paths (e.g., permission denied, raced deletion).
  const lastFailureLog = new Map<string, number>();
  const kFailureLogMaxSize = 1000;
  function logFailureThrottled(path: string, msg: string): void {
    const now = Date.now();
    const last = lastFailureLog.get(path) ?? 0;
    if (now - last < 60_000) return;

    // Evict stale entries first, then oldest survivors, but never the current
    // path before its throttle window is checked.
    if (
      !lastFailureLog.has(path) && lastFailureLog.size >= kFailureLogMaxSize
    ) {
      const cutoff = now - 60_000;
      for (const [p, t] of lastFailureLog) {
        if (t < cutoff) lastFailureLog.delete(p);
      }
      while (lastFailureLog.size >= kFailureLogMaxSize) {
        const oldestPath = lastFailureLog.keys().next().value;
        if (oldestPath === undefined || oldestPath === path) break;
        lastFailureLog.delete(oldestPath);
      }
      if (lastFailureLog.size >= kFailureLogMaxSize) return;
    }

    lastFailureLog.set(path, now);
    log({ severity: 'DEBUG', message: msg });
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
        if (pathHasIgnoredComponent(entry)) continue;
        const fullPath = currentDir.includes('\\')
          ? win32.join(currentDir, entry)
          : join(currentDir, entry);
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
