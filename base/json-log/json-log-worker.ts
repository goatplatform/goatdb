/**
 * This file implements a background worker for the JSONLogFile interface in
 * json-log.ts. Two on-disk formats are supported:
 *
 * GOAT (.goat): length-prefixed binary
 *   [4-byte BE uint32 length][binary payload] ...
 *
 * JSONL (.jsonl): newline-delimited JSON
 *   {"id":"...","key":"...",...}\n
 *
 * The format is detected from the file path extension. All worker<->main-thread
 * messages use structured clone (no JSON.stringify).
 */
import { assert } from '../error.ts';
import { log, setGlobalLoggerStreams } from '../../logging/log.ts';
import type { LogStream } from '../../logging/log.ts';
import type { NormalizedLogEntry } from '../../logging/entry.ts';
import type { LogEntry } from '../../logging/log.ts';
import type { WorkerLogRelay } from './json-log-worker-req.ts';

// Collector stream: captures log entries during request processing so they can
// be relayed to the main thread via the response rather than going to console.
const gCollectedLogs: WorkerLogRelay[] = [];
const gCollectorStream: LogStream = {
  appendEntry(e: NormalizedLogEntry<LogEntry>): void {
    gCollectedLogs.push({
      severity: e.severity,
      error: (e as unknown as Record<string, unknown>).error as
        | string
        | undefined,
      message: e.message,
    });
  },
};

// Wraps gPostMessage to drain collected logs into the response before sending.
function postWithLogs(message: unknown, transfer?: ArrayBuffer[]): void {
  if (gCollectedLogs.length > 0) {
    (message as Record<string, unknown>).logs = gCollectedLogs.splice(0);
  }
  gPostMessage!(message, transfer);
}

const MAX_PAYLOAD_SIZE = 256 * 1024 * 1024;
const SCAN_BATCH_SIZE = 100;
import {
  BINARY_MAGIC,
  binaryExtractId,
} from '../core-types/encoding/binary-commit.ts';
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

const FILE_READ_BUF_SIZE_BYTES = 1024 * 1024;
const PAGE_SIZE = 1024;
const NEWLINE_BYTE = 0x0a;

const gTextDecoder = new TextDecoder();

interface JSONLogFile {
  readonly path: string;
  readonly write: boolean;
  readonly impl: FileImpl<unknown>;
  readonly knownIds: Set<string>;
  readonly format: 'jsonl' | 'goat';
  handle: unknown;
  didScan?: true;
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
    knownIds: new Set(),
    format: path.endsWith('.jsonl') ? 'jsonl' : 'goat',
  };
}

function JSONLogFileClose(file: JSONLogFile): Promise<void> {
  return file.impl.close(file.handle);
}

// ---- Binary cursor state ----
// Reads [4-byte BE length][payload] records from the file.

interface BinaryLogFileCursor {
  readonly file: JSONLogFile;
  readBuf: Uint8Array;
  /** Remaining unread bytes in readBuf starting at readBufStart. */
  readBufLen: number;
  readBufStart: number;
  lastGoodFileOffset: number;
  // Header state: accumulate 4 bytes
  headerBuf: Uint8Array;
  headerBytesRead: number;
  // Payload state: -1 means we have not parsed the header yet
  payloadLen: number;
  objectBuf: Uint8Array;
  objectBufOffset: number;
}

async function BinaryLogFileStartCursor(
  file: JSONLogFile,
): Promise<BinaryLogFileCursor> {
  await file.impl.seek(file.handle, 0, 'start');
  return {
    file,
    readBuf: new Uint8Array(FILE_READ_BUF_SIZE_BYTES),
    readBufLen: 0,
    readBufStart: 0,
    lastGoodFileOffset: 0,
    headerBuf: new Uint8Array(4),
    headerBytesRead: 0,
    payloadLen: -1,
    objectBuf: new Uint8Array(PAGE_SIZE),
    objectBufOffset: 0,
  };
}

type BinaryScanResult = {
  buffer: Uint8Array;
  offsets: Uint32Array;
  done: boolean;
};

