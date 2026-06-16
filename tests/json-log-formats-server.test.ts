/**
 * Server-only JSON log format tests.
 *
 * Corruption recovery and format-fallback tests require direct filesystem
 * access (FileImpl raw I/O, multi-process DB reopen) and are NOT registered
 * in the browser entry point.
 */
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import {
  JSONLogFileAppend,
  JSONLogFileClose,
  JSONLogFileOpen,
} from '../base/json-log/json-log.ts';
import { GoatDB } from '../db/db.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { withLogCapture } from './test-utils.ts';
import {
  decodeEntry,
  makeBinaryEntry,
  makeEntry,
  scanAll,
} from './json-log-formats-helpers.ts';

export default function setupJsonLogFormatsServer(): void {
  // ── Group 4: Corruption ───────────────────────────────────────────────────
  // Symmetric: both formats
  for (const format of ['goat', 'jsonl'] as const) {
    TEST(
      'JsonLogFormats',
      `${format}: trailing garbage bytes`,
      async (ctx) => {
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

        // goat truncates garbage; JSONL skips it (no truncation)
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

        // goat truncates; JSONL skips the partial line
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

  // goat-only: valid header + garbage payload is skipped (not truncated)
  TEST(
    'JsonLogFormats',
    'goat: corrupted payload skipped',
    async (ctx) => {
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

      // Inject a well-formed goat header pointing to garbage payload
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

  // goat-only: corrupt record between valid records preserves all good data
  TEST(
    'JsonLogFormats',
    'goat: corrupt record between valid records preserves all good data',
    async (ctx) => {
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

  // ── Group 8: Format Fallback ──────────────────────────────────────────────
  TEST(
    'JsonLogFormats',
    'DB falls back from goat to jsonl when configured file missing',
    async (ctx) => {
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
}
