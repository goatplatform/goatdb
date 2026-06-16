/**
 * Shared helpers for JSON log format tests.
 *
 * Extracted from json-log-formats.test.ts so that both the browser-compatible
 * and server-only test files can reuse the same entry-building and scan logic.
 */
import type { ReadonlyJSONObject } from '../base/interfaces.ts';
import {
  JSONLogFileScan,
  JSONLogFileStartCursor,
} from '../base/json-log/json-log.ts';
import { BINARY_MAGIC } from '../base/core-types/encoding/binary-commit.ts';

export type LogFormat = 'goat' | 'jsonl';

export const gTextEncoder = new TextEncoder();
export const gTextDecoder = new TextDecoder();

// Minimal binary entry for goat format tests: BINARY_MAGIC header + id + contents JSON.
// Tests the framing layer (GOAT length-prefix); the real commit codec is in binary-encoding.test.ts.
export function makeBinaryEntry(
  id: string,
  extraData: ReadonlyJSONObject = {},
): Uint8Array {
  const idBytes = gTextEncoder.encode(id);
  const contentsBytes = gTextEncoder.encode(
    JSON.stringify({ id, ...extraData }),
  );
  // Layout: 36-byte header | u16+id | u16+key(empty) | u16+session(empty) | u16+orgId(empty) | u16+schemaId(empty) | contentsBytes
  const HEADER_SIZE = 36;
  const idStart = HEADER_SIZE;
  const keyStart = idStart + 2 + idBytes.length;
  const sessionStart = keyStart + 2;
  const orgIdStart = sessionStart + 2;
  const schemaIdStart = orgIdStart + 2;
  const afterFixed = schemaIdStart + 2;
  const contentsStart = afterFixed;
  const buf = new Uint8Array(contentsStart + contentsBytes.length);
  buf[0] = BINARY_MAGIC; // magic
  buf[1] = 0x01; // version
  // age = -1 (i32 LE means "unset")
  buf[12] = 0xff;
  buf[13] = 0xff;
  buf[14] = 0xff;
  buf[15] = 0xff;
  // offsets (record-relative u16 LE)
  buf[24] = keyStart & 0xff;
  buf[25] = (keyStart >> 8) & 0xff;
  buf[26] = sessionStart & 0xff;
  buf[27] = (sessionStart >> 8) & 0xff;
  buf[28] = orgIdStart & 0xff;
  buf[29] = (orgIdStart >> 8) & 0xff;
  buf[30] = schemaIdStart & 0xff;
  buf[31] = (schemaIdStart >> 8) & 0xff;
  buf[32] = afterFixed & 0xff;
  buf[33] = (afterFixed >> 8) & 0xff;
  buf[34] = contentsStart & 0xff;
  buf[35] = (contentsStart >> 8) & 0xff;
  // id field: u16 length + bytes
  buf[idStart] = idBytes.length & 0xff;
  buf[idStart + 1] = (idBytes.length >> 8) & 0xff;
  buf.set(idBytes, idStart + 2);
  // contents
  buf.set(contentsBytes, contentsStart);
  return buf;
}

// makeEntry produces binary for goat (framing test, not codec test), JSON for jsonl.
export function makeEntry(
  format: LogFormat,
  id: string,
  extraData: ReadonlyJSONObject = {},
): Uint8Array {
  if (format === 'goat') return makeBinaryEntry(id, extraData);
  return gTextEncoder.encode(JSON.stringify({ id, ...extraData }));
}

export function decodeEntry(
  format: LogFormat,
  bytes: Uint8Array,
): ReadonlyJSONObject {
  if (format === 'goat' && bytes.length > 0 && bytes[0] === BINARY_MAGIC) {
    const contentsOffset = bytes[34] | (bytes[35] << 8);
    return JSON.parse(
      gTextDecoder.decode(bytes.subarray(contentsOffset)),
    ) as ReadonlyJSONObject;
  }
  return JSON.parse(gTextDecoder.decode(bytes)) as ReadonlyJSONObject;
}

export async function scanAll(file: number): Promise<Uint8Array[]> {
  const cursor = await JSONLogFileStartCursor(file);
  const all: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const result = await JSONLogFileScan(cursor);
    done = result.done;
    if (result.values) {
      all.push(...(result.values as Uint8Array[]));
    } else if (result.buffer && result.offsets) {
      for (let i = 0; i < result.offsets.length; i += 2) {
        const offset = result.offsets[i];
        const len = result.offsets[i + 1];
        all.push(result.buffer.slice(offset, offset + len));
      }
    }
  }
  return all;
}
