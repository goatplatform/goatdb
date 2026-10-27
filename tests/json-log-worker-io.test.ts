/**
 * Worker-backed file I/O contract (base/json-log/json-log.ts wrappers).
 *
 * The worker owns the FileImpl. Main-thread callers use the wrappers. These
 * tests drive real files through real temp directories and pin the observable
 * contract: bytes survive the roundtrip, and I/O failures keep their identity
 * across the worker boundary instead of collapsing into an opaque error.
 *
 * The error identity matters because db/storage-epoch.ts classifies a missing
 * marker by `name`/`code` (see isNotFound). The DB-open relay test lives with
 * the EISDIR fix: on Windows a directory read only errors once that lands.
 */
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { unknownCommandDetails } from '../base/json-log/json-log-worker-req.ts';
import { kStorageFormatMarkerFile } from '../db/storage-epoch.ts';
import {
  failJSONLogWorkerForTests,
  mkdir,
  readDir,
  readFile,
  writeFile,
} from '../base/json-log/json-log.ts';
import { readTextFile } from '../base/json-log/json-log.ts';
import { getRuntime } from '../base/runtime/index.ts';

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
    'DB open surfaces the underlying file error, not the epoch error',
    async (ctx) => {
      // The store root holds a DIRECTORY at the marker path. Every marker read
      // fails with a directory error, which is not "not found". The DB open
      // must relay that error, never turn it into an epoch mismatch.
      // WHY this lives here: on Windows a directory read only fails once the
      // EISDIR fix below lands, so the fixture needs it.
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
    'readFile of a directory surfaces EISDIR',
    async (ctx) => {
      // WHY: pins the shared EISDIR identity across the worker transport and
      // the browser-only OPFS normalization (TypeMismatchError -> EISDIR).
      const dir = await ctx.tempDir('eisdir');
      const error = await fileError(() => readFile(dir));
      assertEquals(
        error.code,
        'EISDIR',
        `lost EISDIR identity: ${error.name}: ${error.message}`,
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

  TEST(
    'JsonLogWorkerIO',
    'a dead worker rejects pending requests and the next one respawns',
    async (ctx) => {
      const dir = await ctx.tempDir('worker-death');
      const file = path.join(dir, 'value.bin');
      await writeFile(file, new Uint8Array([7, 8]));
      const failure = new Error('worker died');
      // Request sent first, then the worker dies: the pending call must
      // reject with the cause instead of waiting for an answer forever.
      const pending = readFile(file);
      failJSONLogWorkerForTests(failure);
      const outcome = await pending.then(
        () => 'resolved',
        (error: unknown) => error,
      );
      assertTrue(
        outcome === failure,
        'the pending read must reject with the worker failure',
      );
      // WHY: recovery, not just failure. A later read must reach a new worker.
      assertEquals(await readFile(file), new Uint8Array([7, 8]));
    },
  );

  TEST(
    'JsonLogWorkerIO',
    'the worker module logs through logging/ and never console',
    async () => {
      // WHY skip in the browser: this scans the repo tree, which only the
      // server runtimes have.
      if (getRuntime().id === 'browser') return;
      const source = await readTextFile(
        path.join(getRuntime().getCWD(), 'base/json-log/json-log.ts'),
      );
      assertTrue(source !== undefined, 'worker module must be readable');
      assertTrue(
        !source.includes('console.'),
        'worker failures must go through logging/, not console',
      );
    },
  );
}
