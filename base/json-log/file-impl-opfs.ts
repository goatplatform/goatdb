import * as path from '../path.ts';
import type { DirEntry, FileImpl } from './file-impl-interface.ts';
import { retry, TryAgain } from '../time.ts';

interface FileSystemSyncAccessHandle {
  close(): void;
  getSize(): number;
  flush(): void;
  read(buffer: Uint8Array, opts?: { at?: number }): number;
  truncate(size: number): void;
  write(buffer: Uint8Array, opts?: { at?: number }): number;
}

interface OPFSFile {
  handle: FileSystemFileHandle;
  file: FileSystemSyncAccessHandle;
  pos: number;
}

async function getDir(dirPath: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  dirPath = path.normalize(dirPath);
  const comps = dirPath.split('/');
  let parent = root;
  for (const c of comps) {
    if (c.length === 0) {
      continue;
    }
    parent = await parent.getDirectoryHandle(c, { create: true });
  }
  return parent;
}

async function getDirReadOnly(
  dirPath: string,
): Promise<FileSystemDirectoryHandle | null> {
  const root = await navigator.storage.getDirectory();
  dirPath = path.normalize(dirPath);
  const comps = dirPath.split('/');
  let parent = root;
  for (const c of comps) {
    if (c.length === 0) {
      continue;
    }
    try {
      parent = await parent.getDirectoryHandle(c);
    } catch {
      return null;
    }
  }
  return parent;
}

type SyncHandle = {
  createSyncAccessHandle: () => Promise<FileSystemSyncAccessHandle>;
};

export const FileImplOPFS: FileImpl<OPFSFile> = {
  async open(filePath, write) {
    const dir = await getDir(path.dirname(filePath));
    const handle = await dir.getFileHandle(path.basename(filePath), {
      create: write,
    });

    // For benchmarks and tests that rapidly close and reopen files,
    // we need to handle the race condition where the browser hasn't
    // fully released the OPFS lock from the previous close() call.
    let file: FileSystemSyncAccessHandle;
    try {
      // Try to create the sync access handle directly first
      file = await (handle as unknown as SyncHandle).createSyncAccessHandle();
    } catch (firstError) {
      // If it fails with a locking error, retry with delays
      if (
        firstError instanceof Error &&
        (firstError.message.includes('Access Handles cannot be created') ||
          firstError.message.includes('another open Access Handle') ||
          firstError.message.includes('Writable stream'))
      ) {
        console.warn(`[OPFS] Handle locked for ${filePath}, retrying...`);

        file = await retry(
          async () => {
            try {
              return await (handle as unknown as SyncHandle)
                .createSyncAccessHandle();
            } catch (e) {
              // Only retry if it's still a locking error
              if (
                e instanceof Error &&
                (e.message.includes('Access Handles cannot be created') ||
                  e.message.includes('another open Access Handle') ||
                  e.message.includes('Writable stream'))
              ) {
                throw new TryAgain(e);
              }
              throw e;
            }
          },
          100, // 100ms total timeout - balance between speed and reliability
          10, // 10ms max delay between retries
        );
      } else {
        // Not a locking error, propagate immediately
        throw firstError;
      }
    }

    return {
      handle,
      file,
      pos: 0,
    };
  },

  seek(handle, offset, from) {
    switch (from) {
      case 'current':
        offset += handle.pos;
        break;

      case 'start':
        break;

      case 'end':
        offset = handle.file.getSize() - offset;
        break;
    }
    handle.pos = offset;
    return Promise.resolve(offset);
  },

  read(handle, buf) {
    if (handle.pos >= handle.file.getSize()) {
      return Promise.resolve(null);
    }
    const readLen = handle.file.read(buf, { at: handle.pos });
    handle.pos += readLen;
    return Promise.resolve(readLen);
  },

  truncate(handle, len) {
    len = Math.max(0, len);
    handle.file.truncate(len);
    handle.pos = Math.min(len, handle.pos);
    return Promise.resolve();
  },

  write(handle, buf) {
    let bytesWritten = 0;
    while (bytesWritten < buf.byteLength) {
      const arr = buf.subarray(bytesWritten);
      const len = handle.file.write(arr, { at: handle.pos });
      bytesWritten += len;
      handle.pos += len;
    }
    return Promise.resolve();
  },

  close(handle) {
    handle.file.close();
    return Promise.resolve();
  },

  flush(handle) {
    handle.file.flush();
    return Promise.resolve();
  },

  async remove(targetPath: string): Promise<boolean> {
    try {
      const dir = await getDir(path.dirname(targetPath));
      await dir.removeEntry(path.basename(targetPath), { recursive: true });
      return true;
    } catch (_: unknown) {
      return false;
    }
  },

  getCWD() {
    return '/';
  },

  getTempDir() {
    return Promise.resolve('/temp');
  },

  async mkdir(path: string) {
    await getDir(path);
    return true;
  },

  async exists(filePath: string): Promise<boolean> {
    try {
      const dir = await getDirReadOnly(path.dirname(filePath));
      if (!dir) {
        return false;
      }
      const filename = path.basename(filePath);
      // Try file first, then directory
      try {
        await dir.getFileHandle(filename);
      } catch {
        await dir.getDirectoryHandle(filename);
      }
      return true;
    } catch {
      return false;
    }
  },

  async copyFile(srcPath: string, destPath: string): Promise<void> {
    const MAX_COPY_SIZE = 50 * 1024 * 1024; // 50MB
    const srcHandle = await FileImplOPFS.open(srcPath, false);
    try {
      const size = srcHandle.file.getSize();
      if (size > MAX_COPY_SIZE) {
        throw new Error(
          `File too large for browser copy: ${size} bytes (max ${MAX_COPY_SIZE})`,
        );
      }
      const buffer = new Uint8Array(size);
      await FileImplOPFS.read(srcHandle, buffer);

      const destHandle = await FileImplOPFS.open(destPath, true);
      try {
        await FileImplOPFS.write(destHandle, buffer);
        await FileImplOPFS.truncate(destHandle, size);
      } finally {
        await FileImplOPFS.close(destHandle);
      }
    } finally {
      await FileImplOPFS.close(srcHandle);
    }
  },

  async readDir(dirPath: string): Promise<DirEntry[]> {
    const dir = await getDirReadOnly(dirPath);
    if (!dir) {
      throw new Error(
        `ENOENT: no such file or directory, scandir '${dirPath}'`,
      );
    }
    const entries: DirEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
      entries.push({
        name,
        isFile: handle.kind === 'file',
        isDirectory: handle.kind === 'directory',
      });
    }
    return entries;
  },
};