async function BinaryLogFileScan(
  cursor: BinaryLogFileCursor,
): Promise<BinaryScanResult> {
  // Accumulate all records into one contiguous buffer
  let outBuf = new Uint8Array(64 * 1024);
  let outOffset = 0;
  // Flat array of [byteOffset, byteLength] pairs into the contiguous output buffer
  const offsetPairs: number[] = [];
  let recordCount = 0;

  while (recordCount < SCAN_BATCH_SIZE) {
    // Refill read buffer if empty
    while (cursor.readBufLen <= 0) {
      const bytesRead = await cursor.file.impl.read(
        cursor.file.handle,
        cursor.readBuf,
      );
      if (bytesRead === null) {
        // EOF -- handle partial trailing record
        if (
          (cursor.headerBytesRead > 0 || cursor.objectBufOffset > 0 ||
            cursor.payloadLen >= 0) &&
          cursor.file.write
        ) {
          await cursor.file.impl.truncate(
            cursor.file.handle,
            cursor.lastGoodFileOffset,
          );
          // Reset partial state so the worker's pre-fetched re-invocation of
          // this cursor does not attempt truncation on a potentially-closed
          // handle.
          cursor.headerBytesRead = 0;
          cursor.objectBufOffset = 0;
          cursor.payloadLen = -1;
        }
        cursor.file.didScan = true;
        return {
          buffer: outBuf.subarray(0, outOffset),
          offsets: new Uint32Array(offsetPairs),
          done: true,
        };
      }
      cursor.readBufLen = bytesRead;
      cursor.readBufStart = 0;
    }

    if (cursor.payloadLen < 0) {
      // Reading the 4-byte length header
      const need = 4 - cursor.headerBytesRead;
      const take = Math.min(cursor.readBufLen, need);
      cursor.headerBuf.set(
        cursor.readBuf.subarray(
          cursor.readBufStart,
          cursor.readBufStart + take,
        ),
        cursor.headerBytesRead,
      );
      cursor.headerBytesRead += take;
      cursor.readBufStart += take;
      cursor.readBufLen -= take;

      if (cursor.headerBytesRead === 4) {
        // Big-endian (network byte order) u32 length prefix -- intentional.
        cursor.payloadLen = ((cursor.headerBuf[0] << 24) |
          (cursor.headerBuf[1] << 16) |
          (cursor.headerBuf[2] << 8) |
          cursor.headerBuf[3]) >>>
          0;
        if (cursor.payloadLen > MAX_PAYLOAD_SIZE) {
          log({
            severity: 'ERROR',
            error: 'StorageError',
            message:
              `Corrupt binary log: payload ${cursor.payloadLen} exceeds max`,
          });
          if (cursor.file.write) {
            await cursor.file.impl.truncate(
              cursor.file.handle,
              cursor.lastGoodFileOffset,
            );
          }
          cursor.headerBytesRead = 0;
          cursor.payloadLen = -1;
          cursor.file.didScan = true;
          return {
            buffer: outBuf.subarray(0, outOffset),
            offsets: new Uint32Array(offsetPairs),
            done: true,
          };
        }
        cursor.headerBytesRead = 0;
        cursor.objectBufOffset = 0;
      }
    } else {
      // Reading payload bytes
      const remaining = cursor.payloadLen - cursor.objectBufOffset;
      const take = Math.min(cursor.readBufLen, remaining);
      cursor.objectBuf = appendBytes(
        cursor.readBuf,
        cursor.readBufStart,
        take,
        cursor.objectBuf,
        cursor.objectBufOffset,
      );
      cursor.objectBufOffset += take;
      cursor.readBufStart += take;
      cursor.readBufLen -= take;

      if (cursor.objectBufOffset === cursor.payloadLen) {
        // Complete payload -- advance boundary before validation so
        // EOF truncation never destroys records after a skipped one.
        const payloadLen = cursor.payloadLen;
        cursor.lastGoodFileOffset += 4 + payloadLen;
        try {
          let id: string | undefined;
          if (payloadLen > 0 && cursor.objectBuf[0] === BINARY_MAGIC) {
            id = binaryExtractId(cursor.objectBuf, payloadLen);
          } else {
            log({
              severity: 'ERROR',
              error: 'StorageError',
              message: 'binary scan: non-binary record in .goat file, skipping',
            });
            cursor.payloadLen = -1;
            cursor.objectBufOffset = 0;
            continue;
          }
          if (typeof id === 'string' && !cursor.file.knownIds.has(id)) {
            cursor.file.knownIds.add(id);
            // Grow outBuf if needed
            const needed = outOffset + payloadLen;
            if (needed > outBuf.length) {
              const grown = new Uint8Array(Math.max(outBuf.length * 2, needed));
              grown.set(outBuf.subarray(0, outOffset));
              outBuf = grown;
            }
            // Copy payload into contiguous buffer
            outBuf.set(
              cursor.objectBuf.subarray(0, payloadLen),
              outOffset,
            );
            offsetPairs.push(outOffset, payloadLen);
            outOffset += payloadLen;
            recordCount++;
          }
        } catch (_: unknown) {
          // Corrupted payload -- skip record and continue
          log({
            severity: 'WARNING',
            error: 'StorageError',
            message: 'binary scan: failed to extract id from record, skipping',
          });
          cursor.payloadLen = -1;
          cursor.objectBufOffset = 0;
          continue;
        }
        cursor.payloadLen = -1;
        cursor.objectBufOffset = 0;
      }
    }
  }

  return {
    buffer: outBuf.subarray(0, outOffset),
    offsets: new Uint32Array(offsetPairs),
    done: false,
  };
}

