import { TEST, type TestSuite } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
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
        await sleep(200);
        watcher.close();
        await done;

        assertTrue(
          events.some((e) => e.paths.some((p) => p.endsWith('test.txt'))),
          'Deno watcher must emit event for new file',
        );
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
        await sleep(200);
        watcher.close();
        await done;

        assertTrue(
          events.some((e) => e.paths.some((p) => p.endsWith('test.txt'))),
          'Deno watcher must emit event for modified file',
        );
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
        await sleep(200);
        watcher.close();
        await done;

        assertTrue(
          events.some((e) => e.paths.some((p) => p.endsWith('test.txt'))),
          'Deno watcher must emit event for deleted file',
        );
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
        await sleep(300);
        watcher.close();
        await done;

        assertTrue(
          events.some((e) => e.paths.some((p) => p.endsWith('test.txt'))),
          'native Node watcher must emit event for new file',
        );
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
        await sleep(300);
        watcher.close();
        await done;

        assertTrue(
          events.some((e) => e.paths.some((p) => p.endsWith('test.txt'))),
          'native Node watcher must emit event for modified file',
        );
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
        await sleep(300);
        watcher.close();
        await done;

        assertTrue(
          events.some((e) => e.paths.some((p) => p.endsWith('test.txt'))),
          'native Node watcher must emit event for deleted file',
        );
      } finally {
        watcher.close();
      }
    },
  );
}
