import { TEST, type TestSuite } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { withLogCapture } from './test-utils.ts';
import type { FileWatchEvent } from '../base/file-watcher.ts';
import {
  shouldRebuildAfterPathChange,
  watchDirectory,
} from '../base/file-watcher.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a file to be removed from the filesystem.
 * On Windows, unlinkSync may return before the file is removed from
 * directory listings due to NTFS oplocks or anti-virus scans. Polls
 * until the file is gone or the timeout expires, avoiding flaky CI.
 */
async function waitForDeleted(
  fs: typeof import('node:fs'),
  filePath: string,
  timeoutMs: number = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      fs.accessSync(filePath);
    } catch (err) {
      // Re-throw unexpected errors (EACCES, EBUSY, etc.), not just ENOENT
      const nodeErr = err as { code?: string };
      if (nodeErr.code !== 'ENOENT') throw nodeErr;
      return; // file is gone
    }
    await sleep(50);
  }
  // Timeout — proceed anyway; let the test assertion decide.
}

/**
 * Begin collecting events from a FileWatcher's async iterator.
 * Returns the shared events array and a done promise that resolves
 * when the iterator ends (after watcher.close() or break).
 */
function startCollecting(
  watcher: import('../base/file-watcher.ts').FileWatcher,
): { events: FileWatchEvent[]; done: Promise<void> } {
  const events: FileWatchEvent[] = [];
  const done = (async () => {
    for await (const event of watcher) {
      events.push(event);
    }
  })();
  return { events, done };
}

async function waitForEvent(
  events: FileWatchEvent[],
  predicate: (event: FileWatchEvent) => boolean,
  message: string,
  timeoutMs: number = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.some(predicate)) return;
    await sleep(50);
  }
  throw new Error(`${message}. Events: ${JSON.stringify(events)}`);
}

/**
 * Wrap createPollingWatcher with a cycle-counting callback so tests can
 * synchronize on poll completion without coupling to production internals.
 */
async function createWatcher(
  fs: typeof import('node:fs'),
  dir: string,
  pollMs: number,
): Promise<{
  watcher: import('../base/file-watcher.ts').FileWatcher;
  waitForCycles: (cycles: number, timeoutMs?: number) => Promise<void>;
}> {
  let cycleCount = 0;
  const mod = await import('../base/file-watcher.ts');
  const watcher = await mod.createPollingWatcher(fs, dir, pollMs, () => {
    cycleCount++;
  });
  return {
    watcher,
    waitForCycles: (cycles: number, timeoutMs: number = 5000) => {
      if (cycleCount >= cycles) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const check = setInterval(() => {
          if (cycleCount >= cycles) {
            clearInterval(check);
            clearTimeout(failTimer);
            resolve();
          }
        }, 10);
        const failTimer = setTimeout(() => {
          clearInterval(check);
          reject(
            new Error(
              `waitForCycles: timed out after ${timeoutMs}ms waiting for ${cycles} cycles`,
            ),
          );
        }, timeoutMs);
      });
    },
  };
}

