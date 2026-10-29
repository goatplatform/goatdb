/**
 * Storage-format epoch fail-fast (issue #58, Phase 5B).
 *
 * A single epoch constant is recorded in a marker file at the store root. Any
 * store carrying a different epoch, or a missing marker with known GoatDB
 * data, is rejected with a clear backup-first error. Unrelated files in the
 * store directory must never reject it. These tests drive real GoatDB
 * instances against real temp directories (file system or OPFS depending on
 * runtime) and manipulate the store root through the FileImpl abstraction, so
 * they hold across Deno, Node, and the browser.
 */
import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import type { GoatDB } from '../db/db.ts';
import { JSONDecoder } from '../base/core-types/encoding/json.ts';
import { JSONCyclicalEncoder } from '../base/core-types/encoding/json.ts';
import {
  MD5Checksum,
  Murmur3Checksum,
} from '../base/core-types/encoding/checksum.ts';
import type { CoreValue } from '../base/core-types/base.ts';
import { Item } from '../cfds/base/item.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { deserialize } from '../cfds/base/object.ts';
import type { Schema } from '../cfds/base/schema.ts';
import {
  kStorageFormatEpoch,
  kStorageFormatMarkerFile,
} from '../db/storage-epoch.ts';
import {
  mkdir,
  readDir,
  readTextFile,
  writeFile,
} from '../base/json-log/json-log.ts';

const gTextEncoder = new TextEncoder();
/** Marker message fragment shared by every rejection path. */
const kOlderStoreMessage = 'created by an older GoatDB';

/** Asserts that opening the store rejects with the older-GoatDB error. */
async function assertStoreRejected(
  db: GoatDB,
  artifact?: string,
  backupRequired = false,
): Promise<void> {
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
  if (artifact !== undefined) {
    assertTrue(
      message.includes(artifact),
      `expected rejection to name "${artifact}", got: ${message}`,
    );
  }
  if (backupRequired) {
    assertTrue(
      /back up/i.test(message),
      `expected rejection to require a backup, got: ${message}`,
    );
  }
}

function markerPath(storePath: path.PosixPath): path.PosixPath {
  return path.join(storePath, kStorageFormatMarkerFile);
}

async function writeMarker(
  storePath: path.PosixPath,
  epoch: string,
): Promise<void> {
  await writeFile(markerPath(storePath), gTextEncoder.encode(epoch + '\n'));
}

function rejectionMessage(r: PromiseRejectedResult): string {
  return r.reason instanceof Error ? r.reason.message : String(r.reason);
}

/**
 * Expected codec fingerprint per storage epoch.
 *
 * WHY: `kStorageFormatEpoch` used to depend on a "BUMP THIS" comment only, so
 * a codec/checksum change could ship without a bump and old stores would
 * mis-decode instead of failing fast. A codec change now fails this test until
 * the author bumps the epoch and records the new fingerprint.
 */
const kEpochFingerprints: Readonly<Record<number, string>> = {
  1: 'aca89293fe85f54d4e3e3f65fb80d41a',
};

const kFingerprintSchema: Schema = {
  ns: 'epoch-fingerprint',
  version: 1,
  fields: {
    d: { type: 'date' },
    s: { type: 'set' },
    m: { type: 'map' },
  },
};
const kFingerprintRegistry = new DataRegistry();
kFingerprintRegistry.registerSchema(kFingerprintSchema);

const kMapDateSchema: Schema = {
  ns: 'epoch-map-date',
  version: 1,
  fields: { m: { type: 'map' } },
};
const kMapDateRegistry = new DataRegistry();
kMapDateRegistry.registerSchema(kMapDateSchema);

/**
 * Deterministic fingerprint over the wire formats the epoch protects.
 * Covers core values (Date, Set, Map with a Date, shared refs) and the
 * authoritative Item checksum.
 */
