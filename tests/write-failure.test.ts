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
        db._testForceAppendFailures = 3;

        // Generate a pending commit and flush — _flushFileWithRetry loops 3
        // times, consuming all 3 forced failures, then emits WriteFailure.
        item.set('value', 'world');
        await db.flush(repoPath);

        assertEquals(failureEvents.length, 1, 'WriteFailure fired exactly once');
        const detail = failureEvents[0] as {
          droppedCommits: number;
          repoPath: string;
          commitIds: string[];
          error: unknown;
        };
        assertTrue(detail.droppedCommits >= 1, 'at least one commit was dropped');
        assertExists(detail.commitIds);
        assertTrue(detail.commitIds.length >= 1, 'commitIds is non-empty');
        assertEquals(detail.repoPath, repoPath);
        assertExists(detail.error);
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
        db._testForceAppendFailures = 2;
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
        db._testForceAppendFailures = 3;
        item1.set('value', 'doomed');
        await db.flush(repoPath);
        assertEquals(failureEvents.length, 1, 'WriteFailure should have fired');

        // After the failure, create a new item and verify it persists.
        const item2 = db.create('/data/items/item-r2', kWriteFailSchema, {
          value: 'survivor',
        });
        await item2.commit();
        await db.flush(repoPath);

        assertEquals(item2.get('value'), 'survivor', 'new item should be readable');
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
