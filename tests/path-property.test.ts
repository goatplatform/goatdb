/** Property coverage for the POSIX contract; the Node oracle keeps tests
 * independent of the implementation. */

import fc from 'fast-check';
import { TEST } from './mod.ts';
import { assertEquals } from './asserts.ts';
import * as path from '../base/path.ts';
import { isBrowser } from '../base/common.ts';
import { getEnvVar } from '../base/os.ts';

const kRuns = 1000;
/** Windows-forbidden and control characters are excluded by construction. */
const kSegment = fc.stringMatching(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,12}$/);
const kSegments = fc.array(fc.oneof(kSegment, fc.constantFrom('.', '..')), {
  minLength: 1,
  maxLength: 5,
});
const kRoots = [
  '/',
  'C:/',
  'C:\\',
  'c:/',
  '//server/share/',
  '\\\\server\\share\\',
];
const kSeparators = fc.constantFrom('/', '\\');
const pathParts = (roots: fc.Arbitrary<string>) =>
  fc.tuple(roots, kSegments, kSeparators, fc.boolean());

function composePath(
  root: string,
  segments: string[],
  separator: string,
  trailing: boolean,
): string {
  return root + segments.join(separator) + (trailing ? separator : '');
}

function rawPathArbitrary(): fc.Arbitrary<string> {
  return pathParts(fc.constantFrom('', ...kRoots)).map(
    ([root, segments, separator, trailing]) =>
      composePath(root, segments, separator, trailing),
  );
}

function seed(): number | undefined {
  const parsed = Number.parseInt(getEnvVar('FC_SEED') ?? '', 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function assertProperty(property: fc.IProperty<unknown>): void {
  fc.assert(property, { numRuns: kRuns, seed: seed() });
}

/** Node-only test; browser runs skip the properties and oracle. */
function nodeTest<T>(
  name: string,
  run: (nodePath: typeof import('node:path')) => T,
): void {
  TEST('Path', name, async () => {
    if (isBrowser()) return;
    await run(await import('node:path'));
  });
}

function testProperty<T>(
  name: string,
  arbitrary: fc.Arbitrary<T>,
  run: (value: T) => void,
): void {
  nodeTest(name, () => assertProperty(fc.property(arbitrary, run)));
}

/** Converts a native Node path to the contract's POSIX form. */
function toPosix(value: string): string {
  const posix = value.replaceAll('\\', '/');
  if (posix === '/' || /^[A-Za-z]:\/$/.test(posix)) return posix;
  return posix.replace(/\/+$/, '');
}

function oracle(
  nodePath: typeof import('node:path'),
  raw: string,
): {
  windows: boolean;
  impl: typeof import('node:path').posix;
  input: string;
} {
  // Drive and UNC prefixes are unambiguous Windows paths. Everything else,
  // including root-absolute paths with mixed separators, follows POSIX rules
  // after separator normalization.
  const windows = /^[A-Za-z]:/.test(raw) || raw.startsWith('//') ||
    raw.startsWith('\\\\');
  return {
    windows,
    impl: windows ? nodePath.win32 : nodePath.posix,
    input: windows ? raw : raw.replaceAll('\\', '/'),
  };
}

export default function setupPathPropertyTests(): void {
  testProperty(
    'path operations return stable POSIX-only strings',
    rawPathArbitrary(),
    (raw) => {
      const once = path.normalize(raw);
      assertEquals(once.includes('\\'), false, raw);
      assertEquals(path.normalize(once), once, raw);
      for (
        const output of [
          path.join(raw, raw),
          path.relative(raw, raw),
          path.dirname(raw),
          path.parsePath(raw),
          path.toAbsolutePath(raw),
        ]
      ) {
        assertEquals(output.includes('\\'), false, `${raw} -> ${output}`);
      }
    },
  );

  testProperty(
    'rooted paths never climb above their root',
    pathParts(fc.constantFrom(...kRoots)),
    ([root, segments, separator, trailing]) => {
      const raw = composePath(root, segments, separator, trailing);
      const normalized = path.normalize(raw);
      const joined = path.join(root, ...segments);
      assertEquals(path.isWithin(path.normalize(root), joined), true, raw);
      assertEquals(path.isRoot(joined), path.isRoot(normalized), raw);
      assertEquals(path.isWithin(path.normalize(root), normalized), true, raw);
      assertEquals(normalized.split('/').includes('..'), false, raw);
    },
  );

  testProperty(
    'equals is symmetric and matches relative',
    fc.tuple(rawPathArbitrary(), rawPathArbitrary()),
    ([a, b]) => {
      assertEquals(path.equals(a, b), path.equals(b, a), `${a} ${b}`);
      assertEquals(path.equals(a, b), path.relative(a, b) === '', `${a} ${b}`);
    },
  );

  testProperty(
    'file URL round-trips absolute paths',
    rawPathArbitrary(),
    (raw) => {
      fc.pre(path.isAbsolute(raw));
      const normalized = path.normalize(raw);
      assertEquals(path.fromFileUrl(path.toFileUrl(normalized)), normalized);
    },
  );

  testProperty(
    'containment respects descendants and siblings',
    fc.tuple(kSegment, kSegment, kSegment),
    ([a, b, c]) => {
      const parent = path.join('/vendor', a, b);
      const child = path.join(parent, c);
      assertEquals(path.isWithin(parent, child), true, `${parent} ${child}`);
      assertEquals(path.relative(child, parent), '..');
      assertEquals(
        path.isWithin(parent, `${parent}-other`),
        false,
        `${parent} sibling`,
      );
      assertEquals(path.isWithin('C:/Vendor', 'c:/vendor/x'), true);
    },
  );

  nodeTest('path operations agree with the Node oracle', (nodePath) => {
    assertProperty(
      fc.property(rawPathArbitrary(), (raw) => {
        const { impl, input } = oracle(nodePath, raw);
        assertEquals(path.normalize(raw), toPosix(impl.normalize(input)), raw);
      }),
    );
    assertProperty(
      fc.property(rawPathArbitrary(), (raw) => {
        // Compare canonical inputs so leading '.'/'..' do not test cwd.
        const { impl, input } = oracle(nodePath, raw);
        const expected = toPosix(impl.dirname(impl.normalize(input)));
        assertEquals(path.dirname(raw), expected, raw);
      }),
    );
    assertProperty(
      fc.property(
        fc.tuple(rawPathArbitrary(), rawPathArbitrary()),
        ([from, to]) => {
          // Mixed families, cwd-resolved operands, and leading '..' are outside
          // the contract's single-path normalization.
          const fromOracle = oracle(nodePath, from);
          const toOracle = oracle(nodePath, to);
          if (fromOracle.windows !== toOracle.windows) return;
          if (path.isAbsolute(from) !== path.isAbsolute(to)) return;
          const [fromNorm, toNorm] = [from, to].map(path.normalize);
          if (
            [fromNorm, toNorm].some((p) => p === '..' || p.startsWith('../'))
          ) {
            return;
          }
          const expected = toPosix(
            fromOracle.impl.relative(fromOracle.input, toOracle.input),
          );
          assertEquals(path.relative(from, to), expected, `${from} -> ${to}`);
        },
      ),
    );
  });
}