function codecFingerprint(): string {
  const date = new Date(1_700_000_000_000);
  const shared = { id: 'shared', when: date };
  const fixtures: CoreValue[] = [
    date,
    new Set<CoreValue>([date, 'x', 2]),
    new Map<string, CoreValue>([['when', date], ['n', 1]]),
    { first: shared, second: shared } as CoreValue,
  ];
  const parts = fixtures.map((value) => {
    const encoder = new JSONCyclicalEncoder();
    encoder.set('v', value);
    return JSON.stringify(encoder.getOutput()) + '|' +
      new Murmur3Checksum({ typeSafe: true }).checksumForValue(value);
  });
  const item = new Item(
    {
      schema: kFingerprintSchema,
      data: {
        d: date,
        s: new Set([date]),
        m: new Map([['when', date]]),
      } as never,
    },
    kFingerprintRegistry,
  );
  parts.push(JSON.stringify(item.toJS()) + '|' + item.checksum);
  return new MD5Checksum().checksumForValue(parts.join('\n'));
}

/**
 * Matches the OPFS concurrent/rapid-reopen platform errors (see
 * file-impl-opfs.ts). These are storage-layer limitations, not epoch bugs.
 */
function isOpfsPlatformError(msg: string): boolean {
  return msg.includes('OPFS') || msg.includes('Access Handle') ||
    msg.includes('Access Handles') || msg.includes('another open') ||
    msg.includes('Writable stream') || msg.includes('InternalError');
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
    'concurrent first-opens do not spuriously reject',
    async (ctx) => {
      const db1 = await ctx.createDB('concurrent');
      const db2 = await ctx.createDB('concurrent');
      try {
        // On the browser, OPFS rejects concurrent sync access handles to the
        // same file with an InternalError (platform limitation, not our code).
        // If either DB fails, verify the error is NOT from our epoch logic
        // ("older GoatDB"). If both succeed, verify the marker is correct.
        const results = await Promise.allSettled([
          db1.readyPromise(),
          db2.readyPromise(),
        ]);
        const rejections = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        for (const r of rejections) {
          const msg = rejectionMessage(r);
          // OPFS platform error is acceptable; our epoch error is not. This
          // guard is why a false "older GoatDB" rejection fails the test.
          assertTrue(
            !msg.includes(kOlderStoreMessage),
            `epoch logic spuriously rejected concurrent open: ${msg}`,
          );
        }
        // At least one opener must win unless OPFS's concurrent-handle
        // limitation rejected every opener. Any other error is unexpected.
        if (!results.some((r) => r.status === 'fulfilled')) {
          assertTrue(
            rejections.length > 0 &&
              rejections.every((r) => isOpfsPlatformError(rejectionMessage(r))),
            `concurrent first-opens failed for a non-OPFS reason: ` +
              rejections.map(rejectionMessage).join('; '),
          );
        } else {
          const storePath = await ctx.tempDir('concurrent');
          const recorded = await readTextFile(markerPath(storePath));
          assertEquals(recorded?.trim(), String(kStorageFormatEpoch));
        }
      } finally {
        await db1.flushAll().catch(() => {});
        await db1.close().catch(() => {});
        await db2.flushAll().catch(() => {});
        await db2.close().catch(() => {});
      }
    },
  );

  TEST(
    'StorageFormatEpoch',
    'reopening a store with the current epoch succeeds',
    async (ctx) => {
      const first = await ctx.createDB('reopen');
      await first.readyPromise();
      await first.flushAll();
      await first.close();

      const second = await ctx.createDB('reopen');
      try {
        await second.readyPromise();
        assertTrue(second.ready);
      } finally {
        await second.flushAll();
        await second.close();
      }
    },
  );

  TEST(
    'StorageFormatEpoch',
    'a Date inside a map survives a store reopen and keeps its checksum',
    async (ctx) => {
      // Regression for the raw dictToPrimitive copy: the Date was stored as an
      // ISO string while the checksum tagged it as a Date, so the delta commit
      // was marked corrupted after reload.
      const date = new Date(1_700_000_000_000);
      const first = await ctx.createDB('map-date', {
        registry: kMapDateRegistry,
      });
      try {
        await first.readyPromise();
        await first.create('/data/maps/m1', kMapDateSchema, {
          m: new Map([['when', date]]),
        }).commit();
        await first.flushAll();
      } finally {
        await first.close();
      }

      const second = await ctx.createDB('map-date', {
        registry: kMapDateRegistry,
      });
      try {
        await second.readyPromise();
        await second.open('/data/maps');
        const map = second.item('/data/maps/m1').get('m') as Map<
          string,
          Date
        >;
        assertTrue(map.get('when') instanceof Date);
        assertEquals(map.get('when')!.getTime(), date.getTime());
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
      await assertStoreRejected(db, 'leftover.goat', true);
      await db.close();
    },
  );

  TEST(
    'StorageFormatEpoch',
    'unrelated files do not reject a store',
    async (ctx) => {
      // WHY: a user may point GoatDB at a directory that holds OS or editor
      // droppings. Only GoatDB-owned artifacts mark it as a foreign/legacy
      // store; `.DS_Store` alone must not trigger delete advice.
      const storePath = await ctx.tempDir('unrelated');
      await writeFile(
        path.join(storePath, '.DS_Store'),
        gTextEncoder.encode('finder-metadata'),
      );
      await writeFile(
        path.join(storePath, 'notes.txt'),
        gTextEncoder.encode('user notes'),
      );

      const db = await ctx.createDB('unrelated');
      try {
        await db.readyPromise();
        assertTrue(db.ready);
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'StorageFormatEpoch',
    'a repository artifact nested under a storage directory is rejected',
    async (ctx) => {
      const storePath = await ctx.tempDir('nested-artifact');
      await mkdir(path.join(storePath, 'data'));
      await writeFile(
        path.join(storePath, 'data', 'items.goat'),
        gTextEncoder.encode('old-store-contents'),
      );

      const db = await ctx.createDB('nested-artifact');
      await assertStoreRejected(db, 'data/items.goat', true);
      await db.close();
    },
  );

  TEST(
    'StorageFormatEpoch',
    'codec fingerprint matches the pinned epoch',
    () => {
      const expected = kEpochFingerprints[kStorageFormatEpoch];
      assertExists(
        expected,
        `No codec fingerprint for storage epoch ${kStorageFormatEpoch}. ` +
          'A codec change requires bumping kStorageFormatEpoch and adding its ' +
          'fingerprint to kEpochFingerprints.',
      );
      assertEquals(
        codecFingerprint(),
        expected,
        `Codec bytes changed. If intentional, bump kStorageFormatEpoch ` +
          `(currently ${kStorageFormatEpoch}) and add the new fingerprint.`,
      );
    },
  );

  TEST(
    'StorageFormatEpoch',
    'a store with a mismatched epoch is rejected',
    async (ctx) => {
      const storePath = await ctx.tempDir('mismatch');
      await writeMarker(storePath, String(kStorageFormatEpoch + 1));

      const db = await ctx.createDB('mismatch');
      await assertStoreRejected(db, undefined, true);
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

  TEST(
    'StorageFormatEpoch',
    'epoch-OK store still rejects a legacy bare-number date payload',
    async (ctx) => {
      const db = await ctx.createDB('epoch-ok-legacy-date');
      await db.readyPromise();
      try {
        const storePath = await ctx.tempDir('epoch-ok-legacy-date');
        // WHY: the epoch marker is current, so the store itself opens. The
        // legacy failure lives in the payload: pre-0.7 writers stored dates
        // as bare numbers, which the date field must reject loudly.
        const recorded = await readTextFile(markerPath(storePath));
        assertEquals(recorded?.trim(), String(kStorageFormatEpoch));
        const legacyPath = path.join(storePath, 'legacy-payload.json');
        await writeFile(
          legacyPath,
          gTextEncoder.encode(JSON.stringify({ when: 1700000000 })),
        );
        const raw = await readTextFile(legacyPath);
        assertExists(raw, 'expected legacy payload to be readable');
        const schema: Schema = {
          ns: 'storage-format-epoch-legacy-date',
          version: 1,
          fields: { when: { type: 'date' } },
        };
        let error: unknown;
        try {
          deserialize(new JSONDecoder(JSON.parse(raw) as never), schema);
        } catch (e) {
          error = e;
        }
        assertExists(error, 'expected legacy bare-number date to reject');
        const message = error instanceof Error ? error.message : String(error);
        assertTrue(
          message.includes('Legacy date value'),
          `expected legacy-date rejection, got: ${message}`,
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