// ---- JSONL cursor state ----
// Reads newline-delimited JSON records from the file.

interface JSONLCursor {
  readonly file: JSONLogFile;
  readBuf: Uint8Array;
  /** Remaining unread bytes in readBuf starting at readBufStart. */
  readBufLen: number;
  readBufStart: number;
  lineBuf: Uint8Array;
  lineBufOffset: number;
  done: boolean;
}

async function JSONLStartCursor(file: JSONLogFile): Promise<JSONLCursor> {
  await file.impl.seek(file.handle, 0, 'start');
  return {
    file,
    readBuf: new Uint8Array(FILE_READ_BUF_SIZE_BYTES),
    readBufLen: 0,
    readBufStart: 0,
    lineBuf: new Uint8Array(PAGE_SIZE),
    lineBufOffset: 0,
    done: false,
  };
}

function processJSONLLine(
  file: JSONLogFile,
  line: Uint8Array,
  pendingObjects: Uint8Array[],
): void {
  try {
    const obj = JSON.parse(gTextDecoder.decode(line)) as { id?: string };
    const id = obj.id;
    if (typeof id === 'string' && !file.knownIds.has(id)) {
      file.knownIds.add(id);
      pendingObjects.push(line);
    }
  } catch (e: unknown) {
    log({
      severity: 'WARNING',
      error: 'StorageError',
      message: `JSONL scan: skipped malformed line (${
        e instanceof Error ? e.message : String(e)
      })`,
    });
  }
}

type ScanResult = [results: readonly Uint8Array[], done: boolean];