export default function setupFileWatcherUnitTests(): void {
  TEST('FileWatcher', 'shouldRebuildAfterPathChange ignores dotfiles', () => {
    assertEquals(shouldRebuildAfterPathChange('.hidden/file.ts'), false);
    assertEquals(shouldRebuildAfterPathChange('src/.env'), false);
  });

  TEST('FileWatcher', 'shouldRebuildAfterPathChange ignores .tmp', () => {
    assertEquals(shouldRebuildAfterPathChange('file.ts.tmp'), false);
  });

  TEST(
    'FileWatcher',
    'shouldRebuildAfterPathChange ignores default dirs',
    () => {
      assertEquals(shouldRebuildAfterPathChange('node_modules/foo.js'), false);
      assertEquals(shouldRebuildAfterPathChange('.git/config'), false);
    },
  );

  TEST(
    'FileWatcher',
    'shouldRebuildAfterPathChange allows normal paths',
    () => {
      assertEquals(shouldRebuildAfterPathChange('src/main.ts'), true);
      assertEquals(shouldRebuildAfterPathChange('data/config.json'), true);
    },
  );

  TEST(
    'FileWatcher',
    'shouldRebuildAfterPathChange handles custom ignores',
    () => {
      assertEquals(
        shouldRebuildAfterPathChange('vendor/lib.js', ['vendor']),
        false,
      );
    },
  );

  TEST(
    'FileWatcher',
    'polling failure throttle stays bounded without re-logging the active path',
    async () => {
      const dir = '/watch-root';
      const entries = [
        ...Array.from({ length: 1000 }, (_, i) => `broken-${i}`),
        'broken-0',
      ];
      const fakeFs = {
        readdirSync(currentDir: string): string[] {
          if (currentDir !== dir) {
            throw new Error(`unexpected dir: ${currentDir}`);
          }
          return entries;
        },
        lstatSync(_fullPath: string): never {
          const err = new Error('permission denied') as Error & {
            code?: string;
          };
          err.code = 'EACCES';
          throw err;
        },
      } as typeof import('node:fs');

      const originalNow = Date.now;
      try {
        Date.now = () => 61_000;
        await withLogCapture(async (captured) => {
          const { watcher, waitForCycles } = await createWatcher(
            fakeFs,
            dir,
            5,
          );
          try {
            await waitForCycles(1);
          } finally {
            watcher.close();
          }

          const debugMessages = captured.filter((entry) =>
            entry.severity === 'DEBUG'
          ).map((entry) => entry.message);
          assertEquals(
            debugMessages.length,
            new Set(entries).size,
            'second poll inside the throttle window must not emit extra DEBUG logs',
          );
          assertEquals(
            debugMessages.filter((message) =>
              message === `Failed to stat file: ${dir}/broken-0`
            ).length,
            1,
            'the oldest tracked path must stay throttled even when the map is full',
          );
        });
      } finally {
        Date.now = originalNow;
      }
    },
  );
}

