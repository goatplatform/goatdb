/**
 * This file implements a background worker for the JSONLogFile interface in
 * json-log-background.ts
 */
import { assert } from '../error.ts';
import type { ReadonlyJSONObject } from '../interfaces.ts';
import type {
  WorkerErrorResp,
  WorkerFileReq,
  WorkerFileRespAppend,
  WorkerFileRespClose,
  WorkerFileRespCursor,
  WorkerFileRespFlush,
  WorkerFileRespOpen,
  WorkerFileRespScan,
  WorkerReadTextFileResp,
  WorkerRemoveResp,
  WorkerWriteTextFileResp,
} from './json-log-worker-req.ts';
import type { FileImpl } from './file-impl-interface.ts';
import { FileImplGet, readTextFile, writeTextFile } from './file-impl.ts';
import { isNode } from '../common.ts';

const FILE_READ_BUF_SIZE_BYTES = 1024 * 1024; // 8KB
const PAGE_SIZE = 1024;
const LINE_DELIMITER_BYTE = 10; // "\n"

const textDecoder = new TextDecoder();

interface JSONLogFile {
  readonly path: string;
  readonly write: boolean;
  readonly impl: FileImpl<unknown>;
  readonly knownIds: Set<string>;
  handle: unknown;
  didScan?: true;
  pendingWrites: ReadonlyJSONObject[];
  writePromise?: Promise<void>;
}

async function JSONLogFileOpen(
  path: string,
  write = false,
): Promise<JSONLogFile> {
  const impl = await FileImplGet();
  return {
    path,
    write: write === true,
    impl,
    handle: await impl.open(path, write),
    pendingWrites: [],
    knownIds: new Set(),
  };
}

function JSONLogFileClose(file: JSONLogFile): Promise<void> {
  return file.impl.close(file.handle);
}

interface JSONLogFileCursor {
  readonly file: JSONLogFile;
  readonly totalFileBytes: number;
  fileOffset: number;
  readBuf: Uint8Array;
  readBufLen: number;
  readBufStart: number;
  readBufEnd: number;
  lastGoodFileOffset: number;
  objectBuf: Uint8Array;
  objectBufOffset: number;
}

async function JSONLogFileStartCursor(
  file: JSONLogFile,
): Promise<JSONLogFileCursor> {
  const totalFileBytes = await file.impl.seek(file.handle, 0, 'end');
  await file.impl.seek(file.handle, 0, 'start');
  return {
    file,
    totalFileBytes,
    fileOffset: 0,
    readBuf: new Uint8Array(FILE_READ_BUF_SIZE_BYTES),
    readBufLen: 0,
    readBufStart: 0,
    readBufEnd: 0,
    lastGoodFileOffset: 0,
    objectBuf: new Uint8Array(PAGE_SIZE),
    objectBufOffset: 0,
  };
}