async function JSONLScan(cursor: JSONLCursor): Promise<ScanResult> {
  const pendingObjects: Uint8Array[] = [];

  while (pendingObjects.length < SCAN_BATCH_SIZE) {
    // Refill read buffer if empty
    while (cursor.readBufLen <= 0) {
      if (cursor.done) {
        // Process any remaining partial line (file without trailing newline)
        if (cursor.lineBufOffset > 0) {
          const line = cursor.lineBuf.slice(0, cursor.lineBufOffset);
          cursor.lineBufOffset = 0;
          processJSONLLine(cursor.file, line, pendingObjects);
        }
        cursor.file.didScan = true;
        return [pendingObjects, true];
      }
      const bytesRead = await cursor.file.impl.read(
        cursor.file.handle,
        cursor.readBuf,
      );
      if (bytesRead === null) {
        cursor.done = true;
        continue;
      }
      cursor.readBufLen = bytesRead;
      cursor.readBufStart = 0;
    }

    // Find next newline in available buffer slice
    const searchIn = cursor.readBuf.subarray(
      cursor.readBufStart,
      cursor.readBufStart + cursor.readBufLen,
    );
    const newlineIdx = searchIn.indexOf(NEWLINE_BYTE);

    if (newlineIdx === -1) {
      // No newline found -- accumulate entire remaining buffer into line
      cursor.lineBuf = appendBytes(
        cursor.readBuf,
        cursor.readBufStart,
        cursor.readBufLen,
        cursor.lineBuf,
        cursor.lineBufOffset,
      );
      cursor.lineBufOffset += cursor.readBufLen;
      cursor.readBufLen = 0;
      cursor.readBufStart = 0;
    } else {
      // Found newline -- complete the current line
      cursor.lineBuf = appendBytes(
        cursor.readBuf,
        cursor.readBufStart,
        newlineIdx,
        cursor.lineBuf,
        cursor.lineBufOffset,
      );
      cursor.lineBufOffset += newlineIdx;
      cursor.readBufStart += newlineIdx + 1;
      cursor.readBufLen -= newlineIdx + 1;
      if (cursor.readBufLen <= 0) {
        cursor.readBufLen = 0;
        cursor.readBufStart = 0;
      }

      if (cursor.lineBufOffset > 0) {
        const line = cursor.lineBuf.slice(0, cursor.lineBufOffset);
        cursor.lineBufOffset = 0;
        processJSONLLine(cursor.file, line, pendingObjects);
      }
      // Empty line (just a newline): skip
    }
  }

  return [pendingObjects, false];
}

function scanCursor(
  cursor: BinaryLogFileCursor | JSONLCursor,
): Promise<ScanResult | BinaryScanResult> {
  if (cursor.file.format === 'jsonl') {
    return JSONLScan(cursor as JSONLCursor);
  }
  return BinaryLogFileScan(cursor as BinaryLogFileCursor);
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
    dst = newDst;
  }
  dst.set(src.subarray(srcOffset, srcOffset + srcLen), dstOffset);
  return dst;
}

async function BinaryLogFileAppend(
  file: JSONLogFile,
  entries: readonly Uint8Array[],
  ids?: readonly string[],
): Promise<void> {
  assert(file.write, 'Attempting to write to a readonly log');
  assert(
    !ids || ids.length === entries.length,
    'ids length must match entries length',
  );
  // Ordering: scan must reach EOF before appending so that knownIds is
  // populated and the file handle is positioned at the end.
  if (!file.didScan) {
    const cursor = await BinaryLogFileStartCursor(file);
    while (!(await BinaryLogFileScan(cursor)).done) {
      // Wind to EOF
    }
  }

  // Filter duplicates and compute total size in one pass
  let totalSize = 0;
  const toWrite: Uint8Array[] = [];
  const toWriteIds: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const bytes = entries[i];
    try {
      let id = ids?.[i];
      if (id === undefined) {
        if (bytes.length > 0 && bytes[0] === BINARY_MAGIC) {
          id = binaryExtractId(bytes);
        } else {
          log({
            severity: 'WARNING',
            error: 'StorageError',
            message: 'BinaryLogFileAppend: non-binary payload rejected',
          });
          continue;
        }
      }
      if (typeof id !== 'string' || file.knownIds.has(id)) {
        continue;
      }
      toWrite.push(bytes);
      toWriteIds.push(id);
      totalSize += 4 + bytes.length;
    } catch (e: unknown) {
      log({
        severity: 'WARNING',
        error: 'StorageError',
        message: `BinaryLogFileAppend: skipping malformed entry: ${e}`,
      });
    }
  }
  if (toWrite.length === 0) {
    return;
  }

  // Build one contiguous buffer: [4-byte header + payload] * n
  const buf = new Uint8Array(totalSize);
  let offset = 0;
  for (let i = 0; i < toWrite.length; i++) {
    const bytes = toWrite[i];
    const len = bytes.length;
    // Big-endian (network byte order) u32 length prefix -- intentional.
    buf[offset] = (len >>> 24) & 0xff;
    buf[offset + 1] = (len >>> 16) & 0xff;
    buf[offset + 2] = (len >>> 8) & 0xff;
    buf[offset + 3] = len & 0xff;
    offset += 4;
    buf.set(bytes, offset);
    offset += len;
  }

  await file.impl.seek(file.handle, 0, 'end');
  await file.impl.write(file.handle, buf);

  // Register ids after successful write
  for (const id of toWriteIds) {
    file.knownIds.add(id);
  }
}

