/**
 * Tests for the FileImpl abstraction layer.
 *
 * Verifies that file operations (open, read, write, seek, truncate, remove,
 * copy, mkdir) work correctly on both Deno and Node.js runtimes.
 * Browser (OPFS) has separate coverage and is skipped here.
 */

import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { FileImplGet, readFile } from '../base/json-log/file-impl.ts';
import { isBrowser } from '../base/common.ts';

export default function setupFileImplTests() {
  TEST('FileImpl', 'open write read round-trip', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-roundtrip');
    const impl = await FileImplGet();
    const filePath = path.join(dir, 'test.bin');
    const data = new TextEncoder().encode('hello world');
    const handle = await impl.open(filePath, true);
    try {
      await impl.write(handle, data);
      const seekPos = await impl.seek(handle, 0, 'start');
      assertEquals(seekPos, 0, 'seek to start should return 0');
      const buf = new Uint8Array(data.length);
      let offset = 0;
      while (offset < buf.length) {
        const n = await impl.read(handle, buf.subarray(offset));
        if (n === null) break;
        offset += n;
      }
      assertEquals(
        new TextDecoder().decode(buf),
        'hello world',
        'read-back content must match written data',
      );
    } finally {
      await impl.close(handle);
    }
  });

  TEST('FileImpl', 'seek from end returns file size', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-seek-end');
    const impl = await FileImplGet();
    const filePath = path.join(dir, 'test.bin');
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const handle = await impl.open(filePath, true);
    try {
      await impl.write(handle, data);
      const size = await impl.seek(handle, 0, 'end');
      assertEquals(size, data.length, 'seek from end should return file size');
    } finally {
      await impl.close(handle);
    }
  });

  TEST('FileImpl', 'truncate shortens file', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-truncate');
    const impl = await FileImplGet();
    const filePath = path.join(dir, 'test.bin');
    const data = new TextEncoder().encode('0123456789');
    const handle = await impl.open(filePath, true);
    try {
      await impl.write(handle, data);
      await impl.truncate(handle, 5);
      const size = await impl.seek(handle, 0, 'end');
      assertEquals(size, 5, 'size after truncate should be 5');
      await impl.seek(handle, 0, 'start');
      const buf = new Uint8Array(5);
      await impl.read(handle, buf);
      assertEquals(
        new TextDecoder().decode(buf),
        '01234',
        'truncated content should match first 5 bytes',
      );
    } finally {
      await impl.close(handle);
    }
  });

  TEST('FileImpl', 'write large buffer completes fully', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-large');
    const impl = await FileImplGet();
    const filePath = path.join(dir, 'large.bin');
    const large = new Uint8Array(64 * 1024);
    for (let i = 0; i < large.length; i++) {
      large[i] = i & 0xff;
    }
    const handle = await impl.open(filePath, true);
    try {
      await impl.write(handle, large);
      const size = await impl.seek(handle, 0, 'end');
      assertEquals(size, large.length, '64KB write should produce 64KB file');
    } finally {
      await impl.close(handle);
    }
    // readFile() uses its internal partial-read loop; this verifies both the
    // write path and that readFile() reassembles the full buffer correctly.
    const buf = await readFile(filePath);
    assertEquals(buf.length, large.length, '64KB read-back should return full buffer');
    assertEquals(buf[0], 0, 'first byte should match');
    assertEquals(buf[255], 255, 'byte at index 255 should match');
    assertEquals(buf[large.length - 1], (large.length - 1) & 0xff, 'last byte should match');
  });

  TEST('FileImpl', 'flush does not throw', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-flush');
    const impl = await FileImplGet();
    const filePath = path.join(dir, 'flush.bin');
    const handle = await impl.open(filePath, true);
    try {
      await impl.write(handle, new TextEncoder().encode('data'));
      // Intentionally shallow: flush() is a best-effort fsync hint; we only
      // verify it does not throw, since durability guarantees are OS-specific.
      await impl.flush(handle);
    } finally {
      await impl.close(handle);
    }
  });

  TEST('FileImpl', 'read returns null at EOF', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-eof');
    const impl = await FileImplGet();
    const filePath = path.join(dir, 'eof.bin');
    const data = new TextEncoder().encode('hi');
    const handle = await impl.open(filePath, true);
    try {
      await impl.write(handle, data);
      // Seek to end (EOF position)
      await impl.seek(handle, 0, 'end');
      const result = await impl.read(handle, new Uint8Array(4));
      assertEquals(result, null, 'read at EOF should return null');
    } finally {
      await impl.close(handle);
    }
  });

  TEST('FileImpl', 'remove file returns true then false', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-remove-file');
    const impl = await FileImplGet();
    const filePath = path.join(dir, 'removeme.bin');
    const handle = await impl.open(filePath, true);
    try {
      await impl.write(handle, new TextEncoder().encode('bye'));
    } finally {
      await impl.close(handle);
    }

    const first = await impl.remove(filePath);
    assertTrue(first, 'first remove should return true');
    const second = await impl.remove(filePath);
    assertTrue(!second, 'second remove should return false');
    const exists = await impl.exists(filePath);
    assertTrue(!exists, 'file should not exist after removal');
  });

  TEST('FileImpl', 'remove non-empty subdirectory recursively', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-remove-dir');
    const impl = await FileImplGet();
    const nested = path.join(dir, 'sub', 'deep');
    await impl.mkdir(nested);
    const filePath = path.join(nested, 'data.txt');
    const handle = await impl.open(filePath, true);
    try {
      await impl.write(handle, new TextEncoder().encode('content'));
    } finally {
      await impl.close(handle);
    }

    const subDir = path.join(dir, 'sub');
    const removed = await impl.remove(subDir);
    assertTrue(removed, 'remove should succeed for non-empty directory');
    const exists = await impl.exists(subDir);
    assertTrue(!exists, 'directory should not exist after removal');
  });

  TEST('FileImpl', 'copyFile produces identical content', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-copy');
    const impl = await FileImplGet();
    const srcPath = path.join(dir, 'src.bin');
    const dstPath = path.join(dir, 'dst.bin');
    const data = new TextEncoder().encode('copy me');
    const handle = await impl.open(srcPath, true);
    try {
      await impl.write(handle, data);
    } finally {
      await impl.close(handle);
    }

    await impl.copyFile(srcPath, dstPath);

    const buf = await readFile(dstPath);
    assertEquals(buf.length, data.length, 'copied file size should match source');
    assertEquals(
      new TextDecoder().decode(buf),
      'copy me',
      'copied content should match source',
    );
  });

  TEST('FileImpl', 'readDir lists directory entries', async (ctx) => {
    if (isBrowser()) return;
    const dir = await ctx.tempDir('file-impl-readdir');
    const impl = await FileImplGet();
    for (const name of ['a.txt', 'b.txt']) {
      const h = await impl.open(path.join(dir, name), true);
      try {
        await impl.write(h, new TextEncoder().encode(name));
      } finally {
        await impl.close(h);
      }
    }
    const entries = await impl.readDir(dir);
    assertEquals(entries.length, 2, 'should list 2 entries');
    const names = entries.map((e) => e.name).sort();
    assertEquals(names, ['a.txt', 'b.txt'], 'entry names should match');
  });
}
