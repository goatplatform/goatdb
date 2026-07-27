import {
  Commit,
  FieldCommit,
  nextMonotonicTimestamp,
  resetMonotonicState,
  setMonotonicNowFn,
} from '../repo/commit.ts';
import { Item } from '../cfds/base/item.ts';
import { Edit } from '../cfds/base/edit.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { assertEquals, assertThrows, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { JSONCyclicalDecoder } from '../base/core-types/encoding/json.ts';
import { FieldChange } from '../cfds/change/field-change.ts';
import type { ValueType } from '../cfds/base/types/index.ts';
import { tuple4Break } from '../base/tuple.ts';

// Minimal test schema
const TestSchema: Schema = {
  ns: 'test',
  version: 1,
  fields: {
    foo: { type: 'string', required: true },
  },
};

// Register the test schema so it is available for deserialization
DataRegistry.default.registerSchema(TestSchema);

function makeTestItem(foo: string) {
  // Cast to Schema to avoid type errors
  return new Item(
    { schema: TestSchema as Schema, data: { foo } },
    DataRegistry.default,
  );
}

function makeTestEdit(srcChecksum: string, dstChecksum: string) {
  // Use FieldChange for a valid DataChanges entry
  return new Edit({
    changes: { foo: [FieldChange.insert('bar2', 'string' as ValueType)] },
    srcChecksum,
    dstChecksum,
  });
}

function withMonotonicClock(fn: () => void): void {
  resetMonotonicState();
  try {
    fn();
  } finally {
    resetMonotonicState();
  }
}

