import { DataRegistry } from '../cfds/base/data-registry.ts';
import { assertEquals } from './asserts.ts';
import { TEST } from './mod.ts';
import { Query } from '../repo/query.ts';

const kSchema = {
  ns: 'live-query-test',
  version: 1,
  fields: {
    value: { type: 'number', default: () => 0 },
  },
} as const;

const kDateSchema = {
  ns: 'live-query-date-test',
  version: 1,
  fields: {
    date: { type: 'date', required: true },
  },
} as const;

const kBoolSchema = {
  ns: 'live-query-bool-test',
  version: 1,
  fields: {
    flag: { type: 'boolean', required: true },
  },
} as const;

const kRegistry = new DataRegistry();
kRegistry.registerSchema(kSchema);
kRegistry.registerSchema(kDateSchema);
kRegistry.registerSchema(kBoolSchema);

export default function setup(): void {
  TEST(
    'LiveQuery',
    'membership updates synchronously on set()',
    async (ctx) => {
      const db = await ctx.createDB('live-query-membership', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();

        assertEquals(query.count, 1);

        // Edit item so it no longer matches — should drop synchronously
        item.set('value', 1);
        assertEquals(query.count, 0);

        // Edit item back — should be included synchronously
        item.set('value', 20);
        assertEquals(query.count, 1);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('LiveQuery', 'liveUpdates:false delays until commit', async (ctx) => {
    const db = await ctx.createDB('live-query-no-live', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const item = db.create('/data/items/item1', kSchema, { value: 10 });
      await item.commit();

      const query = new Query({
        db,
        source: '/data/items',
        predicate: ({ item }) => item.get('value') > 5,
        schema: kSchema,
        liveUpdates: false,
      });
      await query.loadingFinished();

      assertEquals(query.count, 1);

      // Edit item so it no longer matches
      item.set('value', 1);
      // Without live updates, count should still be 1 (stale until commit)
      assertEquals(query.count, 1);

      // After explicit commit, query updates
      await item.commit();
      assertEquals(query.count, 0);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'LiveQuery',
    'valueForPath returns live state for open items',
    async (ctx) => {
      const db = await ctx.createDB('live-query-value', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
        });
        await query.loadingFinished();

        assertEquals(query.count, 1);

        // Mutate without committing
        item.set('value', 99);
        const live = query.valueForPath('/data/items/item1');
        assertEquals(live?.get('value'), 99);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'sort order updates synchronously on set()',
    async (ctx) => {
      const db = await ctx.createDB('live-query-sort', { registry: kRegistry });
      try {
        await db.readyPromise();
        const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
        const item2 = db.create('/data/items/item2', kSchema, { value: 20 });
        const item3 = db.create('/data/items/item3', kSchema, { value: 30 });
        await item1.commit();
        await item2.commit();
        await item3.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
        });
        await query.loadingFinished();

        assertEquals(
          query.results().map((it) => it.get('value')),
          [10, 20, 30],
        );

        item1.set('value', 50);
        assertEquals(
          query.results().map((it) => it.get('value')),
          [20, 30, 50],
        );

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('LiveQuery', 'new item created while query is open', async (ctx) => {
    const db = await ctx.createDB('live-query-new-item', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
      await item1.commit();

      const query = new Query({
        db,
        source: '/data/items',
        predicate: ({ item }) => item.get('value') > 5,
        schema: kSchema,
      });
      await query.loadingFinished();

      assertEquals(query.count, 1);

      db.create('/data/items/item2', kSchema, { value: 20 });
      assertEquals(query.count, 2);

      db.create('/data/items/item3', kSchema, { value: 1 });
      assertEquals(query.count, 2);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'multiple items flip in/out of predicate', async (ctx) => {
    const db = await ctx.createDB('live-query-flip', { registry: kRegistry });
    try {
      await db.readyPromise();
      const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
      const item2 = db.create('/data/items/item2', kSchema, { value: 3 });
      const item3 = db.create('/data/items/item3', kSchema, { value: 8 });
      await item1.commit();
      await item2.commit();
      await item3.commit();

      const query = new Query({
        db,
        source: '/data/items',
        predicate: ({ item }) => item.get('value') > 5,
        schema: kSchema,
      });
      await query.loadingFinished();

      assertEquals(query.count, 2);

      item2.set('value', 7);
      assertEquals(query.count, 3);
      assertEquals(query.has('/data/items/item2'), true);

      item1.set('value', 2);
      assertEquals(query.count, 2);
      assertEquals(query.has('/data/items/item1'), false);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'limit returns correct top-N', async (ctx) => {
    const db = await ctx.createDB('live-query-limit', { registry: kRegistry });
    try {
      await db.readyPromise();
      for (const v of [10, 20, 30, 40, 50]) {
        const it = db.create(`/data/items/item${v}`, kSchema, { value: v });
        await it.commit();
      }

      const query = new Query({
        db,
        source: '/data/items',
        schema: kSchema,
        sortBy: 'value',
        limit: 3,
      });
      await query.loadingFinished();

      assertEquals(query.results().length, 3);
      assertEquals(
        query.results().map((it) => it.get('value')),
        [10, 20, 30],
      );

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'LiveQuery',
    'liveUpdates:false — valueForPath returns committed state',
    async (ctx) => {
      const db = await ctx.createDB('live-query-vfp-no-live', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          liveUpdates: false,
        });
        await query.loadingFinished();

        item.set('value', 99);
        assertEquals(query.valueForPath('/data/items/item1')?.get('value'), 10);

        await item.commit();
        assertEquals(query.valueForPath('/data/items/item1')?.get('value'), 99);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'sort + limit interaction after live mutation',
    async (ctx) => {
      const db = await ctx.createDB('live-query-sort-limit', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const items: ReturnType<typeof db.create>[] = [];
        for (const v of [10, 20, 30, 40, 50]) {
          const it = db.create(`/data/items/item${v}`, kSchema, { value: v });
          await it.commit();
          items.push(it);
        }

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
          limit: 3,
        });
        await query.loadingFinished();

        assertEquals(
          query.results().map((it) => it.get('value')),
          [10, 20, 30],
        );

        items[0].set('value', 100); // item10 → 100, should drop out of top-3
        assertEquals(
          query.results().map((it) => it.get('value')),
          [20, 30, 40],
        );

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('LiveQuery', 'isDeleted removes item from live query', async (ctx) => {
    const db = await ctx.createDB('live-query-deleted', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
      const item2 = db.create('/data/items/item2', kSchema, { value: 20 });
      await item1.commit();
      await item2.commit();

      const query = new Query({ db, source: '/data/items', schema: kSchema });
      await query.loadingFinished();

      assertEquals(query.count, 2);

      item1.isDeleted = true;
      assertEquals(query.count, 1);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'chained query propagates live updates', async (ctx) => {
    const db = await ctx.createDB('live-query-chain', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const item = db.create('/data/items/item1', kSchema, { value: 10 });
      await item.commit();

      const base = new Query({
        db,
        source: '/data/items',
        predicate: ({ item }) => item.get('value') > 0,
        schema: kSchema,
      });
      const derived = new Query({
        db,
        source: base,
        predicate: ({ item }) => item.get('value') > 5,
        schema: kSchema,
      });
      await base.loadingFinished();
      await derived.loadingFinished();

      assertEquals(derived.count, 1);

      // Edit item to fall below both thresholds
      item.set('value', -1);
      assertEquals(base.count, 0);
      assertEquals(derived.count, 0);

      derived.close();
      base.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'LiveQuery',
    'concurrent mutations in same sync block',
    async (ctx) => {
      const db = await ctx.createDB('live-query-concurrent', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const a = db.create('/data/items/a', kSchema, { value: 10 });
        const b = db.create('/data/items/b', kSchema, { value: 10 });
        const c = db.create('/data/items/c', kSchema, { value: 10 });
        await Promise.all([a.commit(), b.commit(), c.commit()]);

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();
        assertEquals(query.count, 3);

        // Mutate all three synchronously
        a.set('value', 1);
        b.set('value', 1);
        c.set('value', 1);

        assertEquals(query.count, 0);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('LiveQuery', 'mutations after close() are ignored', async (ctx) => {
    const db = await ctx.createDB('live-query-after-close', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const item = db.create('/data/items/item1', kSchema, { value: 10 });
      await item.commit();

      const query = new Query({
        db,
        source: '/data/items',
        predicate: ({ item }) => item.get('value') > 5,
        schema: kSchema,
      });
      await query.loadingFinished();
      assertEquals(query.count, 1);

      query.close();

      // Mutation after close should not change query state
      item.set('value', 1);
      assertEquals(query.count, 1);
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'LiveQuery',
    'rapid mutations on same item converge to final state',
    async (ctx) => {
      const db = await ctx.createDB('live-query-rapid', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();
        assertEquals(query.count, 1);

        // Rapid mutations: in, out, in
        item.set('value', 1);
        item.set('value', 3);
        item.set('value', 20);

        // Should be in once, not duplicated
        assertEquals(query.count, 1);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'multiple queries on same repo are independent',
    async (ctx) => {
      const db = await ctx.createDB('live-query-independent', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const high = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 15,
          schema: kSchema,
        });
        const low = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await high.loadingFinished();
        await low.loadingFinished();

        assertEquals(high.count, 0);
        assertEquals(low.count, 1);

        item.set('value', 20);
        assertEquals(high.count, 1);
        assertEquals(low.count, 1);

        item.set('value', 8);
        assertEquals(high.count, 0);
        assertEquals(low.count, 1);

        high.close();
        low.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'chained query: item exits derived but stays in base',
    async (ctx) => {
      const db = await ctx.createDB('live-query-chain-partial', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 20 });
        await item.commit();

        const base = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 0,
          schema: kSchema,
        });
        const derived = new Query({
          db,
          source: base,
          predicate: ({ item }) => item.get('value') > 10,
          schema: kSchema,
        });
        await base.loadingFinished();
        await derived.loadingFinished();

        assertEquals(base.count, 1);
        assertEquals(derived.count, 1);

        // Mutate to 5: stays in base (> 0), exits derived (> 10)
        item.set('value', 5);
        assertEquals(base.count, 1);
        assertEquals(derived.count, 0);

        derived.close();
        base.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'limit equal to dataset size returns all items',
    async (ctx) => {
      const db = await ctx.createDB('live-query-limit-exact', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const a = db.create('/data/items/a', kSchema, { value: 1 });
        const b = db.create('/data/items/b', kSchema, { value: 2 });
        const c = db.create('/data/items/c', kSchema, { value: 3 });
        await Promise.all([a.commit(), b.commit(), c.commit()]);

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
          limit: 3,
        });
        await query.loadingFinished();
        assertEquals(query.count, 3);

        // Mutate — still 3 items, limit still satisfied
        a.set('value', 10);
        assertEquals(query.count, 3);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('LiveQuery', 'empty repository returns zero results', async (ctx) => {
    const db = await ctx.createDB('live-query-empty', { registry: kRegistry });
    try {
      await db.readyPromise();

      const query = new Query({ db, source: '/data/items', schema: kSchema });
      await query.loadingFinished();

      assertEquals(query.count, 0);
      assertEquals(query.results().length, 0);
      assertEquals(query.has('/data/items/nonexistent'), false);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'sortDescending reverses sort order', async (ctx) => {
    const db = await ctx.createDB('live-query-desc', { registry: kRegistry });
    try {
      await db.readyPromise();
      const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
      const item2 = db.create('/data/items/item2', kSchema, { value: 20 });
      const item3 = db.create('/data/items/item3', kSchema, { value: 30 });
      await item1.commit();
      await item2.commit();
      await item3.commit();

      const query = new Query({
        db,
        source: '/data/items',
        schema: kSchema,
        sortBy: 'value',
        sortDescending: true,
      });
      await query.loadingFinished();

      assertEquals(
        query.results().map((it) => it.get('value')),
        [30, 20, 10],
      );

      item3.set('value', 5);
      assertEquals(
        query.results().map((it) => it.get('value')),
        [20, 10, 5],
      );

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'LiveQuery',
    'has() is false for non-member and nonexistent paths',
    async (ctx) => {
      const db = await ctx.createDB('live-query-has-nonmember', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const included = db.create('/data/items/included', kSchema, {
          value: 10,
        });
        const excluded = db.create('/data/items/excluded', kSchema, {
          value: 1,
        });
        await included.commit();
        await excluded.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();

        assertEquals(query.count, 1);
        assertEquals(query.has('/data/items/included'), true);
        assertEquals(query.has('/data/items/excluded'), false);
        assertEquals(query.has('/data/items/nonexistent'), false);
        assertEquals(query.valueForPath('/data/items/nonexistent'), undefined);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'predicate and sort combined filters then orders',
    async (ctx) => {
      const db = await ctx.createDB('live-query-pred-sort', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const items: ReturnType<typeof db.create>[] = [];
        for (
          const [id, v] of [['a', 5], ['b', 15], ['c', 25], ['d', 3], [
            'e',
            35,
          ]] as [string, number][]
        ) {
          const it = db.create(`/data/items/${id}`, kSchema, { value: v });
          await it.commit();
          items.push(it);
        }

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 10,
          schema: kSchema,
          sortBy: 'value',
        });
        await query.loadingFinished();

        assertEquals(
          query.results().map((it) => it.get('value')),
          [15, 25, 35],
        );

        items[0].set('value', 20); // item 'a': 5 → 20, now > 10
        assertEquals(
          query.results().map((it) => it.get('value')),
          [15, 20, 25, 35],
        );

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'isDeleted with liveUpdates:false defers removal until commit',
    async (ctx) => {
      const db = await ctx.createDB('live-query-deleted-no-live', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          liveUpdates: false,
        });
        await query.loadingFinished();

        assertEquals(query.count, 1);

        item.isDeleted = true;
        // Deferred mode: deletion not yet reflected
        assertEquals(query.count, 1);

        await item.commit();
        assertEquals(query.count, 0);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'sort stability: equal keys preserve count',
    async (ctx) => {
      const db = await ctx.createDB('live-query-sort-stable', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
        const item2 = db.create('/data/items/item2', kSchema, { value: 10 });
        const item3 = db.create('/data/items/item3', kSchema, { value: 10 });
        await item1.commit();
        await item2.commit();
        await item3.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
        });
        await query.loadingFinished();

        assertEquals(query.count, 3);

        // Re-set to the same value — should not add or remove items
        item2.set('value', 10);
        assertEquals(query.count, 3);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('LiveQuery', 'find() returns item by sort field', async (ctx) => {
    const db = await ctx.createDB('live-query-find', { registry: kRegistry });
    try {
      await db.readyPromise();
      const items: ReturnType<typeof db.create>[] = [];
      for (const v of [10, 20, 30, 40, 50]) {
        const it = db.create(`/data/items/item${v}`, kSchema, { value: v });
        await it.commit();
        items.push(it);
      }

      const query = new Query({
        db,
        source: '/data/items',
        schema: kSchema,
        sortBy: 'value',
      });
      await query.loadingFinished();

      assertEquals(query.find('value', 30)?.get('value'), 30);
      assertEquals(query.find('value', 99), undefined);

      items[2].set('value', 35); // item30 → 35
      assertEquals(query.find('value', 30), undefined);
      assertEquals(query.find('value', 35)?.get('value'), 35);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'find() matches epsilon-equal sort values', async (ctx) => {
    const db = await ctx.createDB('live-query-find-epsilon', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      for (const value of [0, 1, 2]) {
        const item = db.create(`/data/items/item${value}`, kSchema, { value });
        await item.commit();
      }

      const query = new Query({
        db,
        source: '/data/items',
        schema: kSchema,
        sortBy: 'value',
      });
      await query.loadingFinished();

      assertEquals(query.find('value', Number.EPSILON / 2)?.get('value'), 0);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'LiveQuery',
    'find() descending epsilon-equal sort values',
    async (ctx) => {
      const db = await ctx.createDB('live-query-find-epsilon-desc', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        for (const value of [0, 1, 2]) {
          const item = db.create(`/data/items/item${value}`, kSchema, {
            value,
          });
          await item.commit();
        }

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
          sortDescending: true,
        });
        await query.loadingFinished();

        // Descending order: [2, 1, 0]. Epsilon-neighborhood of 0 matches item with value 0.
        assertEquals(query.find('value', Number.EPSILON / 2)?.get('value'), 0);
        // Epsilon-neighborhood of 1 matches item with value 1.
        assertEquals(
          query.find('value', 1 + Number.EPSILON / 2)?.get('value'),
          1,
        );

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('LiveQuery', 'find() Invalid Date returns undefined', async (ctx) => {
    const db = await ctx.createDB('live-query-find-invalid-date', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      // WHY: compare clusters Invalid==Invalid for ordering, but equals says distinct Invalid != Invalid.
      const invalidA = db.create('/data/items/inv-a', kDateSchema, {
        date: new Date('invalid'),
      });
      const invalidB = db.create('/data/items/inv-b', kDateSchema, {
        date: new Date('invalid'),
      });
      const valid = db.create('/data/items/valid', kDateSchema, {
        date: new Date('2024-06-15T12:00:00.000Z'),
      });
      await invalidA.commit();
      await invalidB.commit();
      await valid.commit();

      const query = new Query({
        db,
        source: '/data/items',
        schema: kDateSchema,
        sortBy: 'date',
      });
      await query.loadingFinished();

      assertEquals(query.count, 3);
      // Distinct Invalid Date instance: equals rejects NaN != NaN.
      assertEquals(query.find('date', new Date('invalid')), undefined);
      // Valid date still found.
      assertEquals(
        query.find('date', new Date('2024-06-15T12:00:00.000Z'))?.get('date')
          .getTime(),
        new Date('2024-06-15T12:00:00.000Z').getTime(),
      );

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'find() sorted Date lookup', async (ctx) => {
    const db = await ctx.createDB('live-query-find-date-sorted', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const dates = [
        new Date('2024-01-03T00:00:00.000Z'),
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-02T00:00:00.000Z'),
      ];
      for (const [index, date] of dates.entries()) {
        const item = db.create(`/data/items/item${index}`, kDateSchema, {
          date,
        });
        await item.commit();
      }

      const query = new Query({
        db,
        source: '/data/items',
        schema: kDateSchema,
        sortBy: 'date',
      });
      await query.loadingFinished();

      // Ascending sort: earliest first.
      assertEquals(
        query.results().map((item) => item.get('date').getTime()),
        [dates[1], dates[2], dates[0]].map((date) => date.getTime()),
      );
      // Boundaries: first and last via find.
      assertEquals(
        query.find('date', new Date(dates[1].getTime()))?.get('date')
          .getTime(),
        dates[1].getTime(),
      );
      assertEquals(
        query.find('date', new Date(dates[0].getTime()))?.get('date')
          .getTime(),
        dates[0].getTime(),
      );
      assertEquals(
        query.find('date', new Date(dates[2].getTime()))?.get('date')
          .getTime(),
        dates[2].getTime(),
      );
      // Miss returns undefined (binary search + equals verification).
      assertEquals(
        query.find('date', new Date('2099-01-01T00:00:00.000Z')),
        undefined,
      );

      // Duplicate timestamp: live addition with same getTime as middle date.
      const dupDate = new Date(dates[2].getTime());
      const dupItem = db.create('/data/items/dup', kDateSchema, {
        date: dupDate,
      });
      await dupItem.commit();
      assertEquals(query.count, 4);
      assertEquals(
        query.find('date', dupDate)?.get('date').getTime(),
        dupDate.getTime(),
      );

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'find() descending Date lookup', async (ctx) => {
    const db = await ctx.createDB('live-query-find-date-desc', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const dates = [
        new Date('2024-01-03T00:00:00.000Z'),
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-02T00:00:00.000Z'),
      ];
      for (const [index, date] of dates.entries()) {
        const item = db.create(`/data/items/item${index}`, kDateSchema, {
          date,
        });
        await item.commit();
      }

      const query = new Query({
        db,
        source: '/data/items',
        schema: kDateSchema,
        sortBy: 'date',
        sortDescending: true,
      });
      await query.loadingFinished();

      // Descending sort: latest first.
      assertEquals(
        query.results().map((item) => item.get('date').getTime()),
        [dates[0], dates[2], dates[1]].map((date) => date.getTime()),
      );
      // Boundaries: first (latest) and last (earliest) via find.
      assertEquals(
        query.find('date', new Date(dates[0].getTime()))?.get('date')
          .getTime(),
        dates[0].getTime(),
      );
      assertEquals(
        query.find('date', new Date(dates[1].getTime()))?.get('date')
          .getTime(),
        dates[1].getTime(),
      );
      // Miss returns undefined.
      assertEquals(
        query.find('date', new Date('2099-01-01T00:00:00.000Z')),
        undefined,
      );

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'find() unsorted Date scan', async (ctx) => {
    const db = await ctx.createDB('live-query-find-date-unsorted', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const dates = [
        new Date('2024-01-03T00:00:00.000Z'),
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-02T00:00:00.000Z'),
      ];
      for (const [index, date] of dates.entries()) {
        const item = db.create(`/data/items/item${index}`, kDateSchema, {
          date,
        });
        await item.commit();
      }

      const query = new Query({
        db,
        source: '/data/items',
        schema: kDateSchema,
      });
      await query.loadingFinished();

      // Unsorted path uses linear scan with coreValueEquals; find via new Date instance.
      assertEquals(
        query.find('date', new Date(dates[0].getTime()))?.get('date')
          .getTime(),
        dates[0].getTime(),
      );
      assertEquals(
        query.find('date', new Date(dates[1].getTime()))?.get('date')
          .getTime(),
        dates[1].getTime(),
      );
      // Miss returns undefined.
      assertEquals(
        query.find('date', new Date('2099-01-01T00:00:00.000Z')),
        undefined,
      );

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'find() Date duplicate timestamp', async (ctx) => {
    const db = await ctx.createDB('live-query-find-date-dup', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const instant = new Date('2024-06-15T12:00:00.000Z');
      const dupA = db.create('/data/items/a', kDateSchema, {
        date: new Date(instant.getTime()),
      });
      const dupB = db.create('/data/items/b', kDateSchema, {
        date: new Date(instant.getTime()),
      });
      await dupA.commit();
      await dupB.commit();

      const query = new Query({
        db,
        source: '/data/items',
        schema: kDateSchema,
        sortBy: 'date',
      });
      await query.loadingFinished();

      // Two items share same getTime: count 2, find returns one with matching getTime.
      assertEquals(query.count, 2);
      assertEquals(
        query.find('date', new Date(instant.getTime()))?.get('date')
          .getTime(),
        instant.getTime(),
      );
      // Miss: 2099 date doesn't match any stored dates
      assertEquals(
        query.find('date', new Date('2099-01-01T00:00:00.000Z')),
        undefined,
      );
      assertEquals(query.find('date', new Date('invalid')), undefined);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'find() Date empty and single boundaries', async (ctx) => {
    const db = await ctx.createDB('live-query-find-date-boundaries', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();

      // Empty repo: find miss.
      const emptyQuery = new Query({
        db,
        source: '/data/items',
        schema: kDateSchema,
        sortBy: 'date',
      });
      await emptyQuery.loadingFinished();
      assertEquals(emptyQuery.count, 0);
      assertEquals(
        emptyQuery.find('date', new Date('2024-01-01T00:00:00.000Z')),
        undefined,
      );
      emptyQuery.close();

      // Single item: first==last.
      const onlyDate = new Date('2024-01-01T00:00:00.000Z');
      const only = db.create('/data/items/only', kDateSchema, {
        date: onlyDate,
      });
      await only.commit();

      const singleAsc = new Query({
        db,
        source: '/data/items',
        schema: kDateSchema,
        sortBy: 'date',
      });
      await singleAsc.loadingFinished();
      assertEquals(singleAsc.count, 1);
      assertEquals(
        singleAsc.find('date', new Date(onlyDate.getTime()))?.get('date')
          .getTime(),
        onlyDate.getTime(),
      );
      assertEquals(
        singleAsc.find('date', new Date('2099-01-01T00:00:00.000Z')),
        undefined,
      );
      singleAsc.close();

      const singleDesc = new Query({
        db,
        source: '/data/items',
        schema: kDateSchema,
        sortBy: 'date',
        sortDescending: true,
      });
      await singleDesc.loadingFinished();
      assertEquals(singleDesc.count, 1);
      assertEquals(
        singleDesc.find('date', new Date(onlyDate.getTime()))?.get('date')
          .getTime(),
        onlyDate.getTime(),
      );
      singleDesc.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'find() NaN returns undefined', async (ctx) => {
    const db = await ctx.createDB('live-query-find-nan', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      // Store NaN in sorted number field.
      const nanItem = db.create('/data/items/nan', kSchema, { value: NaN });
      await nanItem.commit();
      const zeroItem = db.create('/data/items/zero', kSchema, { value: 0 });
      await zeroItem.commit();

      const query = new Query({
        db,
        source: '/data/items',
        schema: kSchema,
        sortBy: 'value',
      });
      await query.loadingFinished();

      // WHY: compare clusters NaN==NaN for ordering, but equals says distinct NaN != NaN.
      // find() must return undefined when searching for NaN.
      assertEquals(query.find('value', NaN), undefined);
      // Valid number still found.
      assertEquals(query.find('value', 0)?.get('value'), 0);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST('LiveQuery', 'find() Boolean sorted lookup', async (ctx) => {
    const db = await ctx.createDB('live-query-find-bool', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const falseItem = db.create('/data/items/false', kBoolSchema, {
        flag: false,
      });
      await falseItem.commit();
      const trueItem = db.create('/data/items/true', kBoolSchema, {
        flag: true,
      });
      await trueItem.commit();

      const query = new Query({
        db,
        source: '/data/items',
        schema: kBoolSchema,
        sortBy: 'flag',
      });
      await query.loadingFinished();

      // Ascending sort: false < true.
      assertEquals(query.results()[0].get('flag'), false);
      assertEquals(query.results()[1].get('flag'), true);
      // find() both values.
      assertEquals(query.find('flag', false)?.get('flag'), false);
      assertEquals(query.find('flag', true)?.get('flag'), true);
      // Miss: no third boolean value.
      assertEquals(query.find('flag', 'not-a-boolean' as any), undefined);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'LiveQuery',
    'onResultsChanged fires on membership change',
    async (ctx) => {
      const db = await ctx.createDB('live-query-orc-membership', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();

        let count = 0;
        const cleanup = query.onResultsChanged(() => {
          count++;
        });

        item.set('value', 1); // exits predicate
        assertEquals(count, 1);

        item.set('value', 20); // enters predicate
        assertEquals(count, 2);

        cleanup();
        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'onResultsChanged fires on sort-only change',
    async (ctx) => {
      const db = await ctx.createDB('live-query-orc-sort', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
        const item2 = db.create('/data/items/item2', kSchema, { value: 20 });
        await item1.commit();
        await item2.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
        });
        await query.loadingFinished();

        let count = 0;
        const cleanup = query.onResultsChanged(() => {
          count++;
        });

        item1.set('value', 30); // still in, but sort position changes
        assertEquals(count, 1);

        cleanup();
        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'onResultsChanged fires on any value change (enables chained queries)',
    async (ctx) => {
      const db = await ctx.createDB('live-query-orc-value-change', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        // No predicate, no sortBy — value change keeps item in results
        const query = new Query({ db, source: '/data/items', schema: kSchema });
        await query.loadingFinished();

        let count = 0;
        const cleanup = query.onResultsChanged(() => {
          count++;
        });

        // Value changes always propagate so that chained derived queries can
        // re-evaluate their own predicates.
        item.set('value', 20);
        assertEquals(count, 1);

        cleanup();
        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('LiveQuery', 'onResultsChanged cleanup stops callbacks', async (ctx) => {
    const db = await ctx.createDB('live-query-orc-cleanup', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const item = db.create('/data/items/item1', kSchema, { value: 10 });
      await item.commit();

      const query = new Query({
        db,
        source: '/data/items',
        predicate: ({ item }) => item.get('value') > 5,
        schema: kSchema,
      });
      await query.loadingFinished();

      let count = 0;
      const cleanup = query.onResultsChanged(() => {
        count++;
      });

      item.set('value', 1); // exits predicate — fires
      assertEquals(count, 1);

      cleanup(); // detach

      item.set('value', 20); // enters predicate — must NOT fire
      assertEquals(count, 1);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'LiveQuery',
    'close() prevents onResultsChanged callbacks',
    async (ctx) => {
      const db = await ctx.createDB('live-query-orc-close', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();

        let count = 0;
        query.onResultsChanged(() => {
          count++;
        });

        item.set('value', 1); // fires
        assertEquals(count, 1);

        query.close();

        item.set('value', 20); // query closed — must NOT fire
        assertEquals(count, 1);
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'set-commit-set-commit cycle maintains consistency',
    async (ctx) => {
      const db = await ctx.createDB('live-query-commit-cycle', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();
        assertEquals(query.count, 1);

        item.set('value', 1); // exits
        assertEquals(query.count, 0);
        await item.commit();
        assertEquals(query.count, 0);

        item.set('value', 20); // enters
        assertEquals(query.count, 1);
        await item.commit();
        assertEquals(query.count, 1);

        assertEquals(query.valueForPath('/data/items/item1')?.get('value'), 20);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'rebase after commit does not double-count',
    async (ctx) => {
      const db = await ctx.createDB('live-query-rebase-guard', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();
        assertEquals(query.count, 1);

        let count = 0;
        query.onResultsChanged(() => {
          count++;
        });

        item.set('value', 1); // exits predicate
        assertEquals(query.count, 0);
        assertEquals(count, 1);

        await item.commit(); // rebase — must NOT double-count
        assertEquals(query.count, 0);
        assertEquals(count, 1);

        item.set('value', 20); // enters predicate
        assertEquals(query.count, 1);
        assertEquals(count, 2);

        await item.commit(); // rebase again — must NOT double-count
        assertEquals(query.count, 1);
        assertEquals(count, 2);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'find() with sortDescending uses correct search direction',
    async (ctx) => {
      const db = await ctx.createDB('live-query-find-desc', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
        const item2 = db.create('/data/items/item2', kSchema, { value: 20 });
        const item3 = db.create('/data/items/item3', kSchema, { value: 30 });
        await item1.commit();
        await item2.commit();
        await item3.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
          sortDescending: true,
        });
        await query.loadingFinished();

        assertEquals(query.find('value', 20)?.get('value'), 20);
        assertEquals(query.find('value', 99), undefined);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'multiple onResultsChanged listeners all fire',
    async (ctx) => {
      const db = await ctx.createDB('live-query-multi-listener', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();

        let a = 0, b = 0, c = 0;
        const cleanA = query.onResultsChanged(() => {
          a++;
        });
        const cleanB = query.onResultsChanged(() => {
          b++;
        });
        const cleanC = query.onResultsChanged(() => {
          c++;
        });

        item.set('value', 1); // exits predicate
        assertEquals(a, 1);
        assertEquals(b, 1);
        assertEquals(c, 1);

        item.set('value', 20); // re-enters
        assertEquals(a, 2);
        assertEquals(b, 2);
        assertEquals(c, 2);

        cleanA();
        cleanB();
        cleanC();
        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'throwing callback does not suppress subsequent callbacks',
    async (ctx) => {
      const db = await ctx.createDB('live-query-throw-callback', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        await query.loadingFinished();

        let afterThrow = 0;
        query.onResultsChanged(() => {
          throw new Error('intentional');
        });
        query.onResultsChanged(() => {
          afterThrow++;
        });

        let threw = false;
        try {
          item.set('value', 1); // exits predicate, triggers callbacks
        } catch (_e) {
          threw = true;
        }

        // Emitter isolates errors: exception is logged, does not propagate to
        // set() caller, and subsequent callbacks still fire.
        assertEquals(threw, false);
        assertEquals(afterThrow, 1);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'liveUpdates:false + sortBy — sort position defers until commit',
    async (ctx) => {
      const db = await ctx.createDB('live-query-no-live-sort', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
        const item2 = db.create('/data/items/item2', kSchema, { value: 20 });
        const item3 = db.create('/data/items/item3', kSchema, { value: 30 });
        await item1.commit();
        await item2.commit();
        await item3.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
          liveUpdates: false,
        });
        await query.loadingFinished();

        assertEquals(
          query.results().map((it) => it.get('value')),
          [10, 20, 30],
        );

        item1.set('value', 50);
        // liveUpdates:false defers sort re-computation: item1 stays at position 0
        // (sort order unchanged), but ManagedItem values are always live references
        // so calling .get() returns the current in-memory value (50).
        const preCommit = query.results();
        assertEquals(preCommit.length, 3);
        // item1 still occupies the first sort slot (sort not recomputed yet)
        assertEquals(preCommit[0].get('value'), 50); // live value, stale position
        assertEquals(preCommit[1].get('value'), 20);
        assertEquals(preCommit[2].get('value'), 30);

        await item1.commit();
        assertEquals(
          query.results().map((it) => it.get('value')),
          [20, 30, 50],
        );

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'limit:1 — smallest item replaced when it grows past limit',
    async (ctx) => {
      const db = await ctx.createDB('live-query-limit-one', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item1 = db.create('/data/items/item1', kSchema, { value: 10 });
        const item2 = db.create('/data/items/item2', kSchema, { value: 20 });
        const item3 = db.create('/data/items/item3', kSchema, { value: 30 });
        await item1.commit();
        await item2.commit();
        await item3.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
          limit: 1,
        });
        await query.loadingFinished();

        assertEquals(query.results().map((it) => it.get('value')), [10]);

        // Move smallest to largest — next-smallest should now be in limit window
        item1.set('value', 100);
        assertEquals(query.results().map((it) => it.get('value')), [20]);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('LiveQuery', 'un-deleting an item re-enters query', async (ctx) => {
    const db = await ctx.createDB('live-query-undelete', {
      registry: kRegistry,
    });
    try {
      await db.readyPromise();
      const item = db.create('/data/items/item1', kSchema, { value: 10 });
      await item.commit();

      const query = new Query({ db, source: '/data/items', schema: kSchema });
      await query.loadingFinished();

      assertEquals(query.count, 1);

      item.isDeleted = true;
      assertEquals(query.count, 0);

      // Un-delete — item should re-enter the query synchronously
      item.isDeleted = false;
      assertEquals(query.count, 1);
      assertEquals(query.has('/data/items/item1'), true);

      query.close();
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'LiveQuery',
    'sort stability — equal keys have no duplicates after re-set',
    async (ctx) => {
      const db = await ctx.createDB('live-query-stable-dup', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item1 = db.create('/data/items/item1', kSchema, { value: 5 });
        const item2 = db.create('/data/items/item2', kSchema, { value: 5 });
        const item3 = db.create('/data/items/item3', kSchema, { value: 5 });
        await item1.commit();
        await item2.commit();
        await item3.commit();

        const query = new Query({
          db,
          source: '/data/items',
          schema: kSchema,
          sortBy: 'value',
        });
        await query.loadingFinished();

        assertEquals(query.count, 3);

        // Re-set to the same value
        item2.set('value', 5);

        const results = query.results();
        assertEquals(results.length, 3);
        const paths = new Set(results.map((_, i) => query.results()[i]));
        assertEquals(paths.size, 3);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'find() returns undefined for item excluded by predicate',
    async (ctx) => {
      const db = await ctx.createDB('live-query-find-predicate', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const included = db.create('/data/items/included', kSchema, {
          value: 20,
        });
        const excluded = db.create('/data/items/excluded', kSchema, {
          value: 3,
        });
        await included.commit();
        await excluded.commit();

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 10,
          schema: kSchema,
          sortBy: 'value',
        });
        await query.loadingFinished();

        assertEquals(query.find('value', 3), undefined); // excluded
        assertEquals(query.find('value', 20)?.get('value'), 20); // included

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'liveUpdates:false chained — commit propagates through base to derived',
    async (ctx) => {
      const db = await ctx.createDB('live-query-chain-deferred', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 20 });
        await item.commit();

        // Both deferred: neither updates until item is committed
        const base = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
          liveUpdates: false,
        });
        const derived = new Query({
          db,
          source: base,
          predicate: ({ item }) => item.get('value') > 10,
          schema: kSchema,
          liveUpdates: false,
        });
        await base.loadingFinished();
        await derived.loadingFinished();

        assertEquals(base.count, 1);
        assertEquals(derived.count, 1);

        item.set('value', 3); // exits both thresholds
        // liveUpdates:false — nothing updates yet
        assertEquals(base.count, 1);
        assertEquals(derived.count, 1);

        await item.commit();
        // After commit: base updates (item exits base), base emits DocumentChanged,
        // derived receives it and also removes the item.
        assertEquals(base.count, 0);
        assertEquals(derived.count, 0);

        derived.close();
        base.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'chained deferred queries: value change stays in base but exits derived after commit',
    async (ctx) => {
      const db = await ctx.createDB('live-query-chain-value-propagate', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 20 });
        await item.commit();

        // Both deferred: neither reacts to uncommitted edits.
        // base emits DocumentChanged even when item stays in results (forceEmit),
        // so the derived query can re-evaluate against the new committed value.
        const base = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 0,
          schema: kSchema,
          liveUpdates: false,
        });
        const derived = new Query({
          db,
          source: base,
          predicate: ({ item }) => item.get('value') > 10,
          schema: kSchema,
          liveUpdates: false,
        });
        await base.loadingFinished();
        await derived.loadingFinished();

        assertEquals(base.count, 1);
        assertEquals(derived.count, 1);

        item.set('value', 5);
        // Before commit: both still see old committed state
        assertEquals(base.count, 1);
        assertEquals(derived.count, 1);

        await item.commit();
        // After commit: item stays in base (5 > 0), exits derived (5 < 10)
        assertEquals(base.count, 1);
        assertEquals(derived.count, 0);

        derived.close();
        base.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'liveUpdates:true scan accounts for pre-existing uncommitted edits',
    async (ctx) => {
      const db = await ctx.createDB('live-query-scan-live-edit', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        // Mutate item BEFORE creating the query — creates an uncommitted edit
        item.set('value', 99);

        const query = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 50,
          schema: kSchema,
        });
        await query.loadingFinished();

        // The scan should see the live (uncommitted) value 99, not the committed
        // value 10, so the item matches the predicate.
        assertEquals(query.count, 1);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'LiveQuery',
    'predicate that throws is caught by emitter and query state is preserved',
    async (ctx) => {
      const db = await ctx.createDB('live-query-pred-throw', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        const query = new Query({
          db,
          source: '/data/items',
          // predicate throws when value === 99
          predicate: ({ item }) => {
            if (item.get('value') === 99) throw new Error('bad value');
            return item.get('value') > 5;
          },
          schema: kSchema,
        });
        await query.loadingFinished();
        assertEquals(query.count, 1);

        let threw = false;
        try {
          item.set('value', 99);
        } catch (_e) {
          threw = true;
        }

        // The predicate runs inside an emitter callback (ItemChanged listener),
        // so Fix 1's try-catch absorbs the exception. set() does not throw.
        assertEquals(threw, false);
        // Query state is preserved: the throw occurred before any membership
        // change, so the item remains included.
        assertEquals(query.count, 1);

        query.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  // Verifies the FIFO ordering guarantee documented in query.ts: source query's
  // onItemChanged listener runs before the derived query's because source is
  // constructed first. When an item exits the base but the derived predicate
  // alone would keep it, the derived must still drop it (because it checks
  // source.has() which is already false when FIFO order holds).
  TEST(
    'LiveQuery',
    'chained query drops item when it exits base even if derived predicate passes',
    async (ctx) => {
      const db = await ctx.createDB('live-query-chain-fifo', {
        registry: kRegistry,
      });
      try {
        await db.readyPromise();
        const item = db.create('/data/items/item1', kSchema, { value: 10 });
        await item.commit();

        // base: strict filter; derived: looser filter that would keep value=3
        const base = new Query({
          db,
          source: '/data/items',
          predicate: ({ item }) => item.get('value') > 5,
          schema: kSchema,
        });
        const derived = new Query({
          db,
          source: base,
          predicate: ({ item }) => item.get('value') > 0,
          schema: kSchema,
        });
        await base.loadingFinished();
        await derived.loadingFinished();

        assertEquals(base.count, 1);
        assertEquals(derived.count, 1);

        // Mutate to 3: exits base (3 < 5) but derived predicate alone would
        // pass (3 > 0). Derived must still drop the item because source no
        // longer has it — relies on FIFO listener dispatch.
        item.set('value', 3);
        assertEquals(base.count, 0);
        assertEquals(derived.count, 0);

        derived.close();
        base.close();
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
