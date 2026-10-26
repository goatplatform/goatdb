/** DBInstanceConfig store-path contract. logout() removes the store root, so
 * empty/root paths must fail at construction, before filesystem code runs. */
import { GoatDB } from '../db/db.ts';
import * as path from '../base/path.ts';
import { assertEquals, assertThrowsWithMessage } from './asserts.ts';
import { TEST } from './mod.ts';

const kInvalidPaths = [
  '',
  '.',
  './data',
  'data',
  '..',
  '../data',
  '/',
  'C:/',
  '//server/share',
  // Absolute before normalization, but root after it. These reject a raw
  // string check and pin the parse-then-check order.
  '/data/..',
  'C:/data/..',
  '//server/share/..',
];

export default function setup(): void {
  TEST('DBConfig', 'rejects empty, relative, and root store paths', () => {
    for (const invalidPath of kInvalidPaths) {
      assertThrowsWithMessage(
        () => new GoatDB({ path: invalidPath }),
        'DBInstanceConfig.path',
      );
    }
  });

  TEST('DBConfig', 'normalizes an absolute store path once', async (ctx) => {
    const dir = await ctx.tempDir('normalize');
    const messy = `${dir}//./store/../store`;
    const expected = path.join(dir, 'store');
    const db = await ctx.createDB('normalize', { path: messy });
    // WHY: initialization is async. Without this wait, suite cleanup can delete
    // the store while initialization still scans it, causing an unhandled ENOENT.
    await db.readyPromise();
    try {
      assertEquals(db.path, expected);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });
}
