/**
 * Storage-layer tests for both on-disk formats: BINL and JSONL.
 *
 * Tests exercise the real worker-backed pipeline:
 *   JSONLogFileOpen -> worker thread -> FileImpl -> OS filesystem
 *
 * Key behavioral invariant: `knownIds` is shared between scan and append
 * operations within the same file session. Once an ID is seen (via scan) or
 * written (via append) it will NOT appear in subsequent scans of the same
 * session. Verification reads therefore use a fresh session (close + reopen).
 */
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { isBrowser } from '../base/common.ts';
import * as path from '../base/path.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import type { ReadonlyJSONObject } from '../base/interfaces.ts';
import {
  JSONLogFileAppend,
  JSONLogFileClose,
  JSONLogFileFlush,
  JSONLogFileOpen,
  JSONLogFileScan,
  JSONLogFileStartCursor,
} from '../base/json-log/json-log.ts';
import { GoatDB } from '../db/db.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { BINARY_MAGIC } from '../base/core-types/encoding/binary-commit.ts';
import {
  getGlobalLoggerStreams,
  setGlobalLoggerStreams,
} from '../logging/log.ts';
import type { LogEntry } from '../logging/log.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';

// Swaps in a capturing log stream for the duration of fn, then restores.
function withLogCapture<T>(
  fn: (captured: NormalizedLogEntry<LogEntry>[]) => Promise<T>,
): Promise<T> {
  const captured: NormalizedLogEntry<LogEntry>[] = [];
  const prev = getGlobalLoggerStreams();
  setGlobalLoggerStreams([{
    appendEntry(e: NormalizedLogEntry<LogEntry>): void {
      captured.push(e);
    },
  }]);
  return fn(captured).finally(() => setGlobalLoggerStreams(prev));
}

type LogFormat = 'goat' | 'jsonl';

const gTextEncoder = new TextEncoder();
const gTextDecoder = new TextDecoder();

// Minimal binary entry for goat format tests: BINARY_MAGIC header + id + contents JSON.
// Tests the framing layer (GOAT length-prefix); the real commit codec is in binary-encoding.test.ts.
function makeBinaryEntry(
  id: string,
  extraData: ReadonlyJSONObject = {},
): Uint8Array {
  const idBytes = gTextEncoder.encode(id);
  const contentsBytes = gTextEncoder.encode(
    JSON.stringify({ id, ...extraData }),
  );
  // Layout: 36-byte header | u16+id | u16+key(empty) | u16+session(empty) | u16+orgId(empty) | u16+schemaId(empty) | contentsBytes
  const HEADER_SIZE = 36;
  const idStart = HEADER_SIZE;
  const keyStart = idStart + 2 + idBytes.length;
  const sessionStart = keyStart + 2;
  const orgIdStart = sessionStart + 2;
  const schemaIdStart = orgIdStart + 2;
  const afterFixed = schemaIdStart + 2;
  const contentsStart = afterFixed;
  const buf = new Uint8Array(contentsStart + contentsBytes.length);
  buf[0] = BINARY_MAGIC; // magic
  buf[1] = 0x01; // version
  // age = -1 (i32 LE means "unset")
  buf[12] = 0xff;
  buf[13] = 0xff;
  buf[14] = 0xff;
  buf[15] = 0xff;
  // offsets (record-relative u16 LE)
  buf[24] = keyStart & 0xff;
  buf[25] = (keyStart >> 8) & 0xff;
  buf[26] = sessionStart & 0xff;
  buf[27] = (sessionStart >> 8) & 0xff;
  buf[28] = orgIdStart & 0xff;
  buf[29] = (orgIdStart >> 8) & 0xff;
  buf[30] = schemaIdStart & 0xff;
  buf[31] = (schemaIdStart >> 8) & 0xff;
  buf[32] = afterFixed & 0xff;
  buf[33] = (afterFixed >> 8) & 0xff;
  buf[34] = contentsStart & 0xff;
  buf[35] = (contentsStart >> 8) & 0xff;
  // id field: u16 length + bytes
  buf[idStart] = idBytes.length & 0xff;
  buf[idStart + 1] = (idBytes.length >> 8) & 0xff;
  buf.set(idBytes, idStart + 2);
  // contents
  buf.set(contentsBytes, contentsStart);
  return buf;
}

// makeEntry produces binary for goat (framing test, not codec test), JSON for jsonl.
function makeEntry(
  format: LogFormat,
  id: string,
  extraData: ReadonlyJSONObject = {},
): Uint8Array {
  if (format === 'goat') return makeBinaryEntry(id, extraData);
  return gTextEncoder.encode(JSON.stringify({ id, ...extraData }));
}

