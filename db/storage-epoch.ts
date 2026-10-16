import * as path from '../base/path.ts';
import {
  mkdir,
  readDir,
  readFile,
  writeFile,
} from '../base/json-log/json-log.ts';
import { log } from '../logging/log.ts';

/**
 * Storage-format epoch (single source of truth).
 *
 * GoatDB is pre-1.0 and does not guarantee storage compatibility across
 * releases. Phase 5 unified the Date wire format and redefined the commit
 * checksum, so stores written by earlier versions decode incorrectly (or
 * silently flag every commit as corrupted). A single monotonic epoch, recorded
 * once at the store root, lets the database fail fast with a clear message.
 *
 * BUMP THIS whenever the on-disk or wire format changes: the commit codec,
 * the checksum definition, or the core-value encoding. The marker file stores
 * the epoch that created the store; a mismatch rejects the store.
 */
export const kStorageFormatEpoch = 1;

/** Marker file at the store root recording `kStorageFormatEpoch`. */
export const kStorageFormatMarkerFile = '.goatdb-storage-epoch';

const gTextEncoder = new TextEncoder();
const gTextDecoder = new TextDecoder();

/**
 * Error thrown when a store was written by an incompatible GoatDB
 * (storage-format epoch mismatch) or predates the marker entirely.
 */
export function storageFormatMismatchError(storePath: string): Error {
  const message =
    `GoatDB store at "${storePath}" is incompatible with this version ` +
    `(expected epoch ${kStorageFormatEpoch}). It was either created by an ` +
    `older GoatDB or is not a GoatDB store. Delete the store directory and ` +
    `re-sync from your peers.`;
  // The throw happens during DB open. Log explicitly so a rejected store is
  // visible in the operational log, like every other hard failure in the code.
  log({ severity: 'ERROR', error: 'StorageError', message });
  return new Error(message);
}

/** Only a missing file counts as "no marker". Any other I/O error must
 * propagate: a transient read failure silently treated as "no marker" would
 * reject a valid store with delete-and-re-sync advice. */
function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; code?: string };
  return err.name === 'NotFound' || err.name === 'NotFoundError' ||
    err.code === 'ENOENT';
}

/** Reads the marker text, or undefined only when the marker does not exist. */
async function readMarker(markerPath: string): Promise<string | undefined> {
  try {
    return gTextDecoder.decode(await readFile(markerPath));
  } catch (e: unknown) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

/**
 * True when the marker exists with the current epoch. A missing marker OR an
 * empty one counts as not-yet-written: writeFile creates the file before the
 * content lands, so a concurrent opener can observe a zero-length marker
 * without this tolerance.
 */
async function markerMatches(
  markerPath: string,
  storePath: string,
): Promise<boolean> {
  const recorded = await readMarker(markerPath);
  if (recorded === undefined || recorded.trim() === '') return false;
  if (recorded.trim() !== String(kStorageFormatEpoch)) {
    throw storageFormatMismatchError(storePath);
  }
  return true;
}

/**
 * Verifies the store root's storage-format epoch before any repository opens.
 *
 * - Marker present and equal to the current epoch -> proceed.
 * - Marker present with a different epoch -> throw mismatch.
 * - Marker missing or still empty, but the store directory has entries other
 *   than the marker file itself -> throw mismatch (an older store that
 *   predates the marker, or not a GoatDB store).
 * - Marker missing/empty and the directory empty/absent -> initialize it and
 *   write the current epoch.
 *
 * Runs before settings/query-persistence files land in the store, so their
 * presence can never be mistaken for an older store during creation.
 */
export async function ensureStorageFormatEpoch(
  storePath: string,
): Promise<void> {
  const markerPath = path.join(storePath, kStorageFormatMarkerFile);
  if (await markerMatches(markerPath, storePath)) return;
  // Create the root before checking it. Another opener may have written the
  // marker since our first read, so verify it again before treating files as
  // legacy data.
  await mkdir(storePath);
  if (await markerMatches(markerPath, storePath)) return;
  // Ignore the marker file itself: a concurrent opener may write it between
  // our read above and this listing, and every other entry means legacy data.
  const entries = await readDir(storePath);
  if (entries.some((e) => e.name !== kStorageFormatMarkerFile)) {
    throw storageFormatMismatchError(storePath);
  }
  // writeFile (not writeTextFile) so a failed marker write surfaces explicitly
  // instead of being swallowed. Two concurrent openers may both write the same
  // epoch content here; identical bytes make that benign.
  await writeFile(
    markerPath,
    gTextEncoder.encode(String(kStorageFormatEpoch) + '\n'),
  );
}