export function setupFileWatcherTests(): void {
  TEST(
    'FileWatcher',
    'detects new file via polling',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-new');
      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      try {
        // Wait for initial scan (1st poll cycle), then create a file
        const { events, done } = startCollecting(watcher);
        await waitForCycles(1);
        const filePath = path.join(dir, 'new-file.txt');
        fs.writeFileSync(filePath, 'hello');

        // Wait for the next poll cycle to detect the new file
        await waitForCycles(2);
        watcher.close();
        await done;

        assertEquals(events.length, 1, 'expected exactly one event');
        assertEquals(events[0].paths.length, 1, 'expected one path in event');
        assertEquals(
          events[0].paths[0],
          filePath,
          'expected correct file path',
        );
        assertEquals(
          events[0].kind,
          'create',
          'expected create kind for new file',
        );
      } finally {
        watcher.close();
      }
    },
  );

  TEST('FileWatcher', 'detects modified file', async (ctx: TestSuite) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = await ctx.tempDir('poll-modify');
    const filePath = path.join(dir, 'modify-me.txt');
    // Use explicit mtime values separated by >1s to avoid flaky CI on
    // Docker overlay filesystems with coarse mtimeMs granularity.
    const t0 = Math.floor(Date.now() / 1000);
    fs.writeFileSync(filePath, 'v1');
    fs.utimesSync(filePath, t0, t0);

    const { watcher, waitForCycles } = await createWatcher(
      fs as typeof import('node:fs'),
      dir,
      200,
    );
    try {
      // Wait for initial scan (1st poll), then modify the file
      const { events, done } = startCollecting(watcher);
      await waitForCycles(1);
      fs.writeFileSync(filePath, 'v2');
      // Use t0 + 10 (10s later) — large enough for coarse filesystems,
      // small enough to avoid OS-level max mtime clamping.
      fs.utimesSync(filePath, t0 + 10, t0 + 10);

      await waitForCycles(2);
      watcher.close();
      await done;

      assertEquals(events.length, 1, 'expected exactly one event');
      assertEquals(events[0].paths[0], filePath, 'expected correct file path');
      assertEquals(
        events[0].kind,
        'modify',
        'expected modify kind for changed file',
      );
    } finally {
      watcher.close();
    }
  });

  TEST(
    'FileWatcher',
    'detects modified file when only size changes across polls',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-modify-size');
      const filePath = path.join(dir, 'modify-size.txt');
      const t0 = Math.floor(Date.now() / 1000);
      fs.writeFileSync(filePath, 'v1');
      fs.utimesSync(filePath, t0, t0);

      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      try {
        const { events, done } = startCollecting(watcher);
        await waitForCycles(1);
        fs.writeFileSync(filePath, 'size changed significantly');
        fs.utimesSync(filePath, t0, t0);

        await waitForCycles(2);
        watcher.close();
        await done;

        assertEquals(events.length, 1, 'expected exactly one event');
        assertEquals(
          events[0].paths[0],
          filePath,
          'expected correct file path',
        );
        assertEquals(
          events[0].kind,
          'modify',
          'expected size-only change to emit modify',
        );
      } finally {
        watcher.close();
      }
    },
  );

  TEST('FileWatcher', 'detects deleted file', async (ctx: TestSuite) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = await ctx.tempDir('poll-delete');
    const filePath = path.join(dir, 'delete-me.txt');
    fs.writeFileSync(filePath, 'bye');

    const { watcher, waitForCycles } = await createWatcher(
      fs as typeof import('node:fs'),
      dir,
      200,
    );
    try {
      // Wait for initial scan, then delete the file
      const { events, done } = startCollecting(watcher);
      await waitForCycles(1);
      fs.unlinkSync(filePath);
      await waitForDeleted(fs, filePath);

      await waitForCycles(2);
      watcher.close();
      await done;

      assertEquals(events.length, 1, 'expected exactly one event');
      assertEquals(events[0].paths[0], filePath, 'expected correct file path');
      assertEquals(
        events[0].kind,
        'remove',
        'expected remove kind for deleted file',
      );
    } finally {
      watcher.close();
    }
  });

  TEST(
    'FileWatcher',
    'emits no events when files unchanged',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const dir = await ctx.tempDir('poll-noop');
      const path = await import('node:path');
      fs.writeFileSync(path.join(dir, 'static.txt'), 'stable');

      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      try {
        const { events, done } = startCollecting(watcher);
        // Wait for initial scan + multiple poll cycles with no changes
        await waitForCycles(5);
        watcher.close();
        await done;

        assertEquals(
          events.length,
          0,
          'expected no events when files unchanged',
        );
      } finally {
        watcher.close();
      }
    },
  );

  TEST('FileWatcher', 'close stops polling', async (ctx: TestSuite) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = await ctx.tempDir('poll-close');
    const { watcher, waitForCycles } = await createWatcher(
      fs as typeof import('node:fs'),
      dir,
      200,
    );

    // Wait for initial scan, close immediately, then create a file
    const { done } = startCollecting(watcher);
    await waitForCycles(1);
    watcher.close();
    await done;

    // Create a file after close — should not be detected
    fs.writeFileSync(path.join(dir, 'after-close.txt'), 'should not fire');

    // After close, the async iterator should have terminated.
    const afterEvents: FileWatchEvent[] = [];
    for await (const event of watcher) {
      afterEvents.push(event);
    }
    assertEquals(afterEvents.length, 0, 'expected no events after close');
  });

  TEST('FileWatcher', 'scans nested directories', async (ctx: TestSuite) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = await ctx.tempDir('poll-nested');
    const subDir = path.join(dir, 'sub', 'deep');
    fs.mkdirSync(subDir, { recursive: true });

    const { watcher, waitForCycles } = await createWatcher(
      fs as typeof import('node:fs'),
      dir,
      200,
    );
    try {
      // Wait for initial scan, then create a file in nested dir
      const { events, done } = startCollecting(watcher);
      await waitForCycles(1);
      const nestedFile = path.join(subDir, 'nested.txt');
      fs.writeFileSync(nestedFile, 'deep');

      await waitForCycles(2);
      watcher.close();
      await done;

      assertEquals(events.length, 1, 'expected one event for nested file');
      assertEquals(events[0].paths[0], nestedFile, 'expected nested file path');
      assertEquals(events[0].kind, 'create', 'expected create kind');
    } finally {
      watcher.close();
    }
  });

  TEST(
    'FileWatcher',
    'ignores excluded directories',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-ignored');
      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      try {
        // Create files inside directories listed in kDefaultIgnored
        const { events, done } = startCollecting(watcher);
        await waitForCycles(1);
        fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
        fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'server-data'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'node_modules', 'pkg.js'), 'ignored');
        fs.writeFileSync(path.join(dir, '.git', 'config'), 'ignored');
        fs.writeFileSync(path.join(dir, 'server-data', 'db.goat'), 'ignored');
        fs.writeFileSync(path.join(dir, 'build', 'output.js'), 'ignored');

        await waitForCycles(2);
        watcher.close();
        await done;
        assertEquals(
          events.length,
          0,
          'expected no events from kDefaultIgnored directories',
        );
      } finally {
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'polling watcher emits hidden files so callers can filter them',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-hidden-file');
      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      try {
        const { events, done } = startCollecting(watcher);
        await waitForCycles(1);
        const hiddenFile = path.join(dir, '.hidden.txt');
        fs.writeFileSync(hiddenFile, 'observed');

        await waitForCycles(2);
        watcher.close();
        await done;

        assertEquals(events.length, 1, 'expected one event from hidden file');
        assertEquals(
          events[0].paths[0],
          hiddenFile,
          'expected hidden file path',
        );
        assertEquals(events[0].kind, 'create', 'expected create kind');
      } finally {
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'polling watcher emits files inside hidden directories so callers can filter them',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-hidden-dir');
      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      try {
        const { events, done } = startCollecting(watcher);
        await waitForCycles(1);
        const hiddenDir = path.join(dir, '.hidden');
        const hiddenFile = path.join(hiddenDir, 'file.txt');
        fs.mkdirSync(hiddenDir, { recursive: true });
        fs.writeFileSync(hiddenFile, 'observed');

        await waitForCycles(2);
        watcher.close();
        await done;

        assertEquals(
          events.length,
          1,
          'expected one event from hidden directory',
        );
        assertEquals(
          events[0].paths[0],
          hiddenFile,
          'expected hidden file path',
        );
        assertEquals(events[0].kind, 'create', 'expected create kind');
      } finally {
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'emits any on root directory deletion',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-root-del');
      const filePath = path.join(dir, 'file.txt');
      fs.writeFileSync(filePath, 'data');

      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      try {
        // Wait for initial scan, then delete the entire root directory.
        // fs.rmSync on Windows may return before the OS finishes deleting
        // every file (NTFS oplocks, antivirus). Accept >= 1 events and
        // verify the root path appears rather than asserting exactly 1.
        const { events, done } = startCollecting(watcher);
        await waitForCycles(1);
        fs.rmSync(dir, { recursive: true, force: true });

        // Wait for the next poll cycle to detect the deletion.
        await waitForCycles(2);
        watcher.close();
        await done;

        assertEquals(
          events.length >= 1,
          true,
          'expected at least one event for root deletion',
        );
        assertEquals(
          events[0].paths[0],
          dir,
          'expected root directory path',
        );
        assertEquals(
          events[0].kind,
          'any',
          'expected any kind for root deletion',
        );
      } finally {
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'emits any when an initially empty root directory is deleted',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const dir = await ctx.tempDir('poll-empty-root-del');

      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      try {
        const { events, done } = startCollecting(watcher);
        await waitForCycles(1);
        fs.rmSync(dir, { recursive: true, force: true });

        await waitForCycles(2);
        watcher.close();
        await done;

        assertTrue(
          events.length >= 1,
          'expected at least one event for empty-root deletion',
        );
        assertEquals(events[0].paths[0], dir, 'expected root directory path');
        assertEquals(
          events[0].kind,
          'any',
          'expected any kind for root deletion',
        );
      } finally {
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'suppresses expected root-deletion read errors',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-root-del-log');
      fs.writeFileSync(path.join(dir, 'file.txt'), 'data');

      await withLogCapture(async (captured) => {
        const { watcher, waitForCycles } = await createWatcher(
          fs as typeof import('node:fs'),
          dir,
          200,
        );
        try {
          const { done } = startCollecting(watcher);
          await waitForCycles(1);
          fs.rmSync(dir, { recursive: true, force: true });
          await waitForCycles(2);
          watcher.close();
          await done;
        } finally {
          watcher.close();
        }

        assertTrue(
          captured.every((entry) =>
            !entry.message?.includes(`Failed to read directory: ${dir}`)
          ),
          'root deletion should not emit throttled read-failure noise',
        );
      });
    },
  );

  TEST(
    'FileWatcher',
    'continues polling after root directory deletion',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-root-del-continue');
      fs.writeFileSync(path.join(dir, 'file.txt'), 'data');

      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      try {
        const { events, done } = startCollecting(watcher);
        await waitForCycles(1);
        fs.rmSync(dir, { recursive: true, force: true });
        await waitForCycles(2);

        fs.mkdirSync(dir, { recursive: true });
        const recreatedFile = path.join(dir, 'recreated.txt');
        fs.writeFileSync(recreatedFile, 'again');
        await waitForCycles(3);

        watcher.close();
        await done;

        assertEquals(
          events.length >= 2,
          true,
          'expected deletion and recreate events',
        );
        assertEquals(
          events[0].paths[0],
          dir,
          'expected root deletion event first',
        );
        assertEquals(
          events[0].kind,
          'any',
          'expected any kind for root deletion',
        );
        const recreatedEvent = events.find((event) =>
          event.paths[0] === recreatedFile && event.kind === 'create'
        );
        assertEquals(
          recreatedEvent !== undefined,
          true,
          'expected create event after root directory recreation',
        );
      } finally {
        watcher.close();
      }
    },
  );

  // Unreadable-root branch (EACCES) is distinct from missing-root. We
  // attempt chmod 000 and assert the watcher produces no false-positive
  // deletion events while the root is unreadable, then resumes emitting
  // events after we restore the permissions. The chmod is best-effort —
  // on filesystems or processes that ignore it (Windows, or root-owned
  // directories in some CI environments) the test still validates the
  // happy path of the surrounding code.
  TEST(
    'FileWatcher',
    'unreadable root emits no events and recovers on chmod restore',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-root-unreadable');
      fs.writeFileSync(path.join(dir, 'seed.txt'), 'data');

      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );

      let chmodSucceeded = false;
      try {
        const { events, done } = startCollecting(watcher);
        await waitForCycles(1);

        // Try to make the root unreadable. Ignore failures on
        // filesystems/processes that don't honor chmod.
        try {
          fs.chmodSync(dir, 0o000);
          chmodSucceeded = true;
        } catch {
          // chmod unsupported in this environment — skip strict assertions.
        }

        if (chmodSucceeded) {
          // While the root is unreadable, scan() returns []; the poller
          // must NOT emit a "root missing" event. Wait several cycles and
          // assert no root-deletion event was emitted.
          await waitForCycles(3);
          const rootDeletionWhileUnreadable = events.find((e) =>
            e.paths[0] === dir && e.kind === 'any'
          );
          assertEquals(
            rootDeletionWhileUnreadable,
            undefined,
            'unreadable root must not be reported as deleted',
          );

          // Restore permissions and create a new file. The watcher should
          // pick up the new file on the next poll cycle.
          fs.chmodSync(dir, 0o755);
          const newFile = path.join(dir, 'recovered.txt');
          fs.writeFileSync(newFile, 'recovered');
          await waitForEvent(
            events,
            (e) => e.paths[0] === newFile && e.kind === 'create',
            'watcher must resume event emission after root is readable again',
          );
        }

        watcher.close();
        await done;
      } finally {
        try {
          if (chmodSucceeded) fs.chmodSync(dir, 0o755);
        } catch {
          // Best-effort cleanup; ignore failures.
        }
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'close is idempotent (watcher close idempotency)',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const dir = await ctx.tempDir('poll-idem-close');
      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );
      // Let one poll complete so the watcher is fully initialized
      await waitForCycles(1);
      watcher.close();
      // Second close must not throw
      watcher.close();
      // Third close for good measure
      watcher.close();
    },
  );

  TEST(
    'FileWatcher',
    'break from iterator triggers cleanup',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-iter-break');
      const filePath = path.join(dir, 'trigger.txt');
      fs.writeFileSync(filePath, 'v1');

      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );

      // Wait for initial scan, then modify the file so the next poll
      // pushes a 'modify' event into the queue. Once queued, the iterator
      // will yield it and break will execute, triggering cleanup.
      await waitForCycles(1);
      // Use a controlled mtime 10s ahead to ensure the change is detected
      // across all filesystems without hitting OS-level max mtime clamping.
      const modifiedTime = Math.floor(Date.now() / 1000) + 10;
      fs.writeFileSync(filePath, 'v2');
      fs.utimesSync(filePath, modifiedTime, modifiedTime);
      await waitForCycles(2);

      // The modify event is queued — iterate, yield it, then break
      for await (const _event of watcher) {
        break;
      }

      // After break, the finally block should have called cleanup.
      // A subsequent loop should see no events (watcher is closed).
      const afterEvents: FileWatchEvent[] = [];
      for await (const event of watcher) {
        afterEvents.push(event);
      }
      assertEquals(afterEvents.length, 0, 'expected no events after break');
    },
  );

  TEST(
    'FileWatcher',
    'close during pending await terminates iterator',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = await ctx.tempDir('poll-close-await');
      const { watcher, waitForCycles } = await createWatcher(
        fs as typeof import('node:fs'),
        dir,
        200,
      );

      // Start consuming events, then close while the iterator is
      // awaiting the next event. The sentinel event (from cleanup)
      // must resolve the pending await and terminate the loop.
      const events: FileWatchEvent[] = [];
      const consume = (async () => {
        for await (const event of watcher) {
          events.push(event);
        }
      })();

      // Let the iterator reach its 'await' state (first poll completes
      // with no changes, iterator blocks waiting for the next event)
      await waitForCycles(1);
      // Create a file so the next poll generates a real event
      const filePath = path.join(dir, 'trigger.txt');
      fs.writeFileSync(filePath, 'go');
      await waitForCycles(2);
      // Close while iterator is blocked waiting for the next event
      watcher.close();
      await consume;

      assertEquals(
        events.length >= 1,
        true,
        'expected at least one real event before close',
      );
    },
  );
}

