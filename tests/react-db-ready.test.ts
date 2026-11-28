import React from 'react';
import { act, create } from 'react-test-renderer';
import { assertEquals, withLogCapture } from './asserts.ts';
import { TEST } from './mod.ts';
import {
  GoatDBContext,
  useDBReady,
  useItem,
  useQuery,
} from '../react/hooks.ts';
import { GoatDB } from '../db/db.ts';
import { kSchemaUserStats } from '../cfds/base/schema.ts';
import { isBrowser } from '../base/common.ts';
import { blockedDBPath, waitForState } from './lifecycle-fixtures.ts';
const Probe = () => useDBReady();
const ItemProbe = () => {
  const item = useItem('/data/items/x');
  return item ? 'defined' : 'undefined';
};
const QueryProbe = () => {
  const q = useQuery({
    source: '/data/items',
    predicate: () => true,
  });
  return q ? 'open' : 'closed';
};
const mount = (
  db: GoatDB,
  child: React.ReactNode = React.createElement(Probe),
) => {
  let r!: ReturnType<typeof create>;
  act(() => {
    r = create(
      React.createElement(
        GoatDBContext.Provider,
        { value: { db } },
        child,
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
    assertEquals(text(late), 'closing', 'closing maps to closing');
    await act(async () => await closing);
    assertEquals(text(early), 'closed', 'mounted consumer sees closed');
    assertEquals(text(late), 'closed', 'late mount sees closed');
    [early, late].forEach((r) => r.unmount());
  });

  TEST('ReactDbReady', 'useDBReady maps failure to error', async (ctx) => {
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
  }, { skip: isBrowser() });

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

  TEST(
    'ReactDbReady',
    'useItem and useQuery survive close while mounted',
    async (ctx) => {
      const captured = await withLogCapture(async (logs) => {
        const db = await ctx.createDB('react-closed-hooks');
        await db.readyPromise();
        db.create('/data/items/x', kSchemaUserStats, {});
        const itemR = mount(db, React.createElement(ItemProbe));
        const queryR = mount(db, React.createElement(QueryProbe));
        assertEquals(text(itemR), 'defined', 'item readable before close');
        assertEquals(text(queryR), 'open', 'query open before close');
        await act(async () => await db.close());
        assertEquals(
          text(itemR),
          'undefined',
          'useItem returns undefined after close',
        );
        assertEquals(
          text(queryR),
          'closed',
          'useQuery returns a closed placeholder',
        );
        act(() => {
          itemR.unmount();
          queryR.unmount();
        });
        return logs;
      });
      assertEquals(
        captured.filter((e) =>
          e.severity === 'WARNING' && e.error === 'StorageError'
        ).length,
        0,
        'no StorageError warning during normal close',
      );
    },
  );
}