type ScanResult = [results: readonly ReadonlyJSONObject[], done: boolean];
async function JSONLogFileScan(cursor: JSONLogFileCursor): Promise<ScanResult> {
  const pendingObjects: ReadonlyJSONObject[] = [];
  while (pendingObjects.length <= 100) {
    while (cursor.readBufLen <= 0) {
      const bytesRead = await cursor.file.impl.read(
        cursor.file.handle,
        cursor.readBuf,
      );
      // next read()
      if (bytesRead === null) {
        if (cursor.objectBufOffset > 0 && cursor.file.write) {
          await cursor.file.impl.seek(cursor.file.handle, 0, 'end');
          await cursor.file.impl.truncate(
            cursor.file.handle,
            cursor.lastGoodFileOffset,
          );
        }
        cursor.file.didScan = true; // Ensure this flag is set correctly
        return [pendingObjects, true];
      }
      cursor.readBufLen = bytesRead;
    }
    while (cursor.readBufStart < cursor.readBufLen) {
      cursor.readBufEnd = cursor.readBufStart;
      while (
        cursor.readBufEnd < cursor.readBufLen &&
        cursor.readBuf[cursor.readBufEnd] !== LINE_DELIMITER_BYTE
      ) {
        ++cursor.readBufEnd;
      }
      const readLen = cursor.readBufEnd - cursor.readBufStart;
      if (readLen > 0) {
        cursor.fileOffset += readLen;
        cursor.objectBuf = appendBytes(
          cursor.readBuf,
          cursor.readBufStart,
          readLen,
          cursor.objectBuf,
          cursor.objectBufOffset,
        );
        cursor.objectBufOffset += readLen;
        // if (progressCallback) {
        //   progressCallback(fileOffset / totalFileBytes);
        // }
      }
      cursor.readBufStart = cursor.readBufEnd + 1;
      if (
        cursor.readBuf[cursor.readBufEnd] === LINE_DELIMITER_BYTE &&
        cursor.objectBufOffset > 0
      ) {
        try {
          const text = textDecoder.decode(
            cursor.objectBuf.subarray(0, cursor.objectBufOffset),
          );
          pendingObjects.push(JSON.parse(text));
          cursor.lastGoodFileOffset += cursor.objectBufOffset + 1; // +1 for newline character
          cursor.objectBufOffset = 0;
          // if (pendingObjects.length > 20000) {
          //   break;
          // }
        } catch (_: unknown) {
          if (cursor.file.write) {
            await cursor.file.impl.seek(cursor.file.handle, 0, 'end');
            await cursor.file.impl.truncate(
              cursor.file.handle,
              cursor.lastGoodFileOffset,
            );
          }
          cursor.file.didScan = true;
          for (const o of pendingObjects) {
            if (typeof o.id === 'string') {
              cursor.file.knownIds.add(o.id);
            }
          }
          return [pendingObjects, true];
        }
      }
    }
    if (cursor.readBufStart >= cursor.readBufLen) {
      cursor.readBufLen = 0;
      cursor.readBufStart = 0;
      cursor.readBufEnd = 0;
    }
  }

  for (const o of pendingObjects) {
    if (typeof o.id === 'string') {
      cursor.file.knownIds.add(o.id);
    }
  }
  return [pendingObjects, false];
  // cacheBufferForReuse(objectBuf);
}

function JSONLogFileFlush(file: JSONLogFile): Promise<void> {
  return file.impl.flush(file.handle);
}

function appendBytes(
  src: Uint8Array,
  srcOffset: number,
  srcLen: number,
  dst: Uint8Array,
  dstOffset: number,
): Uint8Array {
  if (dstOffset + srcLen > dst.byteLength) {
    const newDst = new Uint8Array(
      Math.ceil(((dstOffset + srcLen) * 2) / PAGE_SIZE) * PAGE_SIZE,
    );
    newDst.set(dst);
    // cacheBufferForReuse(dst);
    dst = newDst;
  }
  dst.set(src.subarray(srcOffset, srcOffset + srcLen), dstOffset);
  return dst;
}

async function JSONLogFileAppend(
  file: JSONLogFile,
  entries: readonly ReadonlyJSONObject[],
): Promise<void> {
  assert(file.write, 'Attempting to write to a readonly log');
  // Hack: Wind the log to the end so any broken tail will be chopped off.
  // TODO: Read the file in reverse and apply truncate if needed.
  if (!file.didScan) {
    const cursor = await JSONLogFileStartCursor(file);
    while (!(await JSONLogFileScan(cursor))[1]) {
      // Wind the log file to the end
    }
  }
  // assert(
  //   file.didScan === true,
  //   'Attempting to append to log before initial scan completed',
  // );
  const filteredEntries: ReadonlyJSONObject[] = [];
  for (const e of entries) {
    if (typeof e.id === 'string' && !file.knownIds.has(e.id)) {
      file.knownIds.add(e.id);
      filteredEntries.push(e);
    }
  }
  const encodedEntries = '\n' +
    filteredEntries.map((obj) => JSON.stringify(obj)).join('\n\n') +
    '\n';
  const encodedBuf = new TextEncoder().encode(encodedEntries);
  await file.impl.seek(file.handle, 0, 'end');
  await file.impl.write(file.handle, encodedBuf);
}

