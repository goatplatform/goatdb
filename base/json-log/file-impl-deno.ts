import * as path from '../path.ts';
import type { DirEntry, FileImpl } from './file-impl-interface.ts';
import { eisdirError } from './file-impl-errors.ts';

export const FileImplDeno: FileImpl<Deno.FsFile> = {
  async open(filePath, write) {
    await Deno.mkdir(path.dirname(filePath), { recursive: true });
    const file = await Deno.open(filePath, {
      read: true,
      write,
      create: write,
    });
    // A directory must never open as a file. Windows reports a directory's
    // length as 0, so without this guard readFile() returns empty bytes
    // instead of surfacing EISDIR.
    if ((await file.stat()).isDirectory) {
      file.close();
      throw eisdirError(filePath);
    }
    return file;
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
      const len = await handle.write(arr);
      if (len === 0) {
        throw new Error('Deno write stalled: 0 bytes written');
      }
      bytesWritten += len;
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
    return path.parsePath(Deno.cwd());
  },

  async getTempDir() {
    return path.parsePath(await Deno.makeTempDir());
  },

  // Throw on failure like the Node and OPFS impls. Swallowing the error made
  // the contract runtime-dependent and hid the cause from callers.
  async mkdir(path: string) {
    await Deno.mkdir(path, { recursive: true });
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
