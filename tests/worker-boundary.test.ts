/**
 * Worker-boundary guard: file-impl.ts stays worker-owned.
 *
 * Direct filesystem access lives in base/json-log/file-impl.ts and must run
 * inside the json-log worker. Main-thread callers must use the worker-backed
 * wrappers in base/json-log/json-log.ts instead: direct calls bypass the
 * worker queue and break OPFS handle discipline.
 *
 * This test scans every repo .ts/.tsx file for import specifiers resolving to
 * file-impl.ts and fails on any importer missing from the allowlist below.
 * The allowlist holds the worker plus pre-discipline importers that are
 * grandfathered (migrate them to the json-log.ts wrappers, do not extend).
 * It deliberately ignores file-impl-interface/deno/node/opfs: those are the
 * interface and per-runtime implementations, not the worker-owned module.
 * The guard is server-only: it scans the repo tree, which browsers do not have.
 */

import { TEST } from './mod.ts';
import { assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { readTextFile } from '../base/json-log/json-log.ts';
import { walkFiles } from './file-walk.ts';

// Desired end-state: only base/json-log/json-log-worker.ts imports
// file-impl.ts directly. Every other entry predates the worker-owned FS
// discipline and is grandfathered pending migration. Do not add new entries.
const kAllowedDirectImporters: ReadonlySet<string> = new Set([
  'base/build-info.ts',
  'base/git-root.ts',
  'base/json-log/json-log-worker.ts',
  'benchmarks/browser/debug-server-entry.ts',
  'benchmarks/goatdb.bench.ts',
  'benchmarks/mod.ts',
  'benchmarks/run.ts',
  'cli/build-assets.ts',
  'cli/compile.ts',
  'cli/debug-server.ts',
  'cli/init.ts',
  'cli/link.ts',
  'db/db.ts',
  'shared/runner.ts',
  'tests/browser/debug-server-entry.ts',
  'tests/cli-build-assets.test.ts',
  'tests/cli-compile.test.ts',
  'tests/cli-init.test.ts',
  'tests/cluster-latency.test.ts',
  'tests/e2e-latency.test.ts',
  'tests/file-impl.test.ts',
  'tests/json-log-formats.test.ts',
  'tests/merge-sync.test.ts',
  'tests/minimal-client-server-sync.test.ts',
  'tests/mod.ts',
  'tests/security-boundaries.test.ts',
  'tests/server-architecture.test.ts',
]);

// Static, dynamic, re-export, and side-effect import specifiers. Basename
// equality keeps the interface and per-runtime variants (deno/node/opfs) out
// of scope.
const kSpecifierPattern =
  /(?:\bfrom\b|\bimport\b|\brequire\b)\s*\(?\s*['"]([^'"]+)['"]/g;

// Comments may mention file-impl.ts in prose; strip them before matching.
const kBlockCommentPattern = /\/\*[\s\S]*?\*\//g;
const kLineCommentPattern = /\/\/[^\n]*/g;

function specifierUsesFileImpl(spec: string): boolean {
  return spec.split('/').pop() === 'file-impl.ts';
}

export default function setupWorkerBoundary() {
  if (getRuntime().id === 'browser') return;
  TEST('WorkerBoundary', 'no new direct file-impl importers', async () => {
    const root = getRuntime().getCWD();
    const files: path.PosixPath[] = [];
    for await (const file of walkFiles(root)) files.push(file);
    assertTrue(
      files.length > 50,
      `Expected a repo tree at ${root}, found ${files.length} source files`,
    );
    const violators: string[] = [];
    for (const file of files) {
      if (file.endsWith('tests/worker-boundary.test.ts')) continue;
      const text = await readTextFile(file);
      if (text === undefined) continue;
      const code = text.replace(kBlockCommentPattern, '').replace(
        kLineCommentPattern,
        '',
      );
      for (const match of code.matchAll(kSpecifierPattern)) {
        if (specifierUsesFileImpl(match[1])) {
          const rel = path.relative(root, file);
          if (!kAllowedDirectImporters.has(rel)) violators.push(rel);
          break;
        }
      }
    }
    assertTrue(
      violators.length === 0,
      `New direct file-impl.ts importers (use json-log.ts wrappers): ${
        violators.join(', ')
      }`,
    );
  });
}