async function JSONLAppend(
  file: JSONLogFile,
  entries: readonly Uint8Array[],
  ids?: readonly string[],
): Promise<void> {
  assert(file.write, 'Attempting to write to a readonly log');
  assert(
    !ids || ids.length === entries.length,
    'ids length must match entries length',
  );
  // Ordering: scan must reach EOF before appending so that knownIds is
  // populated and the file handle is positioned at the end.
  if (!file.didScan) {
    const cursor = await JSONLStartCursor(file);
    while (!(await JSONLScan(cursor))[1]) {
      // Wind to EOF
    }
  }

  // Filter duplicates and compute total size in one pass
  let totalSize = 0;
  const toWrite: Uint8Array[] = [];
  const toWriteIds: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const bytes = entries[i];
    try {
      const id = ids?.[i] ??
        (JSON.parse(gTextDecoder.decode(bytes)) as { id?: string }).id;
      if (typeof id !== 'string' || file.knownIds.has(id)) {
        continue;
      }
      toWrite.push(bytes);
      toWriteIds.push(id);
      totalSize += bytes.length + 1; // +1 for newline
    } catch (e: unknown) {
      log({
        severity: 'WARNING',
        error: 'StorageError',
        message: `JsonLogFileAppend: skipping malformed entry: ${e}`,
      });
    }
  }
  if (toWrite.length === 0) {
    return;
  }

  // Build one contiguous buffer: [entry + newline] * n
  const buf = new Uint8Array(totalSize);
  let offset = 0;
  for (const bytes of toWrite) {
    buf.set(bytes, offset);
    offset += bytes.length;
    buf[offset] = NEWLINE_BYTE;
    offset += 1;
  }

  await file.impl.seek(file.handle, 0, 'end');
  await file.impl.write(file.handle, buf);

  // Register ids after successful write
  for (const id of toWriteIds) {
    file.knownIds.add(id);
  }
}

const gOpenFiles = new Map<number, JSONLogFile>();
let gFileHandleNum = 0;
const gOpenCursors = new Map<
  number,
  {
    cursor: BinaryLogFileCursor | JSONLCursor;
    nextPromise?: Promise<ScanResult | BinaryScanResult>;
  }
>();
let gOpenCursorNum = 0;

