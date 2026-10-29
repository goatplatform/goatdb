/** Worker-backed recursive walk shared by static guards. Guards must see the
 * same tree and skip the same generated directories. */

import * as path from '../base/path.ts';
import { readDir, readTextFile } from '../base/json-log/json-log.ts';
import { assertExists, assertTrue } from './asserts.ts';

// Generated output and dependency trees. Dot directories hold caches/tooling.
const kSkippedDirs = /^(?:build|coverage|dist|node_modules|test_data|_site)$/;

export async function* walkFiles(
  dir: path.PosixPath,
  skipDir?: (name: string) => boolean,
): AsyncGenerator<path.PosixPath> {
  for (const entry of await readDir(dir)) {
    if (
      entry.name.startsWith('.') ||
      (entry.isDirectory &&
        (kSkippedDirs.test(entry.name) || skipDir?.(entry.name)))
    ) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(full, skipDir);
    } else if (
      entry.isFile &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
    ) {
      yield full;
    }
  }
}

/** Scans every source under `root`, skipping the guard file itself. */
export async function scanSourceTree(
  root: path.PosixPath,
  guardFile: string,
  scan: (relativePath: string, text: string) => string[],
  skipDir?: (name: string) => boolean,
): Promise<string[]> {
  const violations: string[] = [];
  let scanned = 0;
  for await (const file of walkFiles(root, skipDir)) {
    if (path.basename(file) === guardFile) continue;
    const text = await readTextFile(file);
    assertExists(text, `Unable to read source: ${file}`);
    scanned++;
    violations.push(...scan(path.relative(root, file), text));
  }
  assertTrue(scanned > 0, 'Guard scanned no source files');
  return violations;
}
