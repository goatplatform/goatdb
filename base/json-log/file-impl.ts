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
import { FileImplDeno } from './file-impl-deno.ts';
import type { FileImpl } from './file-impl-interface.ts';
import { FileImplOPFS } from './file-impl-opfs.ts';

/**
 * Returns the appropriate FileImpl implementation for the current runtime
 * environment.
 *
 * In Deno, returns FileImplDeno which uses Deno.FsFile.
 * In web browsers, returns FileImplOPFS which uses the Origin Private File
 * System API.
 *
 * @returns FileImpl<unknown> The filesystem implementation for the current
 *                            runtime
 */
export function FileImplGet(): FileImpl<unknown> {
  return self.Deno === undefined ? FileImplOPFS : FileImplDeno;
}

/**
 * Reads the entire contents of a file into a Uint8Array.
 *
 * @param path The path to the file to read
 * @returns Promise<Uint8Array> The contents of the file as a byte array
 * @throws Will throw an error if the file cannot be opened or read
 */
export async function readFile(path: string): Promise<Uint8Array> {
  const impl = FileImplGet();
  const handle = await impl.open(path, false);
  const fileLen = await impl.seek(handle, 0, 'end');
  await impl.seek(handle, 0, 'start');
  const buf = new Uint8Array(fileLen);
  await impl.read(handle, buf);
  await impl.close(handle);
  return buf;
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
  const impl = FileImplGet();
  const handle = await impl.open(path, true);
  await impl.write(handle, buf);
  await impl.truncate(handle, buf.length);
  await impl.close(handle);
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