type PostMessageFunc = (message: unknown, transfer?: ArrayBuffer[]) => void;

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
      postWithLogs(resp);
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
      postWithLogs(resp);
      break;
    }

    case 'cursor': {
      const file = gOpenFiles.get(req.file);
      if (file === undefined) {
        const resp: WorkerErrorResp = {
          type: 'error',
          id: req.id,
          error: 'FileClosed',
        };
        gPostMessage!(resp);
        break;
      }
      const cursor: BinaryLogFileCursor | JSONLCursor = file.format === 'jsonl'
        ? await JSONLStartCursor(file)
        : await BinaryLogFileStartCursor(file);
      const cursorId = ++gOpenCursorNum;
      const nextPromise = scanCursor(cursor);
      gOpenCursors.set(cursorId, { cursor, nextPromise });
      const resp: WorkerFileRespCursor = {
        type: 'cursor',
        id: req.id,
        cursor: cursorId,
      };
      postWithLogs(resp);
      break;
    }

    case 'scan': {
      const entry = gOpenCursors.get(req.cursor);
      assert(entry !== undefined, 'Cursor not found');
      if (!entry.nextPromise) {
        entry.nextPromise = scanCursor(entry.cursor);
      }
      const result = await entry.nextPromise;

      // Binary format returns BinaryScanResult (object with buffer/offsets)
      if (!Array.isArray(result)) {
        if (result.done) {
          gOpenCursors.delete(req.cursor);
        } else {
          entry.nextPromise = scanCursor(entry.cursor);
        }
        const resp: WorkerFileRespScan = {
          type: 'scan',
          id: req.id,
          cursor: req.cursor,
          done: result.done,
          buffer: result.buffer,
          offsets: result.offsets,
        };
        const transfer: ArrayBuffer[] = [];
        if (result.buffer.byteLength > 0) {
          transfer.push(result.buffer.buffer as ArrayBuffer);
        }
        if (result.offsets.byteLength > 0) {
          transfer.push(result.offsets.buffer as ArrayBuffer);
        }
        postWithLogs(resp, transfer);
        break;
      }

      // JSONL format returns [values, done] tuple
      const [values, done] = result;
      if (done) {
        gOpenCursors.delete(req.cursor);
      } else {
        entry.nextPromise = scanCursor(entry.cursor);
      }
      const resp: WorkerFileRespScan = {
        type: 'scan',
        id: req.id,
        cursor: req.cursor,
        done,
        values,
      };
      postWithLogs(resp, values.map((v) => v.buffer as ArrayBuffer));
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
      postWithLogs(resp);
      break;
    }

    case 'append': {
      const file = gOpenFiles.get(req.file);
      assert(file !== undefined, 'File not found');
      if (file.format === 'jsonl') {
        await JSONLAppend(file, req.values, req.ids);
      } else {
        await BinaryLogFileAppend(file, req.values, req.ids);
      }
      const resp: WorkerFileRespAppend = {
        type: 'append',
        id: req.id,
      };
      postWithLogs(resp);
      break;
    }

    case 'readTextFile': {
      const resp: WorkerReadTextFileResp = {
        type: 'readTextFile',
        id: req.id,
        text: await readTextFile(req.path),
      };
      postWithLogs(resp);
      break;
    }

    case 'writeTextFile': {
      const resp: WorkerWriteTextFileResp = {
        type: 'writeTextFile',
        id: req.id,
        success: await writeTextFile(req.path, req.text),
      };
      postWithLogs(resp);
      break;
    }

    case 'remove': {
      const resp: WorkerRemoveResp = {
        type: 'remove',
        id: req.id,
        success: await (await FileImplGet()).remove(req.path),
      };
      postWithLogs(resp);
      break;
    }

    default: {
      const resp: WorkerErrorResp = {
        type: 'error',
        id: (req as WorkerFileReq).id,
        error: 'UnknownCommand',
      };
      postWithLogs(resp);
      break;
    }
  }
}

export function jsonLogWorkerMain(): void {
  // Redirect all log() calls in the worker to the collector so entries are
  // relayed to the main thread via responses rather than going to console.
  setGlobalLoggerStreams([gCollectorStream]);

  let processingChain: Promise<void> = Promise.resolve();

  const safeHandler = (event: MessageEvent<WorkerFileReq> | WorkerFileReq) => {
    processingChain = processingChain.then(
      () => handleRequest(event),
      () => handleRequest(event),
    ).catch((_err) => {
      const req = isNode()
        ? (event as WorkerFileReq)
        : (event as MessageEvent<WorkerFileReq>).data;
      const resp: WorkerErrorResp = {
        type: 'error',
        id: req.id,
        error: 'InternalError',
      };
      postWithLogs(resp as unknown as Record<string, unknown>);
    });
  };
  if (isNode()) {
    const parentPort = require('node:worker_threads').parentPort;
    parentPort.on('message', safeHandler);
    gPostMessage = (msg, transfer) => parentPort.postMessage(msg, transfer);
  } else {
    onmessage = safeHandler;
    gPostMessage = (msg, transfer) => postMessage(msg, transfer ?? []);
  }
}
