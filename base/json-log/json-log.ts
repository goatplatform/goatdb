/**
 * This file implements the JSONLogFile interface using a background worker.
 * All requests are forwarded to the worker, and responses are returned to the
 * caller transparently.
 *
 * This implementation is faster than the one in json-log-functional.ts when
 * prefetching the next scan call (as the main DB class does). It yields ~12%
 * performance improvement.
 *
 * The worker implements an abstraction layer over both Deno's file system
 * operations and the Origin Private File System (OPFS) API, allowing the same
 * code to work seamlessly in both environments.
 */
import { assert } from '../error.ts';
import type { ReadonlyJSONObject } from '../interfaces.ts';
import type {
  WorkerFileReq,
  WorkerFileReqAppend,
  WorkerFileReqClose,
  WorkerFileReqCursor,
  WorkerFileReqFlush,
  WorkerFileReqOpen,
  WorkerFileReqScan,
  WorkerFileResp,
  WorkerFileRespForReq,
  WorkerFileRespScan,
  WorkerReadTextFileReq,
  WorkerRemoveReq,
  WorkerWriteTextFileReq,
} from './json-log-worker-req.ts';

let gWorker: Worker | undefined;

/**
 * Starts the JSON log worker if it hasn't been started yet.
 *
 * In Deno environments, a workerPath must be provided to locate the worker
 * script.
 * In browser environments, the worker script is loaded from
 * /system-assets/json-log-worker.js.
 *
 * The worker handles all JSON log file operations in a background thread to
 * improve performance.
 *
 * @param workerPath Optional URL or string path to the worker script (required
 *                   in Deno)
 * @returns The Worker instance
 */
export function startJSONLogWorkerIfNeeded(workerPath?: URL | string): Worker {
  if (gWorker === undefined) {
    if (self.Deno !== undefined) {
      assert(workerPath !== undefined);
      gWorker = new Worker(
        // new URL('build/json-log-worker.ts', import.meta.url),
        workerPath,
        {
          type: 'module',
        },
      );
    } else {
      gWorker = new Worker('/system-assets/json-log-worker.js', {
        type: 'module',
      });
    }
    gWorker.onmessage = handleResponse;
    gWorker.onerror = (event) => {
      console.error(event.error);
    };
  }
  return gWorker;
}

/**
 * A handle to an open JSON log file. This is an opaque number that uniquely
 * identifies the file within the worker thread.
 *
 * The handle should be used with other JSON log file operations like append,
 * scan, flush and close.
 */
export type JSONLogFile = number;

const gPendingResolveFuncs = new Map<
  number,
  { resolve: (v: WorkerFileResp) => void; reject: (e: Error) => void }
>();
let gReqId = 0;

function sendRequest<T extends WorkerFileReq>(
  req: Omit<T, 'id'>,
): Promise<WorkerFileRespForReq<T>> {
  let resolve!: (v: WorkerFileResp) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<WorkerFileResp>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const id = ++gReqId;
  gPendingResolveFuncs.set(id, {
    resolve,
    reject,
  });
  const worker = startJSONLogWorkerIfNeeded();
  worker.postMessage({
    ...req,
    id,
  });
  return promise as Promise<WorkerFileRespForReq<T>>;
}

function handleResponse(event: MessageEvent<string>): void {
  const resp = JSON.parse(event.data);
  const entry = gPendingResolveFuncs.get(resp.id);
  assert(entry !== undefined, 'Received unknown response from worker');
  gPendingResolveFuncs.delete(resp.id);
  if (resp.type === 'error') {
    entry.reject(new Error(resp.error));
  } else {
    entry.resolve(resp);
  }
}

/**
 * Opens a JSON log file for reading or writing.
 *
 * @param filePath Path to the JSON log file to open
 * @param write Whether to open the file for writing (defaults to
 *              false/read-only)
 * @returns A {@link JSONLogFile} handle that can be used with other operations
 */
export async function JSONLogFileOpen(
  filePath: string,
  write = false,
): Promise<JSONLogFile> {
  return (
    await sendRequest<WorkerFileReqOpen>({
      type: 'open',
      path: filePath,
      write,
    })
  ).file;
}

