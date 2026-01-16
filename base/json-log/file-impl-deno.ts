import * as path from '../path.ts';
import type { DirEntry, FileImpl } from './file-impl-interface.ts';

export const FileImplDeno: FileImpl<Deno.FsFile> = {
  async open(filePath, write) {
    // try {
    await Deno.mkdir(path.dirname(filePath), { recursive: true });
    // } catch (_: unknown) {}
    return Deno.open(filePath, {
      read: true,
      write,
      create: write,
    });
  },

  seek(handle, offset, from) {
    let whence: Deno.SeekMode;
    switch (from) {
      case 'start':
        whence = Deno.SeekMode.Start;
        break;

      case 'current':
        whence = Deno.SeekMode.Current;
        break;

      case 'end':
        whence = Deno.SeekMode.End;
        break;
    }
    return handle.seek(offset, whence);
  },

  read(handle, buf) {
    return handle.read(buf);
  },

  truncate(handle, len) {
    return handle.truncate(len);
  },

  async write(handle, buf) {
    let bytesWritten = 0;
    while (bytesWritten < buf.byteLength) {
      const arr = buf.subarray(bytesWritten);
      bytesWritten += await handle.write(arr);
    }
  },

  close(handle) {
    handle.close();
    return Promise.resolve();
  },

  flush(handle) {
    return handle.sync();
  },

  async remove(path: string): Promise<boolean> {
    try {
      await Deno.remove(path, { recursive: true });
      return true;
    } catch (_: unknown) {
      return false;
    }
  },

  getCWD() {
    return Deno.cwd();
  },

  getTempDir() {
    return Deno.makeTempDir();
  },

  async mkdir(path: string) {
    try {
      await Deno.mkdir(path, { recursive: true });
      return true;
    } catch (_: unknown) {
      return false;
    }
  },

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.lstat(path);
      return true;
    } catch (_: unknown) {
      return false;
    }
  },

  async copyFile(srcPath: string, destPath: string): Promise<void> {
    await Deno.copyFile(srcPath, destPath);
  },

  async readDir(dirPath: string): Promise<DirEntry[]> {
    const entries: DirEntry[] = [];
    for await (const entry of Deno.readDir(dirPath)) {
      entries.push({
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
      });
    }
    return entries;
  },
};
