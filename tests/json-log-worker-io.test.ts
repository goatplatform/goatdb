/**
 * Worker-backed file I/O contract (base/json-log/json-log.ts wrappers).
 *
 * The worker owns the FileImpl. Main-thread callers use the wrappers. These
 * tests drive real files through real temp directories and pin the observable
 * contract: bytes survive the roundtrip, and I/O failures keep their identity
 * across the worker boundary instead of collapsing into an opaque error.
 *
 * The error identity matters because db/storage-epoch.ts classifies a missing
 * marker by `name`/`code` (see isNotFound).
 */
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { kStorageFormatMarkerFile } from '../db/storage-epoch.ts';
import { unknownCommandDetails } from '../base/json-log/json-log-worker-req.ts';
import {
  mkdir,
  readDir,
  readFile,
  writeFile,
} from '../base/json-log/json-log.ts';

/** Fragment of the epoch mismatch message; the DB must not fail for it here. */
const kOlderStoreMessage = 'created by an older GoatDB';

/** Runs an operation that must fail and returns the error with its identity. */
async function fileError(operation: () => Promise<unknown>): Promise<
  Error & { code?: string | number }
> {
  try {
    await operation();
  } catch (error) {
    assertTrue(error instanceof Error, 'I/O failure must reject with an Error');
    return error as Error & { code?: string | number };
  }
  throw new Error('Expected I/O failure');
}

export default function setupJsonLogWorkerIO(): void {
  TEST(
    'JsonLogWorkerIO',
    'DB open surfaces the underlying file error, not the epoch error',
    async (ctx) => {
      // The store root holds a DIRECTORY at the marker path. Every marker read
      // fails with a directory error, which is not "not found". The DB open
      // must relay that error, never turn it into an epoch mismatch.
      const storePath = await ctx.tempDir('io-errors');
      const marker = path.join(storePath, kStorageFormatMarkerFile);
      const missing = await fileError(() => readFile(marker));
      assertTrue(
        missing.name === 'NotFound' || missing.name === 'NotFoundError' ||
          missing.code === 'ENOENT',
        `missing-file identity lost: ${missing.name}: ${missing.message}`,
      );
      await mkdir(marker);
      const expected = await fileError(() => readFile(marker));
      const db = await ctx.createDB('io-errors');
      try {
        const actual = await fileError(() => db.readyPromise());
        // Compare stable identifiers only. Message text changes between engine
        // versions, so pinning it would be a change-detector.
        assertEquals(actual.name, expected.name);
        assertEquals(actual.code, expected.code);
        assertTrue(!actual.message.includes(kOlderStoreMessage));
      } finally {
        await db.close();
      }
    },
  );

  TEST(
    'JsonLogWorkerIO',
    'writeFile surfaces the filesystem error',
    async (ctx) => {
      const target = path.join(await ctx.tempDir('write-error'), 'as-dir');
      await mkdir(target);
      // Writing to a directory path must reject with a real filesystem error.
      // The regression this guards: the worker used to collapse every failure
      // into the opaque Error('InternalError') with no code.
      const error = await fileError(() =>
        writeFile(target, new TextEncoder().encode('marker\n'))
      );
      const isOpaqueFallback = error.name === 'Error' &&
        error.code === undefined && error.message === 'InternalError';
      assertTrue(
        !isOpaqueFallback,
        `worker collapsed the filesystem error: ${error.message}`,
      );
      assertTrue(
        error.code !== undefined || error.name !== 'Error',
        `filesystem identity lost: ${error.name}: ${error.message}`,
      );
    },
  );

  TEST(
    'JsonLogWorkerIO',
    'unknown worker command details carry the command name',
    () => {
      // WHY: a stale worker bundle predating a request type must stay
      // diagnosable. Pin the stable name and that the command is included.
      const details = unknownCommandDetails('bogus-future-cmd');
      assertEquals(details.name, 'Error');
      assertTrue(details.message.includes('bogus-future-cmd'));
    },
  );

  TEST(
    'JsonLogWorkerIO',
    'file roundtrip preserves content and error identity',
    async (ctx) => {
      const dir = path.join(await ctx.tempDir('fs-parity'), 'roundtrip');
      await mkdir(dir);
      const file = path.join(dir, 'hello.bin');
      const bytes = new Uint8Array([1, 2, 3, 250]);
      await writeFile(file, bytes);
      assertEquals(await readFile(file), bytes);
      const names = (await readDir(dir)).map((e) => e.name);
      assertTrue(names.includes('hello.bin'));
      const missing = await fileError(() =>
        readFile(path.join(dir, 'missing.bin'))
      );
      assertTrue(
        missing.name === 'NotFound' || missing.name === 'NotFoundError' ||
          missing.code === 'ENOENT',
        `missing-file identity lost: ${missing.name}`,
      );
    },
  );
}
