import type { ReadonlyJSONObject } from '../interfaces.ts';

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
 * @param values Array of JSON objects to append to the file
 * @param id Request ID used to match requests with responses
 */
export type WorkerFileReqAppend = {
  type: 'append';
  id: number;
  file: number;
  values: readonly ReadonlyJSONObject[];
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
  | WorkerRemoveReq;

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
  values: readonly ReadonlyJSONObject[];
  done: boolean;
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
 * A type representing an error that occurred during an operation on a JSON log
 * file.
 *
 * @param id Request ID used to match requests with responses
 * @param error The type of error that occurred
 */
export type WorkerErrorType = 'UnknownCommand';

export type WorkerErrorResp = {
  type: 'error';
  id: number;
  error: WorkerErrorType;
};

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
    : T['type'] extends 'error' ? WorkerErrorResp
    : WorkerFileResp;
