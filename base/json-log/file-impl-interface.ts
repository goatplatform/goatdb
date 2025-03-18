/**
 * Represents the reference point for file seeking operations.
 * - 'current': Seek relative to the current position
 * - 'start': Seek relative to the beginning of the file
 * - 'end': Seek relative to the end of the file
 */
export type SeekFrom = 'current' | 'start' | 'end';

/**
 * FileImpl is an abstract interface that maps to the underlying environment's
 * file system API. It provides a unified way to interact with files across
 * different JavaScript runtimes (Deno, browsers, Node.js, etc.) by abstracting
 * away platform-specific implementation details.
 *
 * This interface is specifically designed for GoatDB's storage needs rather
 * than being a general-purpose filesystem abstraction. It provides only the
 * minimal set of operations required by GoatDB's persistence layer, focusing on
 * the core file operations needed for the database.
 *
 * The generic type parameter T represents the platform-specific file handle type.
 */
export interface FileImpl<T> {
  /**
   * Opens a file at the specified path.
   * @param path The path to the file
   * @param write Whether to open the file for writing
   * @returns A promise that resolves to a platform-specific file handle
   */
  open(path: string, write: boolean): Promise<T>;

  /**
   * Moves the file cursor to a new position.
   * @param handle The file handle
   * @param offset The number of bytes to move
   * @param from The reference point for the offset
   * @returns A promise that resolves to the new cursor position
   */
  seek(handle: T, offset: number, from: SeekFrom): Promise<number>;

  /**
   * Reads data from the file into the provided buffer.
   * @param handle The file handle
   * @param buf The buffer to read into
   * @returns A promise that resolves to the number of bytes read, or null at EOF
   */
  read(handle: T, buf: Uint8Array): Promise<number | null>;

  /**
   * Truncates a file to the specified length.
   * @param handle The file handle
   * @param len The new length of the file
   */
  truncate(handle: T, len: number): Promise<void>;

  /**
   * Writes data from the provided buffer to the file.
   * @param handle The file handle
   * @param buf The buffer containing data to write
   */
  write(handle: T, buf: Uint8Array): Promise<void>;

  /**
   * Closes the file handle.
   * @param handle The file handle to close
   */
  close(handle: T): Promise<void>;

  /**
   * Ensures all data has been written to the underlying storage.
   * @param handle The file handle
   */
  flush(handle: T): Promise<void>;

  /**
   * Removes a file at the specified path.
   * @param path The path to the file
   * @returns A promise that resolves to true if the file was removed, false otherwise
   */
  remove(path: string): Promise<boolean>;

  /**
   * Gets the current working directory.
   * @returns The current working directory path
   */
  getCWD(): string;

  /**
   * Gets the path to a temporary directory.
   * @returns The path to a temporary directory
   */
  getTempDir(): Promise<string>;

  /**
   * Creates a directory at the specified path.
   * This operation is always recursive, meaning it will create any intermediate
   * directories in the path that don't exist. For example, if creating
   * "/a/b/c" and "/a" exists but "/a/b" doesn't, this will create both "/a/b"
   * and "/a/b/c" directories.
   *
   * @param path The path where to create the directory
   * @returns A promise that resolves to true if the directory was created,
   *          false otherwise
   */
  mkdir(path: string): Promise<boolean>;
}
