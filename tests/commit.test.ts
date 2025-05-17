import { Commit } from '../repo/commit.ts';
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
import { BloomFilter } from '../base/bloom.ts';

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

export default function setup() {
  TEST('Commit', 'constructs document commit', () => {
    const item = makeTestItem('bar');
    const commit = new Commit({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestorsFilter: undefined as any, // skipped
      ancestorsCount: 0, // skipped
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
    const commit = new Commit({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: { base: 'baseid', edit },
      parents: [],
      ancestorsFilter: undefined as any, // skipped
      ancestorsCount: 0, // skipped
    });
    assertEquals((commit.contents as any).base, 'baseid');
    assertEquals((commit.contents as any).edit.dstChecksum, 'dst');
    assertEquals(commit.key, 'key');
    assertEquals(commit.scheme, undefined); // edit has no scheme
  });

  TEST('Commit', 'serialize/deserialize roundtrip (document)', () => {
    const item = makeTestItem('bar');
    const commit = new Commit({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestorsFilter: undefined as any, // skipped
      ancestorsCount: 0, // skipped
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
    const commit = new Commit({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: { base: 'baseid', edit },
      parents: [],
      ancestorsFilter: undefined as any, // skipped
      ancestorsCount: 0, // skipped
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
    const commit = new Commit({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestorsFilter: undefined as any, // skipped
      ancestorsCount: 0, // skipped
    });
    const js = commit.toJS();
    // Simulate lazy: only _contentsStr is set
    const decoder = JSONCyclicalDecoder.get(js);
    const c2 = new Commit({ decoder, orgId: 'org' }, DataRegistry.default);
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
      const commit = new Commit({
        session: 'sess',
        orgId: 'org',
        key: 'key',
        contents: item,
        parents: [],
        ancestorsFilter: BloomFilter.empty,
        ancestorsCount: 0, // skipped
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
    const commit = new Commit({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestorsFilter: undefined as any, // skipped
      ancestorsCount: 0, // skipped
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
    const commit = new Commit({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestorsFilter: undefined as any, // skipped
      ancestorsCount: 0, // skipped
    });
    const js = commit.toJS();
    const arr = Commit.fromJSArr('org', [js], DataRegistry.default);
    assertEquals(arr.length, 1);
    assertTrue(arr[0].frozen);
    assertEquals(arr[0].id, commit.id);
  });

  TEST('Commit', 'throws on missing commit contents', () => {
    const item = makeTestItem('bar');
    const commit = new Commit({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestorsFilter: undefined as any, // skipped
      ancestorsCount: 0, // skipped
    });
    const js = commit.toJS();
    // Remove 'c' field from js
    const js2 = { ...js };
    delete (js2 as any).c;
    const decoder = JSONCyclicalDecoder.get(js2);
    assertThrows(() => {
      new Commit({ decoder, orgId: 'org' }, DataRegistry.default).contents;
    });
    decoder.finalize();
  });
}
