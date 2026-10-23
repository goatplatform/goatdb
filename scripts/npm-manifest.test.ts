import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type NpmManifest, productionManifest } from './npm-manifest.ts';

function manifest(exports?: NpmManifest['exports']): NpmManifest {
  return { name: '@goatdb/goatdb', exports };
}

/** Synthetic subpaths: this fixture must never mirror the real package map. */
test('npm manifest derives dist targets from export source paths', () => {
  const shipped = productionManifest(
    manifest({
      '.': './alpha.ts',
      './nested/entry': './nested/deep/entry.ts',
    }),
    '1.2.3',
  );
  assert.deepEqual(shipped.exports, {
    '.': { import: './dist/alpha.js', types: './dist/alpha.d.ts' },
    './nested/entry': {
      import: './dist/nested/deep/entry.js',
      types: './dist/nested/deep/entry.d.ts',
    },
  });
  assert.equal(shipped.version, '1.2.3');
});

test('npm manifest keeps non-export fields intact', () => {
  const shipped = productionManifest(
    { ...manifest({ './x': './x.ts' }), bin: { goatdb: './dist/cli/init.js' } },
    '0.0.1',
  );
  assert.deepEqual(shipped.bin, { goatdb: './dist/cli/init.js' });
});

for (
  const [label, exports, failure] of [
    ['missing exports', undefined, 'npm exports missing'],
    ['empty exports', {}, 'npm exports missing'],
    [
      'already transformed entry',
      { './x': { import: './dist/x.js', types: './dist/x.d.ts' } },
      "must be a './*.ts' source path",
    ],
    ['non-ts source', { './x': './x.js' }, "must be a './*.ts' source path"],
    ['extensionless source', { './x': './dist/x' }, 'must be a'],
    ['bare source', { './x': 'x.ts' }, 'must be a'],
    ['empty file name', { './x': './.ts' }, 'must be a'],
  ] as const
) {
  test(`npm manifest rejects ${label}`, () => {
    assert.throws(
      () =>
        productionManifest(
          manifest(exports as NpmManifest['exports']),
          '1.0.0',
        ),
      { message: new RegExp(failure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) },
    );
  });
}
