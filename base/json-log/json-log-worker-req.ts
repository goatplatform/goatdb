import type { DirEntry } from './file-impl-interface.ts';

/** Strict file operations run in the worker, where OPFS sync handles exist. */
export type WorkerReadFileReq = {
  type: 'readFile';
  id: number;
  path: string;
};
export type WorkerWriteFileReq = {
  type: 'writeFile';
  id: number;
  path: string;
  bytes: Uint8Array;
};
export type WorkerMkdirReq = { type: 'mkdir'; id: number; path: string };
export type WorkerReadDirReq = { type: 'readDir'; id: number; path: string };

export type WorkerReadFileResp = {
  type: 'readFile';
  id: number;
  bytes: Uint8Array;
};
export type WorkerWriteFileResp = { type: 'writeFile'; id: number };
export type WorkerMkdirResp = { type: 'mkdir'; id: number };
export type WorkerReadDirResp = {
  type: 'readDir';
  id: number;
  entries: DirEntry[];
};

/**
 * A request to open a JSON log file.
 *
 * @param path The path to the JSON log file to open
 * @param write Whether to open the file for writing (defaults to false/read-only)
 */
export type WorkerFileReqOpen = {
  type: 'open';
  id: number;
  path: string;
  write?: boolean;
};

/**
 * A request to close a JSON log file.
 *
 * @param file The file handle to close
 */
export type WorkerFileReqClose = {
  type: 'close';
  id: number;
  file: number;
};

/**
 * A request to create a cursor for a JSON log file.
 *
 * @param file The file handle to create a cursor for
 */
export type WorkerFileReqCursor = {
  type: 'cursor';
  id: number;
  file: number;
};

/**
 * A request to scan a JSON log file.
 *
 * @param cursor The cursor to start scanning from
 */
export type WorkerFileReqScan = {
  type: 'scan';
  id: number;
  cursor: number;
};

/**
 * A request to flush a JSON log file to disk by first flushing any internal
 * buffers and then calling the underlying OS file sync. This ensures all
 * buffered writes, both in the application and OS, are persisted to stable
 * storage.
 *
 * @param file The file handle to flush
 */
export type WorkerFileReqFlush = {
  type: 'flush';
  id: number;
  file: number;
};

/**
 * A request to append entries to a JSON log file.
 *
 * @param file The file handle to append to
 * @param values Array of encoded entries to append to the file
 * @param id Request ID used to match requests with responses
 */
export type WorkerFileReqAppend = {
  type: 'append';
  id: number;
  file: number;
  values: readonly Uint8Array[];
  /**
   * Optional pre-extracted IDs corresponding 1:1 to `values`. When provided,
   * the worker skips decoding each entry just to read its `id` field for
   * deduplication — a significant speedup for large appends.
   */
  ids?: readonly string[];
};

/**
 * A request to read a text file from disk.
 *
 * @param path Path to the text file to read
 * @param id Request ID used to match requests with responses
 */
export type WorkerReadTextFileReq = {
  type: 'readTextFile';
  id: number;
  path: string;
};

/**
 * A request to write a string to a text file.
 *
 * @param path Path to the text file to write to
 * @param text The string to write to the file
 * @param id Request ID used to match requests with responses
 */
export type WorkerWriteTextFileReq = {
  type: 'writeTextFile';
  id: number;
  path: string;
  text: string;
};

/**
 * A request to remove a file from disk.
 *
 * @param path Path to the file to remove
 */
export type WorkerRemoveReq = {
  type: 'remove';
  id: number;
  path: string;
};

/**
 * A request to perform an operation on a JSON log file.
 *
 * @param type The type of operation to perform
 * @param id Request ID used to match requests with responses
 */
export type WorkerFileReq =
  | WorkerFileReqOpen
  | WorkerFileReqClose
  | WorkerFileReqCursor
  | WorkerFileReqScan
  | WorkerFileReqFlush
  | WorkerFileReqAppend
  | WorkerReadTextFileReq
  | WorkerWriteTextFileReq
  | WorkerRemoveReq
  | WorkerReadFileReq
  | WorkerWriteFileReq
  | WorkerMkdirReq
  | WorkerReadDirReq;

/**
 * A response to a request to open a JSON log file.
 *
 * @param id Request ID used to match requests with responses
 * @param file The file handle to the opened file
 */
export type WorkerFileRespOpen = {
  type: 'open';
  id: number;
  file: number;
};

/**
 * A response to a request to close a JSON log file.
 *
 * @param id Request ID used to match requests with responses
 * @param file The file handle to the closed file
 */
export type WorkerFileRespClose = {
  type: 'close';
  id: number;
  file: number;
};

/**
 * A response to a request to create a cursor for a JSON log file.
 *
 * @param id Request ID used to match requests with responses
 * @param cursor The cursor to the created file
 */
