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
  // Ignore Deno's temporary files
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
    // chokidar not available, fall back to native fs.watch
    console.warn(
      'chokidar not available, using native fs.watch (may be unreliable on some platforms)',
    );
    const fs = await import('node:fs');
    return createNativeFsWatcher(fs, dir);
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
      },
      close() {
        closed = true;
        if (resolveNext) {
          resolveNext({ paths: [], kind: 'any' });
        }
        onClose();
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

  underlying.on('add', (path: string) => pushEvent({ paths: [path], kind: 'create' }));
  underlying.on('change', (path: string) => pushEvent({ paths: [path], kind: 'modify' }));
  underlying.on('unlink', (path: string) => pushEvent({ paths: [path], kind: 'remove' }));

  return watcher;
}

function createNativeFsWatcher(
  fs: typeof import('node:fs'),
  dir: string,
): FileWatcher {
  const underlying = fs.watch(dir, { recursive: true });

  const { pushEvent, watcher } = createQueuedWatcher(() => underlying.close());

  underlying.on('change', (eventType, filename) => {
    if (!filename) return;
    const kind: FileWatchEvent['kind'] = eventType === 'rename' ? 'any' : 'modify';
    pushEvent({ paths: [String(filename)], kind });
  });

  return watcher;
}