/**
 * Closes a JSON log file.
 *
 * @param file The {@link JSONLogFile} handle to close
 */
export async function JSONLogFileClose(file: JSONLogFile): Promise<void> {
  await sendRequest<WorkerFileReqClose>({
    type: 'close',
    file,
  });
}

/**
 * A handle to a cursor for a JSON log file. This is an opaque number that
 * uniquely identifies the cursor within the worker thread.
 *
 * The handle should be used with other JSON log file operations like scan,
 * flush and close.
 */
export type JSONLogFileCursor = number;

/**
 * Starts a new cursor for a JSON log file.
 *
 * @param file The {@link JSONLogFile} handle to start a cursor for
 * @returns A {@link JSONLogFileCursor} handle that can be used with other
 *          operations
 */
export async function JSONLogFileStartCursor(
  file: JSONLogFile,
): Promise<JSONLogFileCursor> {
  return (
    await sendRequest<WorkerFileReqCursor>({
      type: 'cursor',
      file,
    })
  ).cursor;
}

/**
 * A result of a JSON log file scan operation.
 *
 * @param results The array of results from the scan operation
 * @param done Whether the scan is complete
 */
export type JSONLogFileScanResult = [
  results: readonly ReadonlyJSONObject[],
  done: boolean,
];
const gPendingScanPromise = new Map<
  JSONLogFileCursor,
  Promise<WorkerFileRespScan>
>();

/**
 * Scans the JSON log file starting from the given cursor.
 *
 * @param cursor The {@link JSONLogFileCursor} handle to start the scan from
 * @returns A promise that resolves to a tuple containing the results of the
 *          scan and whether it is complete
 */
export async function JSONLogFileScan(
  cursor: JSONLogFileCursor,
): Promise<[results: readonly ReadonlyJSONObject[], done: boolean]> {
  let promise = gPendingScanPromise.get(cursor);
  if (!promise) {
    promise = sendRequest<WorkerFileReqScan>({
      type: 'scan',
      cursor,
    });
  }

  const resp = await promise;
  if (!resp.done) {
    gPendingScanPromise.set(
      cursor,
      sendRequest<WorkerFileReqScan>({
        type: 'scan',
        cursor,
      }),
    );
  }
  return [resp.values, resp.done];
}

/**
 * Flushes the JSON log file to disk.
 *
 * @param file The {@link JSONLogFile} handle to flush
 */
export async function JSONLogFileFlush(file: JSONLogFile): Promise<void> {
  await sendRequest<WorkerFileReqFlush>({
    type: 'flush',
    file,
  });
}

/**
 * Appends entries to the JSON log file.
 *
 * @param file The {@link JSONLogFile} handle to append to
 * @param entries Array of JSON objects to append to the file
 */
export async function JSONLogFileAppend(
  file: JSONLogFile,
  entries: readonly ReadonlyJSONObject[],
): Promise<void> {
  await sendRequest<WorkerFileReqAppend>({
    type: 'append',
    file,
    values: entries,
  });
}

/**
 * Reads a text file from disk.
 *
 * @param path Path to the text file to read
 * @returns The contents of the file as a string, or undefined if the file does
 *          not exist
 */
export async function readTextFile(path: string): Promise<string | undefined> {
  return (
    await sendRequest<WorkerReadTextFileReq>({
      type: 'readTextFile',
      path,
    })
  ).text;
}

/**
 * Writes a string to a text file.
 *
 * @param path Path to the text file to write to
 * @param text The string to write to the file
 * @returns A promise that resolves to true if the file was written
 *          successfully, or false if it does not exist
 */
export async function writeTextFile(
  path: string,
  text: string,
): Promise<boolean> {
  return (
    await sendRequest<WorkerWriteTextFileReq>({
      type: 'writeTextFile',
      path,
      text,
    })
  ).success;
}

/**
 * Removes a file from disk.
 *
 * @param path Path to the file to remove
 * @returns A promise that resolves to true if the file was removed
 *          successfully, or false if it does not exist or could not be removed
 */
export async function remove(path: string): Promise<boolean> {
  return (
    await sendRequest<WorkerRemoveReq>({
      type: 'remove',
      path,
    })
  ).success;
}
