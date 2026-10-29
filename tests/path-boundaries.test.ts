/** Static guard: containment stays semantic; native path modules stay at the
 * adapter boundary. `/vendor/goatdb-other` is not inside `/vendor/goatdb`. */

import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import type { PosixPath } from '../base/path.ts';
import { isBrowser } from '../base/common.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { scanSourceTree } from './file-walk.ts';

const kGuardFile = 'path-boundaries.test.ts';
const kAllowedFiles = new Set([
  'base/path.ts',
  'tests/path.test.ts',
  'tests/cli-path-normalization.test.ts',
  'tests/path-property.test.ts',
]);
const kAllowedDirs = new Set(['docs', 'system-assets']);
const kContainment = '(?:includes|startsWith|indexOf)';
const kPathNames =
  '(?:cwd|dir|root|local|binary|base|path|p|rel|\\w*(?:Path|Dir|Root|Cwd|CWD))';
const kRules: ReadonlyArray<[RegExp, string]> = [
  [
    new RegExp(
      `\\b${kPathNames}\\b(?:\\s*\\(\\))?\\s*[?!]?\\s*\\.\\s*${kContainment}\\s*\\(`,
    ),
    'path values must use isWithin instead of string search',
  ],
  [
    new RegExp(
      `\\.(?:getCWD|getTempDir)\\(\\)[^;\\n]*[?!]?\\s*\\.\\s*${kContainment}\\s*\\(`,
    ),
    'cwd/temp directory results must use isWithin',
  ],
  [
    /\b(?:from\s+|require\(\s*)['"](?:node:path|@std\/path)['"]/,
    'native path modules belong at the adapter boundary',
  ],
];
const kRealPath = /\b(?:realpath|realPath|realpathSync)\s*\(/;
const kContainmentCall = new RegExp(`${kContainment}\\s*\\(`);
/** Returns violation messages for one source file. */
export function scanPathBoundaries(
  relativePath: string,
  text: string,
): string[] {
  if (
    kAllowedFiles.has(relativePath) ||
    kAllowedDirs.has(relativePath.split('/')[0])
  ) return [];
  const violations: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [pattern, message] of kRules) {
      if (pattern.test(line)) {
        violations.push(`${relativePath}:${i + 1}: ${message}: ${line.trim()}`);
      }
    }
    if (
      kRealPath.test(line) &&
      kContainmentCall.test(lines.slice(i, i + 3).join('\n'))
    ) {
      violations.push(
        `${relativePath}:${i + 1}: realpath results must use equals/isWithin`,
      );
    }
  }
  return [...new Set(violations)];
}
async function assertPathBoundaries(root: PosixPath): Promise<void> {
  const violations = await scanSourceTree(
    root,
    kGuardFile,
    scanPathBoundaries,
    (name) => name === 'templates',
  );
  assertTrue(
    violations.length === 0,
    `Path-boundary violations:\n${violations.join('\n')}`,
  );
}

export default function setupPathBoundaryTests(): void {
  TEST(
    'Path',
    'guard detects unsafe containment and accepts semantic operations',
    () => {
      const unsafe = [
        "m.local?.includes('/vendor/goatdb/')",
        'getRuntime().getCWD().startsWith(x)',
        'cwd.indexOf(base) === 0',
        'const base = getRuntime().getCWD(); if (base.startsWith(p)) {}',
        "const filePath = entry.path; if (filePath.includes('/vendor/goatdb')) {}",
        "m.local!.includes('/vendor/goatdb/other')",
        "if (db.path.includes('/temp')) {}",
        'if (filePath.startsWith(otherPath)) {}',
        "const rel = path.relative(root, file); if (rel.startsWith('..')) {}",
        'const p = event.path; if (p.startsWith(cwd)) {}',
        "import * as p from 'node:path';",
        'const r = await Deno.realPath(p); if (r.startsWith(root)) {}',
      ];
      for (const source of unsafe) {
        assertTrue(
          scanPathBoundaries('db/example.ts', source).length > 0,
          source,
        );
      }
      const safe = [
        'if (path.isWithin(vendorRoot, module.local)) {}',
        'const cwd = getRuntime().getCWD();',
        'path.equals(a, b)',
        "if (message.includes('path') || sourceRelative.startsWith('shared/')) {}",
        "if (file.path.endsWith('.js') || db.path.endsWith('/')) {}",
        'const missing = expected.filter((entry) => !actual.includes(entry));',
      ];
      for (const source of safe) {
        assertEquals(scanPathBoundaries('db/example.ts', source), [], source);
      }
    },
  );
  if (!isBrowser()) {
    TEST(
      'Path',
      'guard enforces semantic containment across the source tree',
      () => assertPathBoundaries(getRuntime().getCWD()),
    );
  }
}
