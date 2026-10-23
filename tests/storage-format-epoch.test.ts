/**
 * Storage-format epoch fail-fast (issue #58, Phase 5B).
 *
 * A single epoch constant is recorded in a marker file at the store root. Any
 * store that predates the marker, or carries a different epoch, is rejected
 * with a clear "older GoatDB - delete and re-sync" error. These tests drive
 * real GoatDB instances against real temp directories (file system or OPFS
 * depending on runtime) through worker-backed file operations, so browser
 * tests exercise the same main-thread boundary as applications.
 */
import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import type { GoatDB } from '../db/db.ts';
import {
  ensureStorageFormatEpoch,
  kStorageFormatEpoch,
  kStorageFormatMarkerFile,
} from '../db/storage-epoch.ts';
import {
  readDir,
  readFile,
  readTextFile,
  writeFile,
} from '../base/json-log/json-log.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';

const gTextEncoder = new TextEncoder();
const kSchema = {
  ns: 'epoch-test',
  version: 1,
  fields: { value: { type: 'string', required: true } },
} as const;
const kRegistry = new DataRegistry();
kRegistry.registerSchema(kSchema);
/** Marker message fragment shared by every rejection path. */
const kOlderStoreMessage = 'created by an older GoatDB';

/** Asserts that opening the store rejects with the older-GoatDB error. */
async function assertStoreRejected(db: GoatDB): Promise<void> {
  let error: unknown;
  try {
    await db.readyPromise();
  } catch (e) {
    error = e;
  }
  assertExists(error, 'expected store open to reject');
  const message = error instanceof Error ? error.message : String(error);
  assertTrue(
    message.includes(kOlderStoreMessage),
    `expected rejection to mention "${kOlderStoreMessage}", got: ${message}`,
  );
}

function markerPath(storePath: string): string {
  return path.join(storePath, kStorageFormatMarkerFile);
}

async function writeMarker(storePath: string, epoch: string): Promise<void> {
  await writeFile(markerPath(storePath), gTextEncoder.encode(epoch + '\n'));
}

async function readMarkerText(storePath: string): Promise<string> {
  return new TextDecoder().decode(await readFile(markerPath(storePath)));
}

export default function setup() {
  TEST(
    'StorageFormatEpoch',
    'fresh store records the current epoch in a marker file',
    async (ctx) => {
      const db = await ctx.createDB('fresh');
      await db.readyPromise();
      try {
        const storePath = await ctx.tempDir('fresh');
        const recorded = await readTextFile(markerPath(storePath));
        assertEquals(recorded?.trim(), String(kStorageFormatEpoch));
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'StorageFormatEpoch',
    'concurrent epoch checks do not spuriously reject',
    async (ctx) => {
      const storePath = await ctx.tempDir('concurrent');
      // WHY: call the gate directly. Two GoatDB instances on one store path are
      // an unsupported configuration, so opening two DBs here would test an
      // invalid setup instead of the concurrent-initialization contract. The
      // worker serializes these file operations.
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => ensureStorageFormatEpoch(storePath)),
      );
      for (const r of results) {
        assertTrue(
          r.status === 'fulfilled',
          r.status === 'rejected' ? String(r.reason) : 'unreachable',
        );
      }
      assertEquals(
        (await readMarkerText(storePath)).trim(),
        String(kStorageFormatEpoch),
      );
      const db = await ctx.createDB('concurrent');
      try {
        await db.readyPromise();
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'StorageFormatEpoch',
    'reopening a store with the current epoch preserves committed data',
    async (ctx) => {
      const first = await ctx.createDB('reopen', { registry: kRegistry });
      try {
        await first.readyPromise();
        await first.create('/data/items/saved', kSchema, { value: 'persisted' })
          .commit();
        await first.flushAll();
      } finally {
        await first.close();
      }

      const second = await ctx.createDB('reopen', { registry: kRegistry });
      try {
        await second.readyPromise();
        await second.open('/data/items');
        assertEquals(
          second.item('/data/items/saved').get('value'),
          'persisted',
        );
      } finally {
        await second.flushAll();
        await second.close();
      }
    },
  );

  TEST(
    'StorageFormatEpoch',
    'a non-empty store without a marker is rejected',
    async (ctx) => {
      const storePath = await ctx.tempDir('legacy');
      await writeFile(
        path.join(storePath, 'leftover.goat'),
        gTextEncoder.encode('old-store-contents'),
      );

      const db = await ctx.createDB('legacy');
      await assertStoreRejected(db);
      await db.close();
    },
  );

  TEST(
    'StorageFormatEpoch',
    'a store with a mismatched epoch is rejected',
    async (ctx) => {
      const storePath = await ctx.tempDir('mismatch');
      await writeMarker(storePath, String(kStorageFormatEpoch + 1));

      const db = await ctx.createDB('mismatch');
      await assertStoreRejected(db);
      await db.close();
    },
  );

  TEST(
    'StorageFormatEpoch',
    'a directory containing only a mismatched marker is rejected',
    async (ctx) => {
      const storePath = await ctx.tempDir('only-marker');
      await writeMarker(storePath, String(kStorageFormatEpoch + 1));
      // WHY: the non-empty check must ignore the marker file itself. This pins
      // the directory shape so the rejection can only come from the epoch
      // mismatch, never from counting the marker as legacy data.
      const entries = await readDir(storePath);
      assertEquals(entries.length, 1);
      assertEquals(entries[0].name, kStorageFormatMarkerFile);

      const db = await ctx.createDB('only-marker');
      await assertStoreRejected(db);
      await db.close();
    },
  );

  TEST(
    'StorageFormatEpoch',
    'an empty marker is treated as an in-flight write, not a mismatch',
    async (ctx) => {
      // WHY: writeFile creates the marker before its content lands, so a
      // concurrent opener can observe a zero-length marker on a fresh store.
      // The empty read must fall through to the directory check, not reject.
      const storePath = await ctx.tempDir('empty-marker');
      // A true zero-length file: exactly what the create-then-write window
      // of writeFile produces for a concurrent opener.
      await writeFile(markerPath(storePath), new Uint8Array(0));
      assertEquals(await readTextFile(markerPath(storePath)), '');

      const db = await ctx.createDB('empty-marker');
      try {
        await db.readyPromise();
        assertTrue(db.ready);
        // The open must repair the marker with the current epoch.
        const recorded = await readTextFile(markerPath(storePath));
        assertEquals(recorded?.trim(), String(kStorageFormatEpoch));
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'StorageFormatEpoch',
    'a store with the current epoch marker opens',
    async (ctx) => {
      const storePath = await ctx.tempDir('matching');
      await writeMarker(storePath, String(kStorageFormatEpoch));

      const db = await ctx.createDB('matching');
      try {
        await db.readyPromise();
        assertTrue(db.ready);
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
