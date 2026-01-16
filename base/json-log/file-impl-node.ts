import * as path from '../path.ts';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { DirEntry, FileImpl } from './file-impl-interface.ts';

interface NodeFsFile {
  file: fs.FileHandle;
  pos: number;
}

export const FileImplNode: FileImpl<NodeFsFile> = {
  async open(filePath, write) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (write) {
      try {
        return {
          file: await fs.open(filePath, 'r+'),
          pos: 0,
        };
      } catch (_: unknown) {
        return {
          file: await fs.open(filePath, 'w+'),
          pos: 0,
        };
      }
    }
    return {
      file: await fs.open(filePath, 'r'),
      pos: 0,
    };
  },

  async seek(handle, offset, from) {
    switch (from) {
      case 'current':
        offset += handle.pos;
        break;

      case 'start':
        break;

      case 'end':
        offset = (await handle.file.stat()).size - offset;
        break;
    }
    handle.pos = offset;
    return offset;
  },

  async read(handle, buf) {
    const fileLength = (await handle.file.stat()).size;
    if (handle.pos >= fileLength) {
      return Promise.resolve(null);
    }
    const result = await handle.file.read(buf, 0, buf.byteLength, handle.pos);
    handle.pos += result.bytesRead;
    return result.bytesRead;
  },

  async truncate(handle, len) {
    len = Math.max(0, len);
    await handle.file.truncate(len);
    handle.pos = Math.min(len, handle.pos);
  },

  async write(handle, buf) {
    let bytesWritten = 0;
    while (bytesWritten < buf.byteLength) {
      const result = await handle.file.write(
        buf,
        bytesWritten,
        buf.length - bytesWritten,
        handle.pos,
      );
      bytesWritten += result.bytesWritten;
      handle.pos += result.bytesWritten;
    }
  },

  close(handle) {
    handle.file.close();
    return Promise.resolve();
  },

  async flush(handle) {
    await handle.file.sync();
    return Promise.resolve();
  },

  async remove(targetPath: string): Promise<boolean> {
    try {
      await fs.rm(targetPath, { recursive: true });
      return true;
    } catch (_: unknown) {
      return false;
    }
  },

  getCWD() {
    return process.cwd();
  },

  getTempDir() {
    return Promise.resolve(path.join(os.tmpdir(), 'goatdb'));
  },

  async mkdir(path: string) {
    await fs.mkdir(path, { recursive: true });
    return true;
  },

  async exists(path: string): Promise<boolean> {
    try {
      await fs.lstat(path);
      return true;
    } catch (_: unknown) {
      return false;
    }
  },

  async copyFile(srcPath: string, destPath: string): Promise<void> {
    await fs.copyFile(srcPath, destPath);
  },

  async readDir(dirPath: string): Promise<DirEntry[]> {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    return dirents.map((d) => ({
      name: d.name,
      isFile: d.isFile(),
      isDirectory: d.isDirectory(),
    }));
  },
};