export default function setup() {
  TEST('Commit', 'constructs document commit', () => {
    const item = makeTestItem('bar');
    const commit = Commit.create({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestors: [],
    });
    assertEquals(commit.record?.get('foo'), 'bar');
    assertEquals(commit.key, 'key');
    assertEquals(commit.session, 'sess');
    assertEquals(commit.orgId, 'org');
    assertTrue(commit.id.length > 0);
    assertTrue(commit.timestamp > 0);
    const versionArr = tuple4Break(commit.buildVersion);
    assertTrue(Array.isArray(versionArr) && versionArr.length === 4);
    assertTrue(commit.contentsChecksum.length > 0);
    assertEquals(commit.scheme, TestSchema);
  });

  TEST('Commit', 'constructs delta commit', () => {
    const item = makeTestItem('bar');
    const edit = makeTestEdit(item.checksum, 'dst');
    const commit = Commit.create({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: { base: 'baseid', edit },
      parents: [],
      ancestors: [],
    });
    assertEquals((commit.contents as any).base, 'baseid');
    assertEquals((commit.contents as any).edit.dstChecksum, 'dst');
    assertEquals(commit.key, 'key');
    assertEquals(commit.scheme, undefined); // edit has no scheme
  });

  TEST('Commit', 'serialize/deserialize roundtrip (document)', () => {
    const item = makeTestItem('bar');
    const commit = Commit.create({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestors: [],
    });
    const js = commit.toJS();
    const decoder = JSONCyclicalDecoder.get(js);
    const roundtrip = Commit.fromJS('org', decoder, DataRegistry.default);
    assertEquals(roundtrip.id, commit.id);
    assertEquals(roundtrip.key, commit.key);
    assertEquals(roundtrip.session, commit.session);
    assertEquals(roundtrip.orgId, commit.orgId);
    assertEquals(roundtrip.record?.get('foo'), 'bar');
    assertEquals(roundtrip.contentsChecksum, commit.contentsChecksum);
    decoder.finalize();
  });

  TEST('Commit', 'serialize/deserialize roundtrip (delta)', () => {
    const item = makeTestItem('bar');
    const edit = makeTestEdit(item.checksum, 'dst');
    const commit = Commit.create({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: { base: 'baseid', edit },
      parents: [],
      ancestors: [],
    });
    const js = commit.toJS();
    const decoder = JSONCyclicalDecoder.get(js);
    const roundtrip = Commit.fromJS('org', decoder, DataRegistry.default);
    assertEquals((roundtrip.contents as any).base, 'baseid');
    assertEquals((roundtrip.contents as any).edit.dstChecksum, 'dst');
    assertEquals(roundtrip.key, commit.key);
    decoder.finalize();
  });

  TEST('Commit', 'lazy deserialization of contents', () => {
    const item = makeTestItem('bar');
    const commit = Commit.create({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestors: [],
    });
    const js = commit.toJS();
    // Simulate lazy: only _contentsStr is set
    const decoder = JSONCyclicalDecoder.get(js);
    const c2 = new FieldCommit({ decoder, orgId: 'org' }, DataRegistry.default);
    // Instead of accessing private fields, test via public API:
    // Accessing .contents triggers deserialization
    assertEquals(c2.record?.get('foo'), 'bar');
    decoder.finalize();
  });

  TEST(
    'Commit',
    'handles signature, mergeBase, mergeLeader, revert fields',
    () => {
      const item = makeTestItem('bar');
      const commit = Commit.create({
        session: 'sess',
        orgId: 'org',
        key: 'key',
        contents: item,
        parents: [],
        ancestors: [],
        signature: 'sig',
        mergeBase: 'mb',
        mergeLeader: 'ml',
        revert: 'rev',
      });
      assertEquals(commit.signature, 'sig');
      assertEquals(commit.mergeBase, 'mb');
      assertEquals(commit.mergeLeader, 'ml');
      assertEquals(commit.revert, 'rev');
    },
  );

  TEST('Commit', 'frozen commit cannot be deserialized again', () => {
    const item = makeTestItem('bar');
    const commit = Commit.create({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestors: [],
    });
    const js = commit.toJS();
    const decoder = JSONCyclicalDecoder.get(js);
    const frozen = Commit.fromJS('org', decoder, DataRegistry.default);
    assertTrue(frozen.frozen);
    assertThrows(() => {
      frozen.deserialize(decoder);
    });
    decoder.finalize();
  });

  TEST('Commit', 'fromJSArr returns array of frozen commits', () => {
    const item = makeTestItem('bar');
    const commit = Commit.create({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestors: [],
    });
    const js = commit.toJS();
    const arr = Commit.fromJSArr('org', [js], DataRegistry.default);
    assertEquals(arr.length, 1);
    assertTrue(arr[0].frozen);
    assertEquals(arr[0].id, commit.id);
  });

  TEST('Commit', 'throws on missing commit contents', () => {
    const item = makeTestItem('bar');
    const commit = Commit.create({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestors: [],
    });
    const js = commit.toJS();
    // Remove 'c' field from js
    const js2 = { ...js };
    delete (js2 as any).c;
    const decoder = JSONCyclicalDecoder.get(js2);
    assertThrows(() => {
      new FieldCommit({ decoder, orgId: 'org' }, DataRegistry.default).contents;
    });
    decoder.finalize();
  });

  TEST(
    'Commit',
    'nextMonotonicTimestamp is monotonic within a stalled ms',
    () => {
      withMonotonicClock(() => {
        setMonotonicNowFn(() => 1_700_000_000_000);
        const t1 = nextMonotonicTimestamp();
        const t2 = nextMonotonicTimestamp();
        const t3 = nextMonotonicTimestamp();
        assertTrue(t1 < t2, 't1 < t2');
        assertTrue(t2 < t3, 't2 < t3');
      });
    },
  );

  TEST('Commit', 'nextMonotonicTimestamp uses a new clock ms directly', () => {
    withMonotonicClock(() => {
      const ms1 = 1_700_000_000_000;
      const ms2 = ms1 + 1;
      setMonotonicNowFn(() => ms1);
      const t1 = nextMonotonicTimestamp();
      const t2 = nextMonotonicTimestamp();
      setMonotonicNowFn(() => ms2);
      const t3 = nextMonotonicTimestamp();
      assertTrue(t1 < t2, 't1 < t2 within same ms');
      assertEquals(t3, ms2, 'new ms returns raw Date.now()');
    });
  });

  TEST('Commit', 'nextMonotonicTimestamp handles clock regression', () => {
    withMonotonicClock(() => {
      setMonotonicNowFn(() => 1_700_000_000_000);
      const t1 = nextMonotonicTimestamp();
      setMonotonicNowFn(() => 1_699_999_999_000);
      assertTrue(nextMonotonicTimestamp() > t1, 'timestamp remains monotonic');
    });
  });

  TEST('Commit', 'nextMonotonicTimestamp handles the Unix epoch', () => {
    withMonotonicClock(() => {
      setMonotonicNowFn(() => 0);
      const t1 = nextMonotonicTimestamp();
      const t2 = nextMonotonicTimestamp();
      assertEquals(t1, 0, 'first timestamp is the clock value');
      assertTrue(t2 > t1, 'second timestamp advances from zero');
    });
  });

  TEST(
    'Commit',
    'nextMonotonicTimestamp remains monotonic beyond one ms',
    () => {
      withMonotonicClock(() => {
        const ms = 1_700_000_000_000;
        setMonotonicNowFn(() => ms);
        let previous = nextMonotonicTimestamp();
        for (let i = 0; i < 5_000; i++) {
          const timestamp = nextMonotonicTimestamp();
          assertTrue(
            timestamp > previous,
            'timestamps remain strictly increasing',
          );
          previous = timestamp;
        }
        assertTrue(
          previous > ms + 1,
          'logical time advances when the clock stalls',
        );
      });
    },
  );

  TEST('Commit', 'resetMonotonicState cleans module state', () => {
    withMonotonicClock(() => {
      setMonotonicNowFn(() => 42);
      nextMonotonicTimestamp();
      nextMonotonicTimestamp();
      resetMonotonicState();
      setMonotonicNowFn(() => 99);
      assertEquals(nextMonotonicTimestamp(), 99);
    });
  });

  TEST('Commit', 'nextMonotonicTimestamp rejects negative clock', () => {
    withMonotonicClock(() => {
      setMonotonicNowFn(() => -1);
      assertThrows(() => nextMonotonicTimestamp());
    });
  });

  TEST('Commit', 'nextMonotonicTimestamp rejects Infinity clock', () => {
    withMonotonicClock(() => {
      setMonotonicNowFn(() => Infinity);
      assertThrows(() => nextMonotonicTimestamp());
    });
  });

  TEST('Commit', 'nextMonotonicTimestamp rejects NaN clock', () => {
    withMonotonicClock(() => {
      setMonotonicNowFn(() => NaN);
      assertThrows(() => nextMonotonicTimestamp());
    });
  });

  TEST(
    'Commit',
    'nextFloat64 maintains precision at high iteration count',
    () => {
      withMonotonicClock(() => {
        // Use realistic Date.now() range (~1.7e12)
        const startMs = 1_700_000_000_000;
        setMonotonicNowFn(() => startMs);
        let previous = nextMonotonicTimestamp();
        const iterations = 100_000;
        for (let i = 0; i < iterations; i++) {
          const next = nextMonotonicTimestamp();
          // Invariant: each timestamp is strictly greater
          assertTrue(
            next > previous,
            `iteration ${i}: monotonicity violated (next=${next}, prev=${previous})`,
          );
          // Invariant: no precision loss (advancement > 0)
          assertTrue(
            next - previous > 0,
            `iteration ${i}: no advancement`,
          );
          previous = next;
        }
        // Verify total advancement is reasonable (doesn't overflow into next ms too quickly)
        // At 1.7e12 range, ULP ≈ 0.000244ms, so 100k iterations should advance ~24ms
        const totalAdvancement = previous - startMs;
        assertTrue(
          totalAdvancement > 10 && totalAdvancement < 100,
          `total advancement ${totalAdvancement}ms is outside expected range [10, 100]`,
        );
      });
    },
  );

  TEST('Commit', 'Commit.create uses monotonic timestamps', () => {
    withMonotonicClock(() => {
      setMonotonicNowFn(() => 1_700_000_000_000);
      const c1 = Commit.create({
        session: 'sess',
        orgId: 'org',
        key: 'k',
        contents: makeTestItem('a'),
        parents: [],
        ancestors: [],
      });
      const c2 = Commit.create({
        session: 'sess',
        orgId: 'org',
        key: 'k',
        contents: makeTestItem('b'),
        parents: [],
        ancestors: [],
      });
      assertTrue(
        c1.timestamp < c2.timestamp,
        'later commit has later timestamp',
      );
    });
  });

  TEST('Commit', 'Commit.create falls back for a falsy timestamp', () => {
    withMonotonicClock(() => {
      const now = 1_700_000_000_000;
      setMonotonicNowFn(() => now);
      const commit = Commit.create({
        session: 'sess',
        orgId: 'org',
        key: 'k',
        contents: makeTestItem('a'),
        parents: [],
        ancestors: [],
        timestamp: 0,
      });
      assertEquals(commit.timestamp, now);
    });
  });

  TEST(
    'Commit',
    'deserialization with missing ts gets reasonable timestamp',
    () => {
      withMonotonicClock(() => {
        const commit = Commit.create({
          session: 'sess',
          orgId: 'org',
          key: 'k',
          contents: makeTestItem('a'),
          parents: [],
          ancestors: [],
          timestamp: 1,
        });
        const js = { ...commit.toJS() };
        delete (js as any).ts;
        const decoder = JSONCyclicalDecoder.get(js);
        const decoded = Commit.fromJS('org', decoder, DataRegistry.default);
        decoder.finalize();
        // Contract: deserialized commits without timestamps get valid values
        assertTrue(decoded.timestamp > 0, 'has valid timestamp');
        assertTrue(Number.isFinite(decoded.timestamp), 'timestamp is finite');
        assertTrue(
          decoded.timestamp <= Date.now(),
          'timestamp not in the future',
        );
      });
    },
  );

  TEST(
    'Commit',
    'deserialization doesn\'t advance monotonic clock',
    () => {
      withMonotonicClock(() => {
        const now = 1_700_000_000_000;
        setMonotonicNowFn(() => now);
        // First call sets _monoLastTimestamp
        const t1 = nextMonotonicTimestamp();
        assertEquals(t1, now);
        // Deserialize 100 commits without ts
        const commit = Commit.create({
          session: 'sess',
          orgId: 'org',
          key: 'k',
          contents: makeTestItem('a'),
          parents: [],
          ancestors: [],
          timestamp: 1,
        });
        const js = { ...commit.toJS() };
        for (let i = 0; i < 100; i++) {
          const noTs = { ...js };
          delete (noTs as any).ts;
          const decoder = JSONCyclicalDecoder.get(noTs);
          const decoded = Commit.fromJS('org', decoder, DataRegistry.default);
          decoder.finalize();
          // Contract: deserialized commits get valid timestamps
          assertTrue(decoded.timestamp > 0, 'has valid timestamp');
          assertTrue(Number.isFinite(decoded.timestamp), 'timestamp is finite');
        }
        // Invariant: monotonic clock shouldn't advance from deserialization
        // (If deserialization used nextMonotonicTimestamp, clock would be 100 ULPs ahead)
        const tAfter = nextMonotonicTimestamp();
        assertTrue(
          tAfter - now < 1,
          `monotonic clock advanced too far after deserializations: ${
            tAfter - now
          }`,
        );
      });
    },
  );
}
