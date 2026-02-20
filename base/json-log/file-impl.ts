/**
 * This file provides a unified filesystem abstraction layer that works across
 * different JavaScript runtimes.
 *
 * The FileImpl interface defines the core filesystem operations like open,
 * read, write, seek, etc. Concrete implementations are provided for:
 * - Deno via FileImplDeno using Deno.FsFile
 * - Web browsers via FileImplOPFS using the Origin Private File System API
 *
 * Future implementations are planned for:
 * - Node.js using the fs module
 * - Bun using the Bun.file API
 * - React Native using the filesystem API
 *
 * This abstraction provides the minimal filesystem operations needed by
 * GoatDB's storage needs, allowing the database to work consistently across
 * platforms while isolating platform-specific filesystem code into separate
 * modules.
 */
import { getRuntime } from '../runtime/index.ts';
import * as path from '../path.ts';
import type { DirEntry, FileImpl } from './file-impl-interface.ts';

export type { DirEntry } from './file-impl-interface.ts';

let gFileImpl: FileImpl<unknown> | undefined;

/**
 * Returns the appropriate FileImpl implementation for the current runtime
 * environment.
 *
 * Uses the RuntimeAdapter registry to select the correct implementation:
 * - Deno: FileImplDeno using Deno.FsFile
 * - Node.js: FileImplNode using fs.promises.FileHandle
 * - Browser: FileImplOPFS using Origin Private File System API
 *
 * @returns FileImpl<unknown> The filesystem implementation for the current
 *                            runtime
 */
export async function FileImplGet(): Promise<FileImpl<unknown>> {
  if (gFileImpl === undefined) {
    gFileImpl = await getRuntime().createFileImpl();
  }
  return gFileImpl;
}

/**
 * Reads the entire contents of a file into a Uint8Array.
 *
 * @param path The path to the file to read
 * @returns Promise<Uint8Array> The contents of the file as a byte array
 * @throws Will throw an error if the file cannot be opened or read
 */
export async function readFile(path: string): Promise<Uint8Array> {
  const impl = await FileImplGet();
  const handle = await impl.open(path, false);
  try {
    const fileLen = await impl.seek(handle, 0, 'end');
    await impl.seek(handle, 0, 'start');
    const buf = new Uint8Array(fileLen);
    let offset = 0;
    while (offset < fileLen) {
      const n = await impl.read(handle, buf.subarray(offset));
      if (n === null) break;
      if (n === 0) {
        throw new Error(
          `FileImpl.readFile: read() returned 0 at offset ${offset}/${fileLen} — implementation bug`,
        );
      }
      offset += n;
    }
    return buf;
  } finally {
    await impl.close(handle);
  }
}

/**
 * Reads the entire contents of a text file and returns it as a string.
 *
 * This is a convenience wrapper around readFile() that handles decoding the
 * bytes as UTF-8 text. If the file cannot be read for any reason (e.g. does
 * not exist, no permissions), returns undefined instead of throwing an error.
 *
 * @param path The path to the text file to read
 * @returns Promise<string | undefined> The contents of the file as a string, or
 *                                     undefined if the file could not be read
 */
export async function readTextFile(path: string): Promise<string | undefined> {
  try {
    const decoder = new TextDecoder();
    return decoder.decode(await readFile(path));
  } catch (_: unknown) {
    return undefined;
  }
}

/**
 * Writes the contents of a Uint8Array to a file.
 *
 * This will create the file if it does not exist, or overwrite it if it does.
 *
 * @param path The path to the file to write
 * @param buf The bytes to write to the file
 * @returns Promise<void> Resolves when the write is complete
 * @throws Will throw an error if the file cannot be opened or written
 */
export async function writeFile(path: string, buf: Uint8Array): Promise<void> {
  const impl = await FileImplGet();
  const handle = await impl.open(path, true);
  try {
    await impl.write(handle, buf);
    await impl.truncate(handle, buf.length);
  } finally {
    await impl.close(handle);
  }
}

/**
 * Writes a string to a text file.
 *
 * This is a convenience wrapper around writeFile() that handles encoding the
 * string as UTF-8 bytes. If the file cannot be written for any reason (e.g. no
 * permissions, disk full), returns false instead of throwing an error.
 *
 * @param path The path to the text file to write
 * @param text The string contents to write to the file
 * @returns Promise<boolean> True if the write succeeded, false if it failed
 */
export async function writeTextFile(
  path: string,
  text: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    await writeFile(path, encoder.encode(text));
    return true;
  } catch (_: unknown) {
    return false;
  }
}

/**
 * Checks if a file or directory exists at the specified path.
 *
 * @param path The path to check
 * @returns Promise<boolean> True if the path exists, false otherwise
 */
export async function pathExists(path: string): Promise<boolean> {
  const impl = await FileImplGet();
  return impl.exists(path);
}

/**
 * Copies a file from source to destination path.
 *
 * @param srcPath The source file path
 * @param destPath The destination file path
 * @returns Promise<void> Resolves when the copy is complete
 * @throws Will throw an error if the source file doesn't exist or copy fails
 */
export async function copyFile(
  srcPath: string,
  destPath: string,
): Promise<void> {
  const impl = await FileImplGet();
  await impl.copyFile(srcPath, destPath);
}

/**
 * Creates a directory at the specified path.
 * This operation is always recursive.
 *
 * @param path The path where to create the directory
 * @returns Promise<boolean> True if the directory was created, false otherwise
 */
export async function mkdir(path: string): Promise<boolean> {
  const impl = await FileImplGet();
  return impl.mkdir(path);
}

/**
 * Gets the current working directory.
 *
 * @returns The current working directory path
 */
export async function getCWD(): Promise<string> {
  const impl = await FileImplGet();
  return impl.getCWD();
}

/**
 * Reads the contents of a directory.
 *
 * @param dirPath The path to the directory
 * @returns Promise<DirEntry[]> Array of directory entries
 */
export async function readDir(dirPath: string): Promise<DirEntry[]> {
  const impl = await FileImplGet();
  return impl.readDir(dirPath);
}

/**
 * Options for walkDir.
 */
export interface WalkOptions {
  /** Include directories in the output (default: false) */
  includeDirs?: boolean;
  /** Maximum depth to recurse (undefined = unlimited) */
  maxDepth?: number;
}

/**
 * Recursively walks a directory tree and yields file paths.
 *
 * @param dir The directory to walk
 * @param options Walk options
 * @yields Absolute file paths
 */
export async function* walkDir(
  dir: string,
  options?: WalkOptions,
): AsyncGenerator<string> {
  const impl = await FileImplGet();
  yield* walkDirImpl(
    impl,
    dir,
    options?.includeDirs ?? false,
    options?.maxDepth,
    0,
  );
}

async function* walkDirImpl(
  impl: FileImpl<unknown>,
  dir: string,
  includeDirs: boolean,
  maxDepth: number | undefined,
  currentDepth: number,
): AsyncGenerator<string> {
  const entries = await impl.readDir(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory) {
      if (includeDirs) {
        yield fullPath;
      }
      if (maxDepth === undefined || currentDepth < maxDepth) {
        yield* walkDirImpl(
          impl,
          fullPath,
          includeDirs,
          maxDepth,
          currentDepth + 1,
        );
      }
    } else if (entry.isFile) {
      yield fullPath;
    }
  }
}
