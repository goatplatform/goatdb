/**
 * Tests for the public `Repository.persistCommits` guard against the closed
 * lifecycle. The entry must reject with `serviceUnavailable()` after close
 * while still accepting work while open.
 */

import { assertEquals, assertThrowsInstanceOf, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import type { GoatDB } from '../db/db.ts';
import { Code, ServerError } from '../cfds/base/errors.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';

const kClosedStateSchema = {
  ns: 'closed-persist-commits-test',
  version: 1,
  fields: {
    value: { type: 'string', default: () => '' },
  },
} as const;

const kRegistry = new DataRegistry();
kRegistry.registerSchema(kClosedStateSchema);

export default function setup(): void {
  TEST(
    'ClosedState',
    'persistCommits is guarded against the closed lifecycle',
    async (ctx) => {
      const db: GoatDB = await ctx.createDB('closed-persist-commits', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        await db.open('/data/items');
        const repo = db.repository('/data/items');
        assertTrue(repo !== undefined, 'repository resolves while open');

        // Positive control: persistCommits succeeds while the repo is open.
        assertEquals(
          await repo!.persistCommits([]),
          [],
          'persistCommits resolves with empty result while open',
        );

        await db.close();

        // After close, the held repo instance must reject explicitly instead
        // of silently persisting into a torn-down repository.
        let serviceErr: unknown;
        await assertThrowsInstanceOf(
          async () => {
            try {
              await repo!.persistCommits([]);
            } catch (e) {
              serviceErr = e;
              throw e;
            }
          },
          ServerError,
          'persistCommits after close rejects with ServerError',
        );
        assertTrue(
          serviceErr instanceof ServerError &&
            serviceErr.code === Code.ServiceUnavailable,
          'persistCommits after close uses code ServiceUnavailable',
        );
      } finally {
        await db.close();
      }
    },
  );
}
