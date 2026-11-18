import React from 'react';
import { act, create } from 'react-test-renderer';
import { assertEquals } from './asserts.ts';
import { TEST } from './mod.ts';
import { GoatDBContext, useDBReady } from '../react/hooks.ts';
import { GoatDB } from '../db/db.ts';
import { isBrowser } from '../base/common.ts';
import { blockedDBPath, waitForState } from './lifecycle-fixtures.ts';
const Probe = () => useDBReady();
const mount = (db: GoatDB) => {
  let r!: ReturnType<typeof create>;
  act(() => {
    r = create(
      React.createElement(
        GoatDBContext.Provider,
        { value: { db } },
        React.createElement(Probe),
      ),
    );
  });
  return r;
};
const text = (r: ReturnType<typeof mount>) => r.toJSON() as unknown;
export default function setup(): void {
  TEST('ReactDbReady', 'useDBReady tracks close while mounted', async (ctx) => {
    const db = await ctx.createDB('react-db-ready');
    await db.readyPromise();
    const early = mount(db);
    assertEquals(text(early), 'ready', 'ready before close');
    const closing = db.close();
    const late = mount(db); // while state is 'closing'
    await act(async () => await closing);
    assertEquals(text(early), 'error', 'mounted consumer sees close');
    assertEquals(text(late), 'error', 'late mount sees close');
    [early, late].forEach((r) => r.unmount());
  });

  TEST('ReactDbReady', 'useDBReady maps failure to error', async (ctx) => {
    if (isBrowser()) return; // OPFS has no "path occupied by a file" failure
    const dir = await ctx.tempDir('react-db-failed');
    const dbPath = await blockedDBPath(dir, 'not-a-directory');
    const db = new GoatDB({ path: dbPath, orgId: 'test-org' });
    const rendered = mount(db);
    try {
      assertEquals(text(rendered), 'loading', 'booting maps to loading');
      await waitForState(db, 'failed');
      await act(async () => {});
      assertEquals(text(rendered), 'error', 'failed maps to error');
    } finally {
      rendered.unmount();
      await db.close().catch(() => {});
    }
  });

  TEST(
    'ReactDbReady',
    'does not leak lifecycle listeners across mount/unmount',
    async (ctx) => {
      const db = await ctx.createDB('react-db-ready-leak');
      await db.readyPromise();
      const baseline = db.listenerCount('LifecycleChanged');
      for (let i = 0; i < 5; i++) {
        const rendered = mount(db);
        assertEquals(
          db.listenerCount('LifecycleChanged'),
          baseline + 1,
          'mount adds one listener',
        );
        act(() => {
          rendered.unmount();
        });
        assertEquals(
          db.listenerCount('LifecycleChanged'),
          baseline,
          'unmount releases listener',
        );
      }
    },
  );
}
