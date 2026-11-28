import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';

// Minimal schema for generating commits.
const kWriteFailSchema = {
  ns: 'write-fail',
  version: 1,
  fields: {
    value: { type: 'string', default: () => '' },
  },
} as const;

const kRegistry = new DataRegistry();
kRegistry.registerSchema(kWriteFailSchema);

export default function setup(): void {
  TEST(
    'WriteFailure',
    'emits WriteFailure with correct payload after 3 consecutive I/O failures',
    async (ctx) => {
      const db = await ctx.createDB('write-fail-3x', { registry: kRegistry });
      const repoPath = '/data/items';
      const failureEvents: unknown[] = [];
      db.attach('WriteFailure', (detail) => {
        failureEvents.push(detail);
      });

      try {
        await db.readyPromise();
        // Create and commit an item to open the repo file.
        const item = db.create('/data/items/item-1', kWriteFailSchema, {
          value: 'hello',
        });
        await item.commit();
        await db.flush(repoPath);
        assertEquals(failureEvents.length, 0, 'no failure after first flush');

        // Force the next MAX_WRITE_FAILURES (3) append calls to throw, which
        // is the threshold that triggers the WriteFailure event.
        db.setTestFaults({ appendFailures: 3 });

        // Generate a pending commit and flush — _flushFileWithRetry loops 3
        // times, consuming all 3 forced failures, then emits WriteFailure.
        item.set('value', 'world');
        await db.flush(repoPath);

        assertEquals(
          failureEvents.length,
          1,
          'WriteFailure fired exactly once',
        );
        const detail = failureEvents[0] as {
          droppedCommits: number;
          repoPath: string;
          commitIds: string[];
          error: unknown;
        };
        assertTrue(
          detail.droppedCommits >= 1,
          'at least one commit was dropped',
        );
        assertExists(detail.commitIds);
        assertTrue(detail.commitIds.length >= 1, 'commitIds is non-empty');
        assertEquals(detail.repoPath, repoPath);
        assertExists(detail.error);
        assertEquals(
          (detail.error as Error).message,
          'test-forced append failure',
          'WriteFailure must carry the real I/O cause, not the context string',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'WriteFailure',
    'auto-flush is single-attempt: a transient fault retains the batch',
    async (ctx) => {
      const db = await ctx.createDB('write-fail-autoflush', {
        registry: kRegistry,
      });
      const repoPath = '/data/items';
      const failureEvents: unknown[] = [];
      db.attach('WriteFailure', (detail) => {
        failureEvents.push(detail);
      });

      try {
        await db.readyPromise();
        const item = db.create('/data/items/item-a', kWriteFailSchema, {
          value: 'x',
        });
        await item.commit();
        await db.flush(repoPath);
        assertEquals(failureEvents.length, 0);

        db.setTestFaults({ appendFailures: 1 });
        // One commit sized past the auto-flush byte threshold.
        const big = 'y'.repeat(4 * 1024 * 1024);
        item.set('value', big);
        await item.commit();
        // Allow the fire-and-forget auto-flush to run and hit the fault.
        await new Promise((r) => setTimeout(r, 50));
        assertEquals(
          failureEvents.length,
          0,
          'auto-flush must retain the batch, never emit WriteFailure',
        );
        // A later flush retries and persists the retained batch.
        await db.flush(repoPath);
        assertEquals(item.get('value'), big);
        // Reopen from disk: the batch survived the transient fault.
        await db.closeRepo(repoPath);
        await db.open(repoPath);
        assertEquals(
          db.item('/data/items/item-a')?.get('value'),
          big,
          'batch must survive the transient auto-flush fault',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'WriteFailure',
    'partial failures below threshold do not fire WriteFailure',
    async (ctx) => {
      const db = await ctx.createDB('write-fail-partial', {
        registry: kRegistry,
      });
      const repoPath = '/data/items';
      const failureEvents: unknown[] = [];
      db.attach('WriteFailure', (detail) => {
        failureEvents.push(detail);
      });

      try {
        await db.readyPromise();
        const item = db.create('/data/items/item-p', kWriteFailSchema, {
          value: 'initial',
        });
        await item.commit();
        await db.flush(repoPath);

        // Force only 2 failures (below the 3-strike threshold).
        db.setTestFaults({ appendFailures: 2 });
        item.set('value', 'updated');
        await db.flush(repoPath);

        assertEquals(
          failureEvents.length,
          0,
          'WriteFailure must not fire for partial failures',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'WriteFailure',
    'database remains usable after WriteFailure event',
    async (ctx) => {
      const db = await ctx.createDB('write-fail-recovery', {
        registry: kRegistry,
      });
      const repoPath = '/data/items';
      const failureEvents: unknown[] = [];
      db.attach('WriteFailure', (detail) => {
        failureEvents.push(detail);
      });

      try {
        await db.readyPromise();
        // Create initial item and flush successfully.
        const item1 = db.create('/data/items/item-r1', kWriteFailSchema, {
          value: 'first',
        });
        await item1.commit();
        await db.flush(repoPath);

        // Trigger WriteFailure with 3 consecutive failures.
        db.setTestFaults({ appendFailures: 3 });
        item1.set('value', 'doomed');
        await db.flush(repoPath);
        assertEquals(failureEvents.length, 1, 'WriteFailure should have fired');

        // After the failure, create a new item and verify it persists.
        const item2 = db.create('/data/items/item-r2', kWriteFailSchema, {
          value: 'survivor',
        });
        await item2.commit();
        await db.flush(repoPath);

        assertEquals(
          item2.get('value'),
          'survivor',
          'new item should be readable',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