/**
 * Deno-only smoke tests for the native Deno watcher (Deno.watchFs).
 * Gated by `if (isDeno())` in test-registry.ts.
 */
export function setupFileWatcherDenoTests(): void {
  TEST(
    'FileWatcher',
    'Deno native watcher emits create event',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('deno-watch-create');
      const watcher = await watchDirectory(dir);
      try {
        const { events, done } = startCollecting(watcher);

        await Deno.writeTextFile(`${dir}/test.txt`, 'hello');
        await waitForEvent(
          events,
          (e) => e.paths.some((p) => p.endsWith('test.txt')),
          'Deno watcher must emit event for new file',
        );
        watcher.close();
        await done;
      } finally {
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'Deno native watcher emits modify event',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('deno-watch-modify');
      await Deno.writeTextFile(`${dir}/test.txt`, 'v1');
      await sleep(100);

      const watcher = await watchDirectory(dir);
      try {
        const { events, done } = startCollecting(watcher);

        await Deno.writeTextFile(`${dir}/test.txt`, 'v2');
        await waitForEvent(
          events,
          (e) => e.paths.some((p) => p.endsWith('test.txt')),
          'Deno watcher must emit event for modified file',
        );
        watcher.close();
        await done;
      } finally {
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'Deno native watcher emits remove event',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('deno-watch-remove');
      await Deno.writeTextFile(`${dir}/test.txt`, 'hello');
      await sleep(100);

      const watcher = await watchDirectory(dir);
      try {
        const { events, done } = startCollecting(watcher);

        await Deno.remove(`${dir}/test.txt`);
        await waitForEvent(
          events,
          (e) => e.paths.some((p) => p.endsWith('test.txt')),
          'Deno watcher must emit event for deleted file',
        );
        watcher.close();
        await done;
      } finally {
        watcher.close();
      }
    },
  );
}

/**
 * Node.js smoke tests for the native/chokidar watcher.
 * Uses `watchDirectory()` which auto-selects chokidar or native fs.watch.
 * Gated by `if (isNode())` in test-registry.ts.
 */
export function setupFileWatcherNativeNodeTests(): void {
  TEST(
    'FileWatcher',
    'native Node watcher emits create event',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const dir = await ctx.tempDir('node-native-create');
      const watcher = await watchDirectory(dir);
      try {
        const { events, done } = startCollecting(watcher);

        fs.writeFileSync(`${dir}/test.txt`, 'hello');
        await waitForEvent(
          events,
          (e) => e.paths.some((p) => p.endsWith('test.txt')),
          'native Node watcher must emit event for new file',
        );
        watcher.close();
        await done;
      } finally {
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'native Node watcher emits modify event',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const dir = await ctx.tempDir('node-native-modify');
      fs.writeFileSync(`${dir}/test.txt`, 'v1');
      await sleep(100);

      const watcher = await watchDirectory(dir);
      try {
        const { events, done } = startCollecting(watcher);

        fs.writeFileSync(`${dir}/test.txt`, 'v2');
        await waitForEvent(
          events,
          (e) => e.paths.some((p) => p.endsWith('test.txt')),
          'native Node watcher must emit event for modified file',
        );
        watcher.close();
        await done;
      } finally {
        watcher.close();
      }
    },
  );

  TEST(
    'FileWatcher',
    'native Node watcher emits remove event',
    async (ctx: TestSuite) => {
      const fs = await import('node:fs');
      const dir = await ctx.tempDir('node-native-remove');
      fs.writeFileSync(`${dir}/test.txt`, 'hello');
      await sleep(100);

      const watcher = await watchDirectory(dir);
      try {
        const { events, done } = startCollecting(watcher);

        fs.unlinkSync(`${dir}/test.txt`);
        await waitForEvent(
          events,
          (e) => e.paths.some((p) => p.endsWith('test.txt')),
          'native Node watcher must emit event for deleted file',
        );
        watcher.close();
        await done;
      } finally {
        watcher.close();
      }
    },
  );
}