export type WorkerFileRespCursor = {
  type: 'cursor';
  id: number;
  cursor: number;
};

/**
 * A response to a request to scan a JSON log file.
 *
 * @param id Request ID used to match requests with responses
 * @param cursor The cursor to the scanned file
 */
export type WorkerFileRespScan = {
  type: 'scan';
  id: number;
  cursor: number;
  done: boolean;
  // JSONL format: individual buffers
  values?: readonly Uint8Array[];
  // Binary (.goat) format: single contiguous buffer + offset/length pairs
  buffer?: Uint8Array;
  offsets?: Uint32Array;
};

/**
 * A response to a request to flush a JSON log file to disk.
 *
 * @param id Request ID used to match requests with responses
 * @param file The file handle to the flushed file
 */
export type WorkerFileRespFlush = {
  type: 'flush';
  id: number;
  file: number;
};

/**
 * A response to a request to append entries to a JSON log file.
 *
 * @param id Request ID used to match requests with responses
 * @param success Whether the append operation was successful
 */
export type WorkerFileRespAppend = {
  type: 'append';
  id: number;
};

/**
 * A response to a request to read a text file from disk.
 *
 * @param id Request ID used to match requests with responses
 * @param text The contents of the file as a string, or undefined if the file does not exist
 */
export type WorkerReadTextFileResp = {
  type: 'readTextFile';
  id: number;
  text: string | undefined;
};

/**
 * A response to a request to write a string to a text file.
 *
 * @param id Request ID used to match requests with responses
 * @param success Whether the write operation was successful
 */
export type WorkerWriteTextFileResp = {
  type: 'writeTextFile';
  id: number;
  success: boolean;
};

/**
 * A response to a request to remove a file from disk.
 *
 * @param id Request ID used to match requests with responses
 * @param success Whether the remove operation was successful
 */
export type WorkerRemoveResp = {
  type: 'remove';
  id: number;
  success: boolean;
};

/**
 * A log entry relayed from the worker to the main thread. Kept minimal to
 * avoid importing from logging/ and to keep the structured-clone payload small.
 */
export type WorkerLogRelay = {
  severity: string;
  error?: string;
  message?: string;
};

/**
 * A type representing an error that occurred during an operation on a JSON log
 * file.
 *
 * @param id Request ID used to match requests with responses
 * @param error The type of error that occurred
 */
export type WorkerErrorType =
  | 'UnknownCommand'
  | 'FileClosed'
  | 'AppendFailed'
  | 'InternalError';

export type WorkerErrorResp = {
  type: 'error';
  id: number;
  error: WorkerErrorType;
  // Explicit fields preserve filesystem codes and DOMException names on clone.
  details?: { message: string; name: string; code?: string | number };
};

/** Unknown-worker-command details. Shared so the worker and tests agree. */
export function unknownCommandDetails(type: string): {
  name: string;
  message: string;
} {
  // WHY: include the command so a stale worker bundle (one that predates a
  // request type) is diagnosable instead of an opaque "UnknownCommand".
  return { name: 'Error', message: `Unknown worker command: ${type}` };
}

export type WorkerFileResp =
  | WorkerFileRespOpen
  | WorkerFileRespClose
  | WorkerFileRespCursor
  | WorkerFileRespScan
  | WorkerFileRespFlush
  | WorkerFileRespAppend
  | WorkerReadTextFileResp
  | WorkerWriteTextFileResp
  | WorkerRemoveResp
  | WorkerReadFileResp
  | WorkerWriteFileResp
  | WorkerMkdirResp
  | WorkerReadDirResp
  | WorkerErrorResp;

export type WorkerFileRespForReq<T extends WorkerFileReq = WorkerFileReq> =
  T['type'] extends 'open' ? WorkerFileRespOpen
    : T['type'] extends 'close' ? WorkerFileRespClose
    : T['type'] extends 'cursor' ? WorkerFileRespCursor
    : T['type'] extends 'scan' ? WorkerFileRespScan
    : T['type'] extends 'flush' ? WorkerFileRespFlush
    : T['type'] extends 'append' ? WorkerFileRespAppend
    : T['type'] extends 'readTextFile' ? WorkerReadTextFileResp
    : T['type'] extends 'writeTextFile' ? WorkerWriteTextFileResp
    : T['type'] extends 'remove' ? WorkerRemoveResp
    : T['type'] extends 'readFile' ? WorkerReadFileResp
    : T['type'] extends 'writeFile' ? WorkerWriteFileResp
    : T['type'] extends 'mkdir' ? WorkerMkdirResp
    : T['type'] extends 'readDir' ? WorkerReadDirResp
    : T['type'] extends 'error' ? WorkerErrorResp
    : WorkerFileResp;
