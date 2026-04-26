import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import {
  createRawCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';
import { BloomFilter } from '../base/bloom.ts';
import { SyncMessage } from '../net/message.ts';

export default function setup() {
  TEST(
    'SyncMessageMissing',
    'identifies commits missing from peer',
    (_ctx) => {
      const commits = [
        createRawCommit({
          key: 'k1',
          schema: kMergeTestSchemaV1,
          data: { title: 'a', count: 0 },
        }),
        createRawCommit({
          key: 'k2',
          schema: kMergeTestSchemaV1,
          data: { title: 'b', count: 0 },
        }),
        createRawCommit({
          key: 'k3',
          schema: kMergeTestSchemaV1,
          data: { title: 'c', count: 0 },
        }),
      ];

      // Peer knows only k1 and k2
      const peerFilter = new BloomFilter({ size: 10, fpr: 0.01 });
      peerFilter.add(commits[0].id);
      peerFilter.add(commits[1].id);

      const localEntries: [string, typeof commits[0]][] = commits.map(
        (c) => [c.id, c],
      );

      const msg = SyncMessage.build(
        peerFilter,
        localEntries,
        commits.length,
        2,
        10,
        'test-org',
        kMergeTestRegistry,
      );

      // k3 is missing from peer
      assertEquals(msg.values.length, 1, 'expected exactly one missing commit');
      assertEquals(
        msg.values[0].id,
        commits[2].id,
        'missing commit should be k3',
      );
    },
  );

  TEST(
    'SyncMessageMissing',
    'no missing when sets identical',
    (_ctx) => {
      const commits = [
        createRawCommit({
          key: 'k1',
          schema: kMergeTestSchemaV1,
          data: { title: 'a', count: 0 },
        }),
        createRawCommit({
          key: 'k2',
          schema: kMergeTestSchemaV1,
          data: { title: 'b', count: 0 },
        }),
      ];

      const peerFilter = new BloomFilter({ size: 10, fpr: 0.01 });
      for (const c of commits) {
        peerFilter.add(c.id);
      }

      const localEntries: [string, typeof commits[0]][] = commits.map(
        (c) => [c.id, c],
      );

      const msg = SyncMessage.build(
        peerFilter,
        localEntries,
        commits.length,
        commits.length,
        10,
        'test-org',
        kMergeTestRegistry,
      );

      assertEquals(msg.values.length, 0, 'expected no missing commits');
    },
  );

  TEST(
    'SyncMessageMissing',
    'all missing from empty peer',
    (_ctx) => {
      const commits = [
        createRawCommit({
          key: 'k1',
          schema: kMergeTestSchemaV1,
          data: { title: 'a', count: 0 },
        }),
        createRawCommit({
          key: 'k2',
          schema: kMergeTestSchemaV1,
          data: { title: 'b', count: 0 },
        }),
        createRawCommit({
          key: 'k3',
          schema: kMergeTestSchemaV1,
          data: { title: 'c', count: 0 },
        }),
      ];

      // Empty peer filter - has no entries
      const peerFilter = new BloomFilter({ size: 1, fpr: 0.5 });

      const localEntries: [string, typeof commits[0]][] = commits.map(
        (c) => [c.id, c],
      );

      const msg = SyncMessage.build(
        peerFilter,
        localEntries,
        commits.length,
        0,
        10,
        'test-org',
        kMergeTestRegistry,
      );

      assertEquals(
        msg.values.length,
        commits.length,
        'all commits should be missing from empty peer',
      );

      const missingIds = new Set(msg.values.map((c) => c.id));
      for (const c of commits) {
        assertTrue(missingIds.has(c.id), `commit ${c.id} should be missing`);
      }
    },
  );
}
