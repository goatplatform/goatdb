import {
  BINARY_MAGIC,
  binaryCheckVersion,
  binaryExtractId,
  binaryReadHeader,
  binaryReadParentsAndAncestors,
  binaryReadStringField,
  decodeStr,
} from '../base/core-types/encoding/binary-commit.ts';
import { BinaryCommit, Commit, FieldCommit } from '../repo/commit.ts';
import { Item } from '../cfds/base/item.ts';
import { Edit } from '../cfds/base/edit.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { assertEquals, assertThrows, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import type { Schema } from '../cfds/base/schema.ts';

export default function setup() {
  const TestSchema: Schema = {
    ns: 'binary-test',
    version: 1,
    fields: {
      name: { type: 'string', required: true },
    },
  };
  DataRegistry.default.registerSchema(TestSchema);

  TEST('BinaryEncoding', 'commit bytes roundtrip', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'test' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess',
        orgId: 'org',
        key: 'k1',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();
    assertTrue(bytes instanceof Uint8Array);
    assertTrue(bytes.length > 0);
    assertEquals(bytes[0], BINARY_MAGIC, 'first byte should be BINARY_MAGIC');

    const [roundtrip] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertEquals(roundtrip.id, commit.id);
    assertEquals(roundtrip.key, commit.key);
    assertEquals(roundtrip.session, commit.session);
    assertEquals(roundtrip.orgId, commit.orgId);
    assertEquals(roundtrip.record?.get('name'), 'test');
    assertEquals(roundtrip.contentsChecksum, commit.contentsChecksum);
    assertTrue(roundtrip.frozen);
  });

  TEST('BinaryEncoding', 'toBytes is zero-copy after first call', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'cached' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess2',
        orgId: 'org',
        key: 'k2',
        contents: item,
        parents: [],
        ancestors: [],
        frozen: true,
      },
      DataRegistry.default,
    );
    const bytes1 = commit.toBytes();
    const bytes2 = commit.toBytes();
    assertTrue(bytes1 === bytes2);
  });

  TEST('BinaryEncoding', 'each commit bytes independently decodable', () => {
    const commits = [
      { key: 'ind-k1', name: 'alpha', session: 'ind-sess1' },
      { key: 'ind-k2', name: 'beta', session: 'ind-sess2' },
      { key: 'ind-k3', name: 'gamma', session: 'ind-sess3' },
    ].map(({ key, name, session }) => {
      const item = new Item(
        { schema: TestSchema as Schema, data: { name } },
        DataRegistry.default,
      );
      return Commit.create(
        {
          session,
          orgId: 'org',
          key,
          contents: item,
          parents: [],
          ancestors: [],
        },
        DataRegistry.default,
      );
    });

    const allBytes = commits.map((c) => c.toBytes());
    for (let i = 0; i < commits.length; i++) {
      const [decoded] = Commit.fromBinaryBytesArr(
        'org',
        [allBytes[i]],
        DataRegistry.default,
      );
      assertEquals(decoded.id, commits[i].id);
      assertEquals(decoded.key, commits[i].key);
      assertEquals(decoded.session, commits[i].session);
      assertEquals(decoded.record?.get('name'), ['alpha', 'beta', 'gamma'][i]);
    }
  });

  TEST('BinaryEncoding', 'fromBinaryBytesArr deduplicates by id', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'dedup' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess3',
        orgId: 'org',
        key: 'k3',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();
    const results = Commit.fromBinaryBytesArr(
      'org',
      [bytes, bytes],
      DataRegistry.default,
    );
    assertEquals(results.length, 2);
    assertEquals(results[0].id, results[1].id);
    assertTrue(results[0] === results[1]);
  });

  TEST('BinaryEncoding', 'binaryExtractId returns correct id', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'extract-test' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-extract',
        orgId: 'org',
        key: 'k-extract',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();
    const extracted = binaryExtractId(bytes);
    assertEquals(extracted, commit.id);
  });

  TEST('BinaryEncoding', 'binaryReadHeader returns correct fields', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'header-test' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-header',
        orgId: 'org',
        key: 'k-header',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();
    const header = binaryReadHeader(bytes);
    assertEquals(header.timestamp, commit.timestamp);
    assertTrue(
      header.contentsOffset > 0 && header.contentsOffset < bytes.length,
    );
  });

  TEST('BinaryEncoding', 'toBytes skips cache for unfrozen commits', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'unfrozen' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-unfrozen',
        orgId: 'org',
        key: 'k-unfrozen',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes1 = commit.toBytes();
    const bytes2 = commit.toBytes();
    // Unfrozen commits produce fresh buffers each call (no cache pollution)
    assertTrue(bytes1 !== bytes2);
    assertEquals(bytes1.length, bytes2.length);
  });

  TEST('BinaryEncoding', 'schemaNamespace getter returns namespace', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'schema-test' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-schema',
        orgId: 'org',
        key: 'k-schema',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    assertEquals(commit.schemaNamespace, 'binary-test');

    const bytes = commit.toBytes();
    const [decoded] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertEquals(decoded.schemaNamespace, 'binary-test');
  });

  TEST('BinaryEncoding', 'binaryReadStringField reads string fields', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'field-test' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-field',
        orgId: 'org-field',
        key: 'k-field',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();
    // field 0 = id, 1 = key, 2 = session, 3 = orgId
    assertEquals(binaryReadStringField(bytes, 0), commit.id);
    assertEquals(binaryReadStringField(bytes, 1), commit.key);
    assertEquals(binaryReadStringField(bytes, 2), commit.session);
    assertEquals(binaryReadStringField(bytes, 3), commit.orgId);
  });

  TEST('BinaryEncoding', 'isDocumentCommit flag roundtrip (document)', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'doc-flag' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-doc',
        orgId: 'org',
        key: 'k-doc',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    assertTrue(commit.isDocumentCommit, 'FieldCommit should be document');
    const bytes = commit.toBytes();
    const [decoded] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertTrue(
      decoded.isDocumentCommit,
      'BinaryCommit should read document flag',
    );
  });

  TEST('BinaryEncoding', 'isDocumentCommit flag roundtrip (delta)', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'base' } },
      DataRegistry.default,
    );
    const baseCommit = Commit.create(
      {
        session: 'sess-delta',
        orgId: 'org',
        key: 'k-delta',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const item2 = item.clone();
    item2.set('name', 'changed');
    const changes = item2.diff(item);
    const edit = new Edit({
      changes,
      srcChecksum: item.checksum,
      dstChecksum: item2.checksum,
      scheme: TestSchema,
    });
    const deltaCommit = Commit.create(
      {
        session: 'sess-delta',
        orgId: 'org',
        key: 'k-delta',
        contents: { base: baseCommit.id, edit },
        parents: [baseCommit.id],
        ancestors: [],
      },
      DataRegistry.default,
    );
    assertTrue(!deltaCommit.isDocumentCommit, 'delta should not be document');
    const bytes = deltaCommit.toBytes();
    const [decoded] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertTrue(
      !decoded.isDocumentCommit,
      'BinaryCommit delta should not have document flag',
    );
  });

  TEST('BinaryEncoding', 'ancestors array roundtrip', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'anc-rt' } },
      DataRegistry.default,
    );
    const ancestorIds = ['ancestor-id-1', 'ancestor-id-2'];
    const commit = Commit.create(
      {
        session: 'sess-anc',
        orgId: 'org',
        key: 'k-anc',
        contents: item,
        parents: [],
        ancestors: ancestorIds,
      },
      DataRegistry.default,
    );
    assertEquals(commit.ancestors, ancestorIds);

    const bytes = commit.toBytes();
    const [decoded] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertEquals(decoded.ancestors, ancestorIds);
  });

  TEST(
    'BinaryEncoding',
    'deltaBaseId reads base commit id from binary header field',
    () => {
      const item = new Item(
        { schema: TestSchema as Schema, data: { name: 'base-for-delta' } },
        DataRegistry.default,
      );
      const baseCommit = Commit.create(
        {
          session: 'sess-edb-base',
          orgId: 'org',
          key: 'k-edb',
          contents: item,
          parents: [],
          ancestors: [],
        },
        DataRegistry.default,
      );
      const item2 = item.clone();
      item2.set('name', 'delta-changed');
      const changes = item2.diff(item);
      const edit = new Edit({
        changes,
        srcChecksum: item.checksum,
        dstChecksum: item2.checksum,
        scheme: TestSchema,
      });
      const deltaCommit = Commit.create(
        {
          session: 'sess-edb-delta',
          orgId: 'org',
          key: 'k-edb',
          contents: { base: baseCommit.id, edit },
          parents: [baseCommit.id],
          ancestors: [],
        },
        DataRegistry.default,
      );
      const bytes = deltaCommit.toBytes();
      // Verify the FLAG_DELTA_BASE bit (bit 5) is set in the header flags
      const flags = bytes[2] | (bytes[3] << 8);
      assertTrue((flags & (1 << 5)) !== 0, 'FLAG_DELTA_BASE must be set');
      // Verify BinaryCommit reads deltaBaseId from the header (no JSON parse)
      const [decoded] = Commit.fromBinaryBytesArr(
        'org',
        [bytes],
        DataRegistry.default,
      );
      assertEquals(decoded.deltaBaseId, baseCommit.id);
    },
  );

  TEST(
    'BinaryEncoding',
    'deltaBaseId returns undefined for document commits',
    () => {
      const item = new Item(
        { schema: TestSchema as Schema, data: { name: 'doc-for-edb' } },
        DataRegistry.default,
      );
      const commit = Commit.create(
        {
          session: 'sess-edb-doc',
          orgId: 'org',
          key: 'k-edb-doc',
          contents: item,
          parents: [],
          ancestors: [],
        },
        DataRegistry.default,
      );
      const bytes = commit.toBytes();
      // FLAG_DELTA_BASE (bit 5) must NOT be set for document commits
      const flags = bytes[2] | (bytes[3] << 8);
      assertEquals(flags & (1 << 5), 0, 'FLAG_DELTA_BASE must not be set for documents');
      const [decoded] = Commit.fromBinaryBytesArr(
        'org',
        [bytes],
        DataRegistry.default,
      );
      assertEquals(decoded.deltaBaseId, undefined);
    },
  );

  TEST('BinaryEncoding', 'BinaryCommit lazy contents parse and cache', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'lazy-test' } },
      DataRegistry.default,
    );
    const baseCommit = Commit.create(
      {
        session: 'sess-lazy-base',
        orgId: 'org',
        key: 'k-lazy',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const item2 = item.clone();
    item2.set('name', 'lazy-changed');
    const changes = item2.diff(item);
    const edit = new Edit({
      changes,
      srcChecksum: item.checksum,
      dstChecksum: item2.checksum,
      scheme: TestSchema,
    });
    const deltaCommit = Commit.create(
      {
        session: 'sess-lazy-delta',
        orgId: 'org',
        key: 'k-lazy',
        contents: { base: baseCommit.id, edit },
        parents: [baseCommit.id],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = deltaCommit.toBytes();
    const [bc] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertTrue(bc instanceof BinaryCommit);

    // Access header-level fields - must not trigger contents parse
    assertEquals(bc.isDocumentCommit, false);
    assertEquals(bc.deltaBaseId, baseCommit.id);
    assertEquals(bc.key, 'k-lazy');
    assertEquals(bc.session, 'sess-lazy-delta');

    // Contents not yet parsed - access it now
    const c1 = bc.contents;
    assertTrue(c1 !== undefined);

    // Second access must return the same object (cached)
    const c2 = bc.contents;
    assertTrue(c1 === c2);
  });

  TEST(
    'BinaryEncoding',
    'BinaryCommit with baseOffset reads all fields and patches age correctly',
    () => {
      const specs = [
        { key: 'off-k1', name: 'alpha', session: 'off-s1' },
        { key: 'off-k2', name: 'beta', session: 'off-s2' },
        { key: 'off-k3', name: 'gamma', session: 'off-s3' },
      ];
      const commits = specs.map(({ key, name, session }) => {
        const item = new Item(
          { schema: TestSchema as Schema, data: { name } },
          DataRegistry.default,
        );
        return Commit.create(
          {
            session,
            orgId: 'org',
            key,
            contents: item,
            parents: [],
            ancestors: [],
          },
          DataRegistry.default,
        );
      });
      // Concatenate all records into one buffer with a sentinel prefix to ensure
      // baseOffset != 0 for every record.
      const prefix = new Uint8Array(7);
      const allBytes = commits.map((c) => c.toBytes());
      let totalSize = prefix.length;
      for (const b of allBytes) totalSize += b.length;
      const buffer = new Uint8Array(totalSize);
      buffer.set(prefix, 0);
      const offsets = new Uint32Array(commits.length * 2);
      let pos = prefix.length;
      for (let i = 0; i < allBytes.length; i++) {
        buffer.set(allBytes[i], pos);
        offsets[i * 2] = pos;
        offsets[i * 2 + 1] = allBytes[i].length;
        pos += allBytes[i].length;
      }
      const decoded = Commit.fromBinaryScanResult(
        'org',
        buffer,
        offsets,
        DataRegistry.default,
      );
      assertEquals(decoded.length, 3);
      for (let i = 0; i < 3; i++) {
        assertEquals(decoded[i].id, commits[i].id);
        assertEquals(decoded[i].key, specs[i].key);
        assertEquals(decoded[i].session, specs[i].session);
        assertEquals(decoded[i].record?.get('name'), specs[i].name);
        assertEquals(decoded[i].schemaNamespace, 'binary-test');
        assertEquals(decoded[i].age, undefined);
        // age setter must patch the backing buffer at the correct (offset) position
        decoded[i].age = i + 10;
        assertEquals(decoded[i].age, i + 10);
        // round-trip toBytes to confirm the patch was written to the right place
        const rt = Commit.fromBinaryBytesArr(
          'org',
          [decoded[i].toBytes()],
          DataRegistry.default,
        );
        assertEquals(rt[0].age, i + 10);
      }
    },
  );

  TEST('BinaryEncoding', 'fromBinaryScanResult with subarray views', () => {
    const commits = Array.from({ length: 5 }, (_, i) => {
      const item = new Item(
        { schema: TestSchema as Schema, data: { name: `scan-${i}` } },
        DataRegistry.default,
      );
      return Commit.create(
        {
          session: `sess-scan-${i}`,
          orgId: 'org',
          key: `k-scan-${i}`,
          contents: item,
          parents: [],
          ancestors: [],
        },
        DataRegistry.default,
      );
    });
    const allBytes = commits.map((c) => c.toBytes());
    // Build a single contiguous buffer + offsets like the worker would
    let totalSize = 0;
    for (const b of allBytes) totalSize += b.length;
    const buffer = new Uint8Array(totalSize);
    const offsets = new Uint32Array(commits.length * 2);
    let pos = 0;
    for (let i = 0; i < allBytes.length; i++) {
      buffer.set(allBytes[i], pos);
      offsets[i * 2] = pos;
      offsets[i * 2 + 1] = allBytes[i].length;
      pos += allBytes[i].length;
    }
    const decoded = Commit.fromBinaryScanResult(
      'org',
      buffer,
      offsets,
      DataRegistry.default,
    );
    assertEquals(decoded.length, 5);
    for (let i = 0; i < 5; i++) {
      assertEquals(decoded[i].id, commits[i].id);
      assertEquals(decoded[i].key, commits[i].key);
      assertEquals(decoded[i].record?.get('name'), `scan-${i}`);
      assertTrue(decoded[i] instanceof BinaryCommit);
    }
  });

  TEST('BinaryEncoding', 'binaryExtractId rejects truncated buffers', () => {
    // Empty buffer
    assertThrows(() => binaryExtractId(new Uint8Array(0)));
    // Buffer shorter than HEADER_SIZE + 2 (38 bytes)
    assertThrows(() => binaryExtractId(new Uint8Array(10)));
    // Buffer exactly HEADER_SIZE but missing id length field
    assertThrows(() => binaryExtractId(new Uint8Array(36)));
    // byteLength param triggers same guards
    const large = new Uint8Array(100);
    assertThrows(() => binaryExtractId(large, 10));
    assertThrows(() => binaryExtractId(large, 36));
  });

  TEST('BinaryEncoding', 'age setter double-set throws', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'age-test' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-age',
        orgId: 'org',
        key: 'k-age',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const [bc] = Commit.fromBinaryBytesArr(
      'org',
      [commit.toBytes()],
      DataRegistry.default,
    );
    assertTrue(bc instanceof BinaryCommit);
    bc.age = 1; // first set: ok
    assertThrows(() => {
      bc.age = 2;
    }); // second set: must throw
  });

  TEST('BinaryEncoding', '255-ancestor boundary round-trip', () => {
    // Build 255 fake ancestor IDs (must be 36-char hex-like strings)
    const ancestors: string[] = [];
    for (let i = 0; i < 255; i++) {
      ancestors.push(i.toString(16).padStart(36, '0'));
    }
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'anc-test' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-anc',
        orgId: 'org',
        key: 'k-anc',
        contents: item,
        parents: [],
        ancestors,
      },
      DataRegistry.default,
    );
    const [rt] = Commit.fromBinaryBytesArr(
      'org',
      [commit.toBytes()],
      DataRegistry.default,
    );
    assertEquals(rt.ancestors.length, 255);
    for (let i = 0; i < 255; i++) {
      assertEquals(rt.ancestors[i], ancestors[i]);
    }
  });

  TEST('BinaryEncoding', 'unicode key roundtrip (multi-byte UTF-8)', () => {
    // 2-byte (\u00e9), 3-byte (\u4e16\u754c), 4-byte (\uD83D\uDE00)
    const unicodeKey = 'caf\u00e9-\u4e16\u754c-\uD83D\uDE00';
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'unicode' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-uni',
        orgId: 'org',
        key: unicodeKey,
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();
    const [rt] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertEquals(rt.key, unicodeKey);
    assertEquals(rt.record?.get('name'), 'unicode');

    // Also verify via binaryReadStringField (field index 1 = key)
    const readKey = binaryReadStringField(bytes, 1);
    assertEquals(readKey, unicodeKey);
  });

  TEST('BinaryEncoding', 'lone low surrogate emits U+FFFD', () => {
    const lonelow = String.fromCharCode(0xDC00);
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'surrogate' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-surr',
        orgId: 'org',
        key: lonelow,
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();
    const [rt] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertEquals(rt.key, '\uFFFD');
  });

  TEST('BinaryEncoding', 'lone high surrogate emits U+FFFD', () => {
    const lonehigh = String.fromCharCode(0xD800);
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'surrogate' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-surr',
        orgId: 'org',
        key: lonehigh,
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();
    const [rt] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertEquals(rt.key, '\uFFFD');
  });

  TEST('BinaryEncoding', 'empty string fields roundtrip', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'empty-fields' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: '',
        orgId: '',
        key: '',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();
    const [rt] = Commit.fromBinaryBytesArr(
      '',
      [bytes],
      DataRegistry.default,
    );
    assertEquals(rt.key, '');
    assertEquals(rt.session, '');
    assertEquals(rt.orgId, '');
  });

  TEST(
    'BinaryEncoding',
    'long string >512 bytes triggers TextDecoder fallback',
    () => {
      // Build a key longer than 512 bytes to exercise the decodeStr fallback path
      const longKey = 'k'.repeat(600);
      const item = new Item(
        { schema: TestSchema as Schema, data: { name: 'long' } },
        DataRegistry.default,
      );
      const commit = Commit.create(
        {
          session: 'sess-long',
          orgId: 'org',
          key: longKey,
          contents: item,
          parents: [],
          ancestors: [],
        },
        DataRegistry.default,
      );
      const bytes = commit.toBytes();
      const [rt] = Commit.fromBinaryBytesArr(
        'org',
        [bytes],
        DataRegistry.default,
      );
      assertEquals(rt.key, longKey);
      assertEquals(binaryReadStringField(bytes, 1), longKey);
    },
  );

  TEST('BinaryEncoding', 'wrong magic byte rejected', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'bad-magic' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-magic',
        orgId: 'org',
        key: 'k-magic',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const buf = commit.toBytes().slice();
    buf[0] = 0x00; // corrupt magic byte
    assertThrows(() => {
      binaryCheckVersion(buf);
    });
  });

  TEST('BinaryEncoding', 'wrong version byte rejected', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'bad-ver' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-ver',
        orgId: 'org',
        key: 'k-ver',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const buf = commit.toBytes().slice();
    buf[1] = 0xFF; // corrupt version byte
    assertThrows(() => {
      binaryCheckVersion(buf);
    });
  });

  TEST('BinaryEncoding', 'binaryCheckVersion accepts FLAG_DELTA_BASE (bit 5)', () => {
    // Bit 5 is now FLAG_DELTA_BASE -- binaryCheckVersion must not reject it.
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'bit5' } },
      DataRegistry.default,
    );
    const baseCommit = Commit.create(
      {
        session: 'sess-bit5-base',
        orgId: 'org',
        key: 'k-bit5',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const item2 = item.clone();
    item2.set('name', 'bit5-changed');
    const changes = item2.diff(item);
    const edit = new Edit({
      changes,
      srcChecksum: item.checksum,
      dstChecksum: item2.checksum,
      scheme: TestSchema,
    });
    const deltaCommit = Commit.create(
      {
        session: 'sess-bit5-delta',
        orgId: 'org',
        key: 'k-bit5',
        contents: { base: baseCommit.id, edit },
        parents: [baseCommit.id],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = deltaCommit.toBytes();
    assertTrue((bytes[2] & (1 << 5)) !== 0, 'FLAG_DELTA_BASE must be set for delta commit');
    // binaryCheckVersion must not throw when bit 5 is set
    binaryCheckVersion(bytes);
  });

  TEST('BinaryEncoding', 'conditional fields roundtrip', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'cond-fields' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-cond',
        orgId: 'org',
        key: 'k-cond',
        contents: item,
        parents: ['parent-1'],
        ancestors: ['anc-1'],
        signature: 'sig-abc',
        mergeBase: 'mb-123',
        mergeLeader: 'ml-456',
        revert: 'rev-789',
      },
      DataRegistry.default,
    );
    assertEquals(commit.signature, 'sig-abc');
    assertEquals(commit.mergeBase, 'mb-123');
    assertEquals(commit.mergeLeader, 'ml-456');
    assertEquals(commit.revert, 'rev-789');

    const bytes = commit.toBytes();
    const [rt] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertEquals(rt.signature, 'sig-abc');
    assertEquals(rt.mergeBase, 'mb-123');
    assertEquals(rt.mergeLeader, 'ml-456');
    assertEquals(rt.revert, 'rev-789');
    assertEquals(rt.parents, ['parent-1']);
    assertEquals(rt.ancestors, ['anc-1']);
    assertEquals(rt.record?.get('name'), 'cond-fields');
  });

  TEST('BinaryEncoding', 'multiple parents binary roundtrip', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'merge' } },
      DataRegistry.default,
    );
    const parentIds = ['parent-aaa', 'parent-bbb', 'parent-ccc'];
    const ancestorIds = ['anc-111', 'anc-222'];
    const commit = Commit.create(
      {
        session: 'sess-merge',
        orgId: 'org',
        key: 'k-merge',
        contents: item,
        parents: parentIds,
        ancestors: ancestorIds,
      },
      DataRegistry.default,
    );
    assertEquals(commit.parents, parentIds);

    const bytes = commit.toBytes();
    const [rt] = Commit.fromBinaryBytesArr(
      'org',
      [bytes],
      DataRegistry.default,
    );
    assertEquals(rt.parents, parentIds);
    assertEquals(rt.ancestors, ancestorIds);

    // Also verify via low-level reader
    const header = binaryReadHeader(bytes);
    const pa = binaryReadParentsAndAncestors(bytes, header.flags);
    assertEquals(pa.parents, parentIds);
    assertEquals(pa.ancestors, ancestorIds);
  });

  TEST('BinaryEncoding', 'truncated binary record rejected', () => {
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'trunc' } },
      DataRegistry.default,
    );
    const commit = Commit.create(
      {
        session: 'sess-trunc',
        orgId: 'org',
        key: 'k-trunc',
        contents: item,
        parents: [],
        ancestors: [],
      },
      DataRegistry.default,
    );
    const bytes = commit.toBytes();

    // binaryReadHeader throws on buffer shorter than header
    assertThrows(() => binaryReadHeader(new Uint8Array(10)));
    assertThrows(() => binaryReadHeader(new Uint8Array(35)));

    // binaryCheckVersion also rejects short buffers
    assertThrows(() => binaryCheckVersion(new Uint8Array(0)));
    assertThrows(() => binaryCheckVersion(bytes.slice(0, 20)));

    // decodeStr produces replacement char on truncated multi-byte UTF-8
    // 3-byte sequence: 0xE4 0xB8 0x96 = U+4E16
    // Truncate after lead byte
    const truncBuf = new Uint8Array([0xE4]);
    const result = decodeStr(truncBuf, 0, 1);
    assertEquals(result, '\uFFFD');

    // 2-byte sequence: 0xC3 0xA9 = U+00E9
    // Truncate after lead byte
    const trunc2 = new Uint8Array([0xC3]);
    assertEquals(decodeStr(trunc2, 0, 1), '\uFFFD');

    // 4-byte sequence: 0xF0 0x9F 0x98 0x80 = U+1F600
    // Truncate after 2 bytes
    const trunc4 = new Uint8Array([0xF0, 0x9F]);
    assertEquals(decodeStr(trunc4, 0, 2), '\uFFFD');
  });

  TEST(
    'BinaryEncoding',
    'remote commit without cid does not acquire connectionId after binary roundtrip',
    () => {
      // Regression test for the connectionId-always-serialized bug.
      // A commit with no stored connectionId (e.g. received from a peer)
      // must round-trip through binary without acquiring the local CONNECTION_ID.
      const item = new Item(
        { schema: TestSchema as Schema, data: { name: 'remote' } },
        DataRegistry.default,
      );
      const commit = Commit.create(
        {
          session: 'sess-remote',
          orgId: 'org',
          key: 'k-remote',
          contents: item,
          parents: [],
          ancestors: [],
        },
        DataRegistry.default,
      );
      // A freshly created commit has a local cid -- clear it to simulate a
      // remotely-received commit that never had one.
      (commit as FieldCommit)['_connectionId'] = undefined;

      const bytes = commit.toBytes();
      const [rt] = Commit.fromBinaryBytesArr(
        'org',
        [bytes],
        DataRegistry.default,
      );
      // Must have no stored cid: rawConnectionId is undefined.
      assertEquals(rt.rawConnectionId, undefined);
      // The runtime getter still falls back to CONNECTION_ID, so createdLocally
      // reflects the current process -- that is intentional and unaffected.
    },
  );

  TEST('BinaryEncoding', '256 ancestors exceed u8 limit and throw', () => {
    const ancestors: string[] = [];
    for (let i = 0; i < 256; i++) {
      ancestors.push(i.toString(16).padStart(36, '0'));
    }
    const item = new Item(
      { schema: TestSchema as Schema, data: { name: 'too-many-anc' } },
      DataRegistry.default,
    );
    assertThrows(() =>
      Commit.create(
        {
          session: 'sess-256',
          orgId: 'org',
          key: 'k-256',
          contents: item,
          parents: [],
          ancestors,
        },
        DataRegistry.default,
      )
    );
  });
}
