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
 * (storage-format epoch mismatch). The marker proves GoatDB owns the
 * directory, so delete-and-resync is safe after a backup.
 */
export function storageFormatMismatchError(
  storePath: string,
  recorded: string,
): Error {
  const message =
    `GoatDB store at "${storePath}" is incompatible with this version ` +
    `(expected epoch ${kStorageFormatEpoch}, found "${recorded}"). It was ` +
    `created by an older GoatDB. Back up the directory before deleting or ` +
    `re-syncing. To recover, delete the store directory after the backup and ` +
    `re-sync from your peers.`;
  // The throw happens during DB open. Log explicitly so a rejected store is
  // visible in the operational log, like every other hard failure in the code.
  log({ severity: 'ERROR', error: 'StorageError', message });
  return new Error(message);
}

/**
 * Error thrown when the marker is missing but the directory holds GoatDB data.
 * The data may belong to an older GoatDB or to something else, so the only
 * safe advice is to back up before any delete or move.
 */
export function storageFormatMissingMarkerError(
  storePath: string,
  artifact: string,
): Error {
  const message =
    `GoatDB store at "${storePath}" is missing its storage-format marker but ` +
    `contains GoatDB data ("${artifact}"). It was either created by an older ` +
    `GoatDB or is not a GoatDB store. Back up the directory before deleting ` +
    `or moving any files. Delete and re-sync only after the backup, and only ` +
    `if this is a confirmed older GoatDB store.`;
  log({ severity: 'ERROR', error: 'StorageError', message });
  return new Error(message);
}

/** Root files that only GoatDB writes. */
const kGoatRootFiles = new Set(['settings.json']);
/** Suffixes of files that only GoatDB writes, at any repo directory depth. */
const kGoatFileSuffixes = ['.goat', '.jsonl', '.cache.json'];

function isGoatFile(name: string): boolean {
  return kGoatRootFiles.has(name) ||
    kGoatFileSuffixes.some((suffix) => name.endsWith(suffix));
}

/**
 * Finds one entry that proves the directory belongs to GoatDB.
 *
 * Scans the root and one level of subdirectories, which covers the
 * `<storage>/<repo>.goat` layout. Unrelated files (`.DS_Store`, editor
 * droppings, user documents) must never reject a store the user pointed us at.
 */
async function findGoatArtifact(
  storePath: path.PosixPath,
): Promise<string | undefined> {
  for (const entry of await readDir(storePath)) {
    if (entry.name === kStorageFormatMarkerFile) continue;
    if (entry.isFile && isGoatFile(entry.name)) return entry.name;
    if (!entry.isDirectory) continue;
    for (const child of await readDir(path.join(storePath, entry.name))) {
      if (child.isFile && isGoatFile(child.name)) {
        return entry.name + '/' + child.name;
      }
    }
  }
  return undefined;
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
async function readMarker(
  markerPath: path.PosixPath,
): Promise<string | undefined> {
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
  markerPath: path.PosixPath,
  storePath: string,
): Promise<boolean> {
  const recorded = await readMarker(markerPath);
  if (recorded === undefined || recorded.trim() === '') return false;
  if (recorded.trim() !== String(kStorageFormatEpoch)) {
    throw storageFormatMismatchError(storePath, recorded.trim());
  }
  return true;
}

/**
 * Verifies the store root's storage-format epoch before any repository opens.
 *
 * - Marker present and equal to the current epoch -> proceed.
 * - Marker present with a different epoch -> throw mismatch.
 * - Marker missing or still empty, but the store directory holds a known
 *   GoatDB artifact -> throw a backup-first mismatch error naming the entry.
 * - Marker missing/empty and the directory holds only unrelated files ->
 *   initialize it and write the current epoch.
 *
 * Runs before settings/query-persistence files land in the store, so their
 * presence can never be mistaken for an older store during creation.
 */
export async function ensureStorageFormatEpoch(
  storePath: string,
): Promise<void> {
  // The store root comes from user config; normalize it once here before it
  // crosses into the FileImpl POSIX contract.
  const root = path.parsePath(storePath);
  const markerPath = path.join(root, kStorageFormatMarkerFile);
  if (await markerMatches(markerPath, storePath)) return;
  // Create the root before checking it. Another opener may have written the
  // marker since our first read, so verify it again before treating files as
  // legacy data.
  await mkdir(root);
  if (await markerMatches(markerPath, storePath)) return;
  // Ignore the marker file itself: a concurrent opener may write it between
  // our read above and this listing. Only a known GoatDB artifact makes the
  // directory an unrecognized store; unrelated files are safe to ignore.
  const artifact = await findGoatArtifact(root);
  if (artifact !== undefined) {
    throw storageFormatMissingMarkerError(storePath, artifact);
  }
  // writeFile (not writeTextFile) so a failed marker write surfaces explicitly
  // instead of being swallowed. Two concurrent openers may both write the same
  // epoch content here; identical bytes make that benign.
  await writeFile(
    markerPath,
    gTextEncoder.encode(String(kStorageFormatEpoch) + '\n'),
  );
}