const gOpenFiles = new Map<number, JSONLogFile>();
let gFileHandleNum = 0;
const gOpenCursors = new Map<
  number,
  { cursor: JSONLogFileCursor; nextPromise?: Promise<ScanResult> }
>();
let gOpenCursorNum = 0;

type PostMessageFunc = (message: string) => void;

let gPostMessage: PostMessageFunc | undefined;

async function handleRequest(
  event: MessageEvent<WorkerFileReq> | WorkerFileReq,
): Promise<void> {
  const req = isNode()
    ? (event as WorkerFileReq)
    : (event as MessageEvent<WorkerFileReq>).data;
  switch (req.type) {
    case 'open': {
      const handle = ++gFileHandleNum;
      const file = await JSONLogFileOpen(req.path, req.write);
      gOpenFiles.set(handle, file);
      const resp: WorkerFileRespOpen = {
        type: 'open',
        id: req.id,
        file: handle,
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }

    case 'close': {
      const file = gOpenFiles.get(req.file);
      if (file) {
        gOpenFiles.delete(req.file);
        await JSONLogFileClose(file);
      }
      const resp: WorkerFileRespClose = {
        type: 'close',
        id: req.id,
        file: req.file,
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }

    case 'cursor': {
      const file = gOpenFiles.get(req.file);
      if (file === undefined) {
        // File was closed, send error response instead of asserting
        const resp: WorkerErrorResp = {
          type: 'error',
          id: req.id,
          error: 'FileClosed',
        };
        gPostMessage!(JSON.stringify(resp));
        break;
      }
      const cursor = await JSONLogFileStartCursor(file);
      const cursorId = ++gOpenCursorNum;
      const nextPromise = JSONLogFileScan(cursor);
      gOpenCursors.set(cursorId, { cursor, nextPromise });
      const resp: WorkerFileRespCursor = {
        type: 'cursor',
        id: req.id,
        cursor: cursorId,
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }

    case 'scan': {
      const entry = gOpenCursors.get(req.cursor);
      assert(entry !== undefined, 'Cursor not found');
      if (!entry.nextPromise) {
        entry.nextPromise = JSONLogFileScan(entry.cursor);
      }
      const [values, done] = await entry.nextPromise;
      entry.nextPromise = JSONLogFileScan(entry.cursor);
      const resp: WorkerFileRespScan = {
        type: 'scan',
        id: req.id,
        cursor: req.cursor,
        values,
        done,
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }

    case 'flush': {
      const file = gOpenFiles.get(req.file);
      assert(file !== undefined, 'File not found');
      await JSONLogFileFlush(file);
      const resp: WorkerFileRespFlush = {
        type: 'flush',
        id: req.id,
        file: req.file,
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }

    case 'append': {
      const file = gOpenFiles.get(req.file);
      assert(file !== undefined, 'File not found');
      await JSONLogFileAppend(file, req.values);
      const resp: WorkerFileRespAppend = {
        type: 'append',
        id: req.id,
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }

    case 'readTextFile': {
      const resp: WorkerReadTextFileResp = {
        type: 'readTextFile',
        id: req.id,
        text: await readTextFile(req.path),
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }

    case 'writeTextFile': {
      const resp: WorkerWriteTextFileResp = {
        type: 'writeTextFile',
        id: req.id,
        success: await writeTextFile(req.path, req.text),
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }

    case 'remove': {
      const resp: WorkerRemoveResp = {
        type: 'remove',
        id: req.id,
        success: await (await FileImplGet()).remove(req.path),
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }

    default: {
      const resp: WorkerErrorResp = {
        type: 'error',
        id: (req as WorkerFileReq).id,
        error: 'UnknownCommand',
      };
      gPostMessage!(JSON.stringify(resp));
      break;
    }
  }
}

export function jsonLogWorkerMain(): void {
  if (isNode()) {
    const parentPort = require('node:worker_threads').parentPort;
    parentPort.on('message', handleRequest);
    gPostMessage = parentPort.postMessage.bind(parentPort);
  } else {
    onmessage = handleRequest;
    gPostMessage = postMessage;
  }
}

// jsonLogWorkerMain();