function decodeEntry(
  format: LogFormat,
  bytes: Uint8Array,
): ReadonlyJSONObject {
  if (format === 'goat' && bytes.length > 0 && bytes[0] === BINARY_MAGIC) {
    const contentsOffset = bytes[34] | (bytes[35] << 8);
    return JSON.parse(
      gTextDecoder.decode(bytes.subarray(contentsOffset)),
    ) as ReadonlyJSONObject;
  }
  return JSON.parse(gTextDecoder.decode(bytes)) as ReadonlyJSONObject;
}

async function scanAll(file: number): Promise<Uint8Array[]> {
  const cursor = await JSONLogFileStartCursor(file);
  const all: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const result = await JSONLogFileScan(cursor);
    done = result.done;
    if (result.values) {
      all.push(...(result.values as Uint8Array[]));
    } else if (result.buffer && result.offsets) {
      for (let i = 0; i < result.offsets.length; i += 2) {
        const offset = result.offsets[i];
        const len = result.offsets[i + 1];
        all.push(result.buffer.slice(offset, offset + len));
      }
    }
  }
  return all;
}

export default function setupJsonLogFormats() {
  // ── Group 1: Roundtrip ────────────────────────────────────────────────────
  for (const format of ['goat', 'jsonl'] as const) {
    TEST(
      'JsonLogFormats',
      `${format}: single entry roundtrip`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-single`);
        const filePath = path.join(dir, `data.${format}`);
        const entry = makeEntry(format, 'id-1', { value: 'hello' });

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, [entry]);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(results.length, 1, 'should return exactly 1 entry');
          const decoded = decodeEntry(format, results[0]);
          assertEquals(decoded.id, 'id-1', 'id should match');
          assertEquals(decoded.value, 'hello', 'value should match');
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: multiple entries roundtrip`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-multi`);
        const filePath = path.join(dir, `data.${format}`);
        const entries = Array.from(
          { length: 10 },
          (_, i) => makeEntry(format, `id-${i}`, { index: i }),
        );

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, entries);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(results.length, 10, 'should return all 10 entries');
          for (let i = 0; i < 10; i++) {
            const decoded = decodeEntry(format, results[i]);
            assertEquals(decoded.id, `id-${i}`, `entry ${i} id should match`);
          }
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: append-scan-append-scan interleave`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-interleave`);
        const filePath = path.join(dir, `data.${format}`);

        // Session 1: write 3 entries
        let file = await JSONLogFileOpen(filePath, true);
        const first3 = Array.from(
          { length: 3 },
          (_, i) => makeEntry(format, `id-${i}`, { batch: 1 }),
        );
        await JSONLogFileAppend(file, first3);
        await JSONLogFileClose(file);

        // Session 2: scan existing 3, then append 3 more
        file = await JSONLogFileOpen(filePath, true);
        const results1 = await scanAll(file);
        assertEquals(results1.length, 3, 'first scan should return 3 entries');
        const next3 = Array.from(
          { length: 3 },
          (_, i) => makeEntry(format, `id-${i + 3}`, { batch: 2 }),
        );
        await JSONLogFileAppend(file, next3);
        await JSONLogFileClose(file);

        // Session 3: verify all 6 present
        file = await JSONLogFileOpen(filePath, false);
        try {
          const results2 = await scanAll(file);
          assertEquals(
            results2.length,
            6,
            'fresh scan should return all 6 entries',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST('JsonLogFormats', `${format}: empty file scan`, async (ctx) => {
      const dir = await ctx.tempDir(`jlf-${format}-empty`);
      const filePath = path.join(dir, `data.${format}`);

      const file = await JSONLogFileOpen(filePath, true);
      try {
        const cursor = await JSONLogFileStartCursor(file);
        const result = await JSONLogFileScan(cursor);
        const values = result.values ?? [];
        assertEquals(values.length, 0, 'empty file should return 0 entries');
        assertTrue(result.done, 'empty file scan should be done immediately');
      } finally {
        await JSONLogFileClose(file);
      }
    });

    TEST(
      'JsonLogFormats',
      `${format}: single entry file after flush`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-single-flush`);
        const filePath = path.join(dir, `data.${format}`);
        const entry = makeEntry(format, 'entry-1', { msg: 'test' });

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, [entry]);
          await JSONLogFileFlush(file);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            1,
            'should return exactly 1 entry after flush+close+reopen',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );
  }

  // ── Group 2: Batch Boundaries ─────────────────────────────────────────────
  for (const format of ['goat', 'jsonl'] as const) {
    TEST(
      'JsonLogFormats',
      `${format}: 100 entries hits batch boundary`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-batch100`);
        const filePath = path.join(dir, `data.${format}`);
        const entries = Array.from(
          { length: 100 },
          (_, i) => makeEntry(format, `id-${i}`, { i }),
        );

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, entries);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const cursor = await JSONLogFileStartCursor(file);
          const r1 = await JSONLogFileScan(cursor);
          const count1 = r1.values
            ? r1.values.length
            : r1.offsets
            ? r1.offsets.length / 2
            : 0;
          assertEquals(
            count1,
            100,
            'first scan should return exactly 100 entries',
          );
          assertTrue(
            !r1.done,
            'first scan should not be done after exactly 100 entries',
          );

          const r2 = await JSONLogFileScan(cursor);
          const count2 = r2.values
            ? r2.values.length
            : r2.offsets
            ? r2.offsets.length / 2
            : 0;
          assertEquals(
            count2,
            0,
            'second scan should return 0 entries',
          );
          assertTrue(r2.done, 'second scan should be done');
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: 250 entries spans multiple batches`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-batch250`);
        const filePath = path.join(dir, `data.${format}`);
        const entries = Array.from(
          { length: 250 },
          (_, i) => makeEntry(format, `id-${i}`, { i }),
        );

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, entries);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            250,
            'scanAll should return all 250 entries',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );
  }

  // ── Group 3: Deduplication ────────────────────────────────────────────────
  for (const format of ['goat', 'jsonl'] as const) {
    TEST(
      'JsonLogFormats',
      `${format}: duplicate IDs in single append`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-dedup-single`);
        const filePath = path.join(dir, `data.${format}`);
        const entry1 = makeEntry(format, 'same-id', { version: 1 });
        const entry2 = makeEntry(format, 'same-id', { version: 2 });

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, [entry1, entry2]);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            1,
            'duplicate IDs in single append should yield 1 entry',
          );
          const decoded = decodeEntry(format, results[0]);
          assertEquals(
            decoded.version,
            1,
            'first entry should win (first occurrence kept)',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: duplicate IDs across appends`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-dedup-multi`);
        const filePath = path.join(dir, `data.${format}`);
        const entry1 = makeEntry(format, 'same-id', { version: 1 });
        const entry2 = makeEntry(format, 'same-id', { version: 2 });

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, [entry1]);
          await JSONLogFileAppend(file, [entry2]);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            1,
            'duplicate IDs across appends should yield 1 entry',
          );
          const decoded = decodeEntry(format, results[0]);
          assertEquals(decoded.version, 1, 'first entry should win');
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: duplicate IDs across close/reopen`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-dedup-reopen`);
        const filePath = path.join(dir, `data.${format}`);

        // Write 5 entries (round 1)
        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(
            file,
            Array.from(
              { length: 5 },
              (_, i) => makeEntry(format, `id-${i}`, { round: 1 }),
            ),
          );
        } finally {
          await JSONLogFileClose(file);
        }

        // Reopen and try to append same IDs (round 2) – pre-scan guard deduplicates
        file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(
            file,
            Array.from(
              { length: 5 },
              (_, i) => makeEntry(format, `id-${i}`, { round: 2 }),
            ),
          );
        } finally {
          await JSONLogFileClose(file);
        }

        // Verify: only the original 5 entries exist
        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            5,
            'after close/reopen, same IDs should not be duplicated',
          );
          for (const result of results) {
            const decoded = decodeEntry(format, result);
            assertEquals(
              decoded.round,
              1,
              'round-1 entries should be preserved',
            );
          }
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: explicit ids parameter dedup`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-dedup-ids`);
        const filePath = path.join(dir, `data.${format}`);
        const bytes1 = makeEntry(format, 'explicit-1', { data: 'a' });
        const bytes2 = makeEntry(format, 'explicit-1', { data: 'b' });

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(
            file,
            [bytes1, bytes2],
            ['explicit-1', 'explicit-1'],
          );
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            1,
            'explicit ids dedup should yield 1 entry',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );
  }

  // ── Group 4: Corruption ───────────────────────────────────────────────────
  // Symmetric: both formats
  for (const format of ['goat', 'jsonl'] as const) {
    TEST(
      'JsonLogFormats',
      `${format}: trailing garbage bytes`,
      async (ctx) => {
        if (isBrowser()) return;
        const dir = await ctx.tempDir(`jlf-${format}-corruption-garbage`);
        const filePath = path.join(dir, `data.${format}`);
        const entry = makeEntry(format, 'good-entry', { ok: true });

        // Write 1 valid entry
        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, [entry]);
        } finally {
          await JSONLogFileClose(file);
        }

        // Record clean file size
        const impl = await FileImplGet();
        const rh = await impl.open(filePath, false);
        const cleanSize = await impl.seek(rh, 0, 'end');
        await impl.close(rh);

        // Inject 10 garbage bytes at end
        const wh = await impl.open(filePath, true);
        await impl.seek(wh, 0, 'end');
        await impl.write(wh, new Uint8Array(10).fill(0xde));
        await impl.close(wh);

        // Reopen writable – scan should recover the valid entry; garbage triggers a warning
        file = await JSONLogFileOpen(filePath, true);
        await withLogCapture(async (captured) => {
          try {
            const results = await scanAll(file);
            assertEquals(
              results.length,
              1,
              'should return the 1 valid entry despite trailing garbage',
            );
            assertEquals(
              decodeEntry(format, results[0]).id,
              'good-entry',
              'valid entry should be intact',
            );
          } finally {
            await JSONLogFileClose(file);
          }
          if (format === 'jsonl') {
            assertTrue(
              captured.some((e) =>
                e.message?.includes('skipped malformed line')
              ),
              'jsonl should warn about unparseable garbage bytes',
            );
          }
        });

        // BINL truncates garbage; JSONL skips it (no truncation)
        if (format === 'goat') {
          const vh = await impl.open(filePath, false);
          const finalSize = await impl.seek(vh, 0, 'end');
          await impl.close(vh);
          assertEquals(
            finalSize,
            cleanSize,
            'goat file should be truncated back to clean size',
          );
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: partial record at EOF`,
      async (ctx) => {
        if (isBrowser()) return;
        const dir = await ctx.tempDir(`jlf-${format}-corruption-partial`);
        const filePath = path.join(dir, `data.${format}`);
        const entry = makeEntry(format, 'good-entry', { ok: true });

        // Write 1 valid entry
        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, [entry]);
        } finally {
          await JSONLogFileClose(file);
        }

        // Record clean file size
        const impl = await FileImplGet();
        const rh = await impl.open(filePath, false);
        const cleanSize = await impl.seek(rh, 0, 'end');
        await impl.close(rh);

        // Inject format-specific partial record
        const wh = await impl.open(filePath, true);
        await impl.seek(wh, 0, 'end');
        if (format === 'goat') {
          // 2-byte partial header (need 4)
          await impl.write(wh, new Uint8Array([0x00, 0x01]));
        } else {
          // Partial JSON without closing brace or newline
          await impl.write(
            wh,
            new TextEncoder().encode('{"id":"partial"'),
          );
        }
        await impl.close(wh);

        // Reopen writable – valid entry should survive; partial record may trigger a warning
        file = await JSONLogFileOpen(filePath, true);
        await withLogCapture(async (captured) => {
          try {
            const results = await scanAll(file);
            assertEquals(
              results.length,
              1,
              'should return valid entry despite partial EOF record',
            );
            assertEquals(
              decodeEntry(format, results[0]).id,
              'good-entry',
              'valid entry should be intact',
            );
          } finally {
            await JSONLogFileClose(file);
          }
          if (format === 'jsonl') {
            assertTrue(
              captured.some((e) =>
                e.message?.includes('skipped malformed line')
              ),
              'jsonl should warn about the partial line at EOF',
            );
          }
        });

        // BINL truncates; JSONL skips the partial line
        if (format === 'goat') {
          const vh = await impl.open(filePath, false);
          const finalSize = await impl.seek(vh, 0, 'end');
          await impl.close(vh);
          assertEquals(
            finalSize,
            cleanSize,
            'goat file should be truncated to clean size',
          );
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: read-only does NOT truncate`,
      async (ctx) => {
        if (isBrowser()) return;
        const dir = await ctx.tempDir(`jlf-${format}-corruption-readonly`);
        const filePath = path.join(dir, `data.${format}`);
        const entry = makeEntry(format, 'good-entry', { ok: true });

        // Write 1 valid entry
        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, [entry]);
        } finally {
          await JSONLogFileClose(file);
        }

        // Inject 10 garbage bytes
        const impl = await FileImplGet();
        const wh = await impl.open(filePath, true);
        await impl.seek(wh, 0, 'end');
        await impl.write(wh, new Uint8Array(10).fill(0xde));
        await impl.close(wh);

        // Record file size with garbage present
        const rh = await impl.open(filePath, false);
        const sizeWithGarbage = await impl.seek(rh, 0, 'end');
        await impl.close(rh);

        // Reopen read-only – should return valid entry without truncating; garbage triggers warning
        file = await JSONLogFileOpen(filePath, false);
        await withLogCapture(async (captured) => {
          try {
            const results = await scanAll(file);
            assertEquals(
              results.length,
              1,
              'read-only scan should still return valid entry',
            );
          } finally {
            await JSONLogFileClose(file);
          }
          if (format === 'jsonl') {
            assertTrue(
              captured.some((e) =>
                e.message?.includes('skipped malformed line')
              ),
              'jsonl should warn about unparseable garbage bytes',
            );
          }
        });

        // File size must be unchanged
        const vh = await impl.open(filePath, false);
        const finalSize = await impl.seek(vh, 0, 'end');
        await impl.close(vh);
        assertEquals(
          finalSize,
          sizeWithGarbage,
          'read-only scan should NOT truncate the file',
        );
      },
    );
  }

  // BINL-only: valid header + garbage payload is skipped (not truncated)
  TEST(
    'JsonLogFormats',
    'goat: corrupted payload skipped',
    async (ctx) => {
      if (isBrowser()) return;
      const dir = await ctx.tempDir('jlf-goat-corruption-payload');
      const filePath = path.join(dir, 'data.goat');
      const entry = makeEntry('goat', 'good-entry', { ok: true });

      // Write 1 valid entry
      let file = await JSONLogFileOpen(filePath, true);
      try {
        await JSONLogFileAppend(file, [entry], ['good-entry']);
      } finally {
        await JSONLogFileClose(file);
      }

      // Inject a well-formed BINL header pointing to garbage payload
      const impl = await FileImplGet();
      const wh = await impl.open(filePath, true);
      await impl.seek(wh, 0, 'end');
      const payloadLen = 10;
      const corruptHeader = new Uint8Array([
        (payloadLen >>> 24) & 0xff,
        (payloadLen >>> 16) & 0xff,
        (payloadLen >>> 8) & 0xff,
        payloadLen & 0xff,
      ]);
      await impl.write(wh, corruptHeader);
      await impl.write(wh, new Uint8Array(payloadLen).fill(0xff));
      await impl.close(wh);

      // Record file size with garbage appended
      const rh = await impl.open(filePath, false);
      const sizeWithGarbage = await impl.seek(rh, 0, 'end');
      await impl.close(rh);

      // Reopen writable -- valid entry returned, corrupt record skipped with warning
      file = await JSONLogFileOpen(filePath, true);
      await withLogCapture(async (captured) => {
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            1,
            'should return the 1 valid entry before corrupt record',
          );
          assertEquals(
            decodeEntry('goat', results[0]).id,
            'good-entry',
            'valid entry should be intact',
          );
          assertTrue(
            captured.some((e) => e.message?.includes('non-binary record')),
            'should warn about non-binary record in .goat file',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      });

      // File should NOT be truncated -- bad record stays on disk
      const vh = await impl.open(filePath, false);
      const finalSize = await impl.seek(vh, 0, 'end');
      await impl.close(vh);
      assertEquals(
        finalSize,
        sizeWithGarbage,
        'file should NOT be truncated (bad record skipped, not removed)',
      );
    },
  );

  // BINL-only: corrupt record between valid records preserves all good data
  TEST(
    'JsonLogFormats',
    'goat: corrupt record between valid records preserves all good data',
    async (ctx) => {
      if (isBrowser()) return;
      const dir = await ctx.tempDir('jlf-goat-skip-continue');
      const filePath = path.join(dir, 'data.goat');
      const impl = await FileImplGet();

      // Build file: 5 valid + 1 corrupt + 5 valid entries via raw FileImpl
      const wh = await impl.open(filePath, true);
      try {
        // 5 valid entries before corrupt
        for (let i = 0; i < 5; i++) {
          const payload = makeBinaryEntry(`before-${i}`, { i });
          const header = new Uint8Array(4);
          header[0] = (payload.length >>> 24) & 0xff;
          header[1] = (payload.length >>> 16) & 0xff;
          header[2] = (payload.length >>> 8) & 0xff;
          header[3] = payload.length & 0xff;
          await impl.write(wh, header);
          await impl.write(wh, payload);
        }
        // 1 corrupt entry: valid length header, garbage payload (non-BINARY_MAGIC)
        const corruptPayloadLen = 20;
        const corruptHeader = new Uint8Array([
          (corruptPayloadLen >>> 24) & 0xff,
          (corruptPayloadLen >>> 16) & 0xff,
          (corruptPayloadLen >>> 8) & 0xff,
          corruptPayloadLen & 0xff,
        ]);
        await impl.write(wh, corruptHeader);
        await impl.write(wh, new Uint8Array(corruptPayloadLen).fill(0xfe));
        // 5 valid entries after corrupt
        for (let i = 0; i < 5; i++) {
          const payload = makeBinaryEntry(`after-${i}`, { i });
          const header = new Uint8Array(4);
          header[0] = (payload.length >>> 24) & 0xff;
          header[1] = (payload.length >>> 16) & 0xff;
          header[2] = (payload.length >>> 8) & 0xff;
          header[3] = payload.length & 0xff;
          await impl.write(wh, header);
          await impl.write(wh, payload);
        }
      } finally {
        await impl.close(wh);
      }

      // Record total file size
      const rh = await impl.open(filePath, false);
      const totalSize = await impl.seek(rh, 0, 'end');
      await impl.close(rh);

      // Scan and verify all 10 valid entries are returned; 1 corrupt skipped with warning
      const file = await JSONLogFileOpen(filePath, false);
      await withLogCapture(async (captured) => {
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            10,
            'all 10 valid entries should be returned (corrupt one skipped)',
          );
          const ids = results.map((r) => decodeEntry('goat', r).id as string);
          for (let i = 0; i < 5; i++) {
            assertTrue(
              ids.includes(`before-${i}`),
              `before-${i} should be present`,
            );
            assertTrue(
              ids.includes(`after-${i}`),
              `after-${i} should be present`,
            );
          }
          assertTrue(
            captured.some((e) => e.message?.includes('non-binary record')),
            'should warn about the 1 corrupt record',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      });

      // File should NOT be truncated
      const vh = await impl.open(filePath, false);
      const finalSize = await impl.seek(vh, 0, 'end');
      await impl.close(vh);
      assertEquals(
        finalSize,
        totalSize,
        'file size should be unchanged (no truncation)',
      );
    },
  );

  // JSONL-only: malformed JSON line is silently skipped
  TEST(
    'JsonLogFormats',
    'jsonl: malformed JSON line skipped',
    async (ctx) => {
      if (isBrowser()) return;
      const dir = await ctx.tempDir('jlf-jsonl-malformed');
      const filePath = path.join(dir, 'data.jsonl');

      // Write valid + bad + valid lines directly via FileImpl
      const impl = await FileImplGet();
      const wh = await impl.open(filePath, true);
      try {
        await impl.write(
          wh,
          new TextEncoder().encode('{"id":"good-1","val":1}\n'),
        );
        await impl.write(
          wh,
          new TextEncoder().encode('{not valid json}\n'),
        );
        await impl.write(
          wh,
          new TextEncoder().encode('{"id":"good-2","val":2}\n'),
        );
      } finally {
        await impl.close(wh);
      }

      const file = await JSONLogFileOpen(filePath, false);
      await withLogCapture(async (captured) => {
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            2,
            'should skip malformed JSON line and return 2 valid entries',
          );
          const ids = results.map((r) => decodeEntry('jsonl', r).id);
          assertTrue(
            (ids as string[]).includes('good-1'),
            'good-1 should be present',
          );
          assertTrue(
            (ids as string[]).includes('good-2'),
            'good-2 should be present',
          );
          assertTrue(
            captured.some((e) => e.message?.includes('skipped malformed line')),
            'should warn about the malformed JSON line',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      });
    },
  );

  // ── Group 5: Large Payload ────────────────────────────────────────────────
  for (const format of ['goat', 'jsonl'] as const) {
    TEST(
      'JsonLogFormats',
      `${format}: entry larger than 1MB read buffer`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-large-1mb`);
        const filePath = path.join(dir, `data.${format}`);
        const largeValue = 'x'.repeat(1.5 * 1024 * 1024);
        const entry = makeEntry(format, 'large-entry', { blob: largeValue });

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, [entry]);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(results.length, 1, 'should return 1 large entry');
          const decoded = decodeEntry(format, results[0]);
          assertEquals(decoded.id, 'large-entry', 'id should match');
          assertEquals(
            (decoded.blob as string).length,
            largeValue.length,
            'large value should roundtrip correctly',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: mixed small and large entries`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-mixed-large`);
        const filePath = path.join(dir, `data.${format}`);
        const largeBlob = 'y'.repeat(500 * 1024);

        const allEntries = [
          ...Array.from(
            { length: 50 },
            (_, i) => makeEntry(format, `small-${i}`, { i }),
          ),
          makeEntry(format, 'large-0', { blob: largeBlob }),
          ...Array.from(
            { length: 50 },
            (_, i) => makeEntry(format, `small-${i + 50}`, { i: i + 50 }),
          ),
        ];

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(file, allEntries);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(results.length, 101, 'should return all 101 entries');
          const largeResult = results.find(
            (r) => decodeEntry(format, r).id === 'large-0',
          );
          assertTrue(
            largeResult !== undefined,
            'large entry should be present',
          );
          const decoded = decodeEntry(format, largeResult!);
          assertEquals(
            (decoded.blob as string).length,
            largeBlob.length,
            'large entry blob should be intact',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );
  }

  // ── Group 6: Flush ────────────────────────────────────────────────────────
  for (const format of ['goat', 'jsonl'] as const) {
    TEST(
      'JsonLogFormats',
      `${format}: flush does not corrupt`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-flush-nocorrupt`);
        const filePath = path.join(dir, `data.${format}`);

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(
            file,
            Array.from(
              { length: 3 },
              (_, i) => makeEntry(format, `batch1-${i}`, { batch: 1 }),
            ),
          );
          await JSONLogFileFlush(file);
          await JSONLogFileAppend(
            file,
            Array.from(
              { length: 3 },
              (_, i) => makeEntry(format, `batch2-${i}`, { batch: 2 }),
            ),
          );
          await JSONLogFileFlush(file);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            6,
            'all 6 entries should be present after flush cycles',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: data persists after flush+close`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-flush-persist`);
        const filePath = path.join(dir, `data.${format}`);

        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(
            file,
            Array.from(
              { length: 5 },
              (_, i) => makeEntry(format, `persist-${i}`, { i }),
            ),
          );
          await JSONLogFileFlush(file);
        } finally {
          await JSONLogFileClose(file);
        }

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            5,
            'all 5 entries should persist after flush+close',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );
  }

  // ── Group 7: Pre-Scan Guard ───────────────────────────────────────────────
  for (const format of ['goat', 'jsonl'] as const) {
    TEST(
      'JsonLogFormats',
      `${format}: append without prior scan populates knownIds`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-prescan`);
        const filePath = path.join(dir, `data.${format}`);

        // Write 5 entries
        let file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(
            file,
            Array.from(
              { length: 5 },
              (_, i) => makeEntry(format, `id-${i}`, { v: 1 }),
            ),
          );
        } finally {
          await JSONLogFileClose(file);
        }

        // Reopen (no explicit scan) and append same IDs – pre-scan guard fires
        file = await JSONLogFileOpen(filePath, true);
        try {
          await JSONLogFileAppend(
            file,
            Array.from(
              { length: 5 },
              (_, i) => makeEntry(format, `id-${i}`, { v: 2 }),
            ),
          );
        } finally {
          await JSONLogFileClose(file);
        }

        // Verify exactly 5 entries (no duplicates written by second append)
        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            5,
            'pre-scan guard should prevent duplicate entries',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );
  }

  // ── Group 8: Format Fallback ──────────────────────────────────────────────
  TEST(
    'JsonLogFormats',
    'DB falls back from goat to jsonl when configured file missing',
    async (ctx) => {
      if (isBrowser()) return;

      const kFallbackSchema = {
        ns: 'fallback-test',
        version: 1,
        fields: {
          title: { type: 'string', required: true },
        },
      } as const;
      const registry = new DataRegistry();
      registry.registerSchema(kFallbackSchema);

      // 1. Create DB with jsonl, write data, close
      const db1 = await ctx.createDB('jlf-fallback', {
        storageFormat: 'jsonl',
        registry,
      });
      await db1.readyPromise();
      db1.create('/data/fallback/item-1', kFallbackSchema, { title: 'test' });
      await db1.flushAll();
      const dbPath = db1.path;
      await db1.close();

      // 2. Reopen same directory with goat — should fall back to jsonl with warnings
      await withLogCapture(async (captured) => {
        const db2 = new GoatDB({
          path: dbPath,
          orgId: 'test-org',
          trusted: true,
          registry,
          storageFormat: 'goat',
        });
        try {
          await db2.readyPromise();
          const item = db2.item('/data/fallback/item-1');
          assertTrue(
            item !== undefined,
            'item should exist after format fallback',
          );
          assertTrue(
            captured.some((e) => e.message?.includes('goat file not found')),
            'should warn about goat file not found and falling back to jsonl',
          );
        } finally {
          await db2.flushAll();
          await db2.close();
        }
      });
    },
  );

  // ── Group 9: Binary Payload (BINARY_MAGIC fast path) ─────────────────────
  // Exercises the binaryExtractId path in BinaryLogFileScan / BinaryLogFileAppend
  TEST(
    'JsonLogFormats',
    'goat: binary payload roundtrip via BINARY_MAGIC path',
    async (ctx) => {
      const dir = await ctx.tempDir('jlf-goat-binary-magic');
      const filePath = path.join(dir, 'data.goat');

      // Build a minimal valid binary commit payload by hand.
      // Layout: 36-byte header + id (u16-len prefix) + key/session/orgId/schemaId
      // (each empty, 2-byte prefix) + contents bytes.
      const enc = new TextEncoder();
      const idStr = 'binary-magic-id';
      const idBytes = enc.encode(idStr);
      const contentsBytes = enc.encode('{}');

      const HEADER_SIZE = 36;
      // Fixed string field offsets
      const keyOffset = HEADER_SIZE + 2 + idBytes.length;
      const sessionOffset = keyOffset + 2;
      const orgIdOffset = sessionOffset + 2;
      const schemaIdOffset = orgIdOffset + 2;
      const afterFixedOffset = schemaIdOffset + 2;
      const contentsOffset = afterFixedOffset; // no parents/filter/conditional strings

      const totalLen = contentsOffset + contentsBytes.length;
      const payload = new Uint8Array(totalLen);

      payload[0] = BINARY_MAGIC;
      payload[1] = 0x01; // version
      // flags = 0 at bytes 2-3
      // timestamp = 0 at bytes 4-11
      // age = 0 at bytes 12-15
      // ancestorsCount = 0 at bytes 16-19
      // buildVersion = 0 at bytes 20-23
      payload[24] = keyOffset & 0xff;
      payload[25] = (keyOffset >> 8) & 0xff;
      payload[26] = sessionOffset & 0xff;
      payload[27] = (sessionOffset >> 8) & 0xff;
      payload[28] = orgIdOffset & 0xff;
      payload[29] = (orgIdOffset >> 8) & 0xff;
      payload[30] = schemaIdOffset & 0xff;
      payload[31] = (schemaIdOffset >> 8) & 0xff;
      payload[32] = afterFixedOffset & 0xff;
      payload[33] = (afterFixedOffset >> 8) & 0xff;
      payload[34] = contentsOffset & 0xff;
      payload[35] = (contentsOffset >> 8) & 0xff;

      let pos = HEADER_SIZE;
      payload[pos++] = idBytes.length & 0xff;
      payload[pos++] = (idBytes.length >> 8) & 0xff;
      payload.set(idBytes, pos);
      pos += idBytes.length;
      // key, session, orgId, schemaId: each empty (2-byte zero length prefix)
      pos += 8;
      payload.set(contentsBytes, pos);

      let file = await JSONLogFileOpen(filePath, true);
      try {
        await JSONLogFileAppend(file, [payload]);
      } finally {
        await JSONLogFileClose(file);
      }

      file = await JSONLogFileOpen(filePath, false);
      try {
        const results = await scanAll(file);
        assertEquals(results.length, 1, 'binary payload should be stored');
        assertEquals(
          results[0][0],
          BINARY_MAGIC,
          'returned bytes should start with BINARY_MAGIC',
        );
      } finally {
        await JSONLogFileClose(file);
      }
    },
  );

  // ── Group 10: Invalid ID Entries ──────────────────────────────────────────
  for (const format of ['goat', 'jsonl'] as const) {
    TEST(
      'JsonLogFormats',
      `${format}: entry without id field`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-no-id`);
        const filePath = path.join(dir, `data.${format}`);
        const noIdEntry: ReadonlyJSONObject = { value: 'no id here' };
        const entryBytes = new TextEncoder().encode(JSON.stringify(noIdEntry));

        // goat format rejects non-binary payloads with a WARNING; jsonl skips
        // silently because it parses JSON and checks for the id field there.
        let file = await JSONLogFileOpen(filePath, true);
        await withLogCapture(async (captured) => {
          try {
            await JSONLogFileAppend(file, [entryBytes]);
          } finally {
            await JSONLogFileClose(file);
          }
          if (format === 'goat') {
            assertTrue(
              captured.some((e) =>
                e.message?.includes('non-binary payload rejected')
              ),
              'goat format should warn about non-binary payload',
            );
          }
        });

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            0,
            'entry without id field should not be stored',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );

    TEST(
      'JsonLogFormats',
      `${format}: entry with non-string id`,
      async (ctx) => {
        const dir = await ctx.tempDir(`jlf-${format}-bad-id`);
        const filePath = path.join(dir, `data.${format}`);
        // ReadonlyJSONObject allows numeric values – id: 42 is valid JSON but not a string
        const badIdEntry: ReadonlyJSONObject = { id: 42, value: 'numeric id' };
        const entryBytes = new TextEncoder().encode(JSON.stringify(badIdEntry));

        // goat format rejects non-binary payloads with a WARNING; jsonl skips
        // silently because it parses JSON and checks for the id field there.
        let file = await JSONLogFileOpen(filePath, true);
        await withLogCapture(async (captured) => {
          try {
            await JSONLogFileAppend(file, [entryBytes]);
          } finally {
            await JSONLogFileClose(file);
          }
          if (format === 'goat') {
            assertTrue(
              captured.some((e) =>
                e.message?.includes('non-binary payload rejected')
              ),
              'goat format should warn about non-binary payload',
            );
          }
        });

        file = await JSONLogFileOpen(filePath, false);
        try {
          const results = await scanAll(file);
          assertEquals(
            results.length,
            0,
            'entry with non-string id should not be stored',
          );
        } finally {
          await JSONLogFileClose(file);
        }
      },
    );
  }
}
