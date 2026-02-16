import { TEST } from './mod.ts';
import { BloomFilter } from '../base/bloom.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { Commit } from '../repo/commit.ts';
import { Item } from '../cfds/base/item.ts';
import { JSONCyclicalDecoder } from '../base/core-types/encoding/json.ts';
import { kMergeTestRegistry, kMergeTestSchemaV1 } from './merge-test-utils.ts';

export default function setup() {
  TEST('BloomFilter', 'basic add and has', () => {
    const bf = new BloomFilter({ size: 100, fpr: 0.01 });
    bf.add('hello');
    bf.add('world');
    assertTrue(bf.has('hello'), 'should contain "hello"');
    assertTrue(bf.has('world'), 'should contain "world"');
    assertTrue(!bf.has('missing'), 'should not contain "missing"');
  });

  TEST('BloomFilter', 'serialization roundtrip', () => {
    // Create a commit with a real bloom filter
    const bf = new BloomFilter({ size: 50, fpr: 0.01 });
    bf.add('ancestor1');
    bf.add('ancestor2');

    const item = new Item(
      {
        schema: kMergeTestSchemaV1,
        data: { title: 'bloom-test' },
      },
      kMergeTestRegistry,
    );
    const commit = new Commit({
      session: 'sess',
      orgId: 'org',
      key: 'key',
      contents: item,
      parents: [],
      ancestorsFilter: bf,
      ancestorsCount: 2,
    });

    // Serialize and deserialize
    const js = commit.toJS();
    const decoder = JSONCyclicalDecoder.get(js);
    const roundtrip = Commit.fromJS('org', decoder, kMergeTestRegistry);
    decoder.finalize();

    // Verify commit survived roundtrip
    assertEquals(roundtrip.id, commit.id);
    assertEquals(roundtrip.key, commit.key);
  });

  TEST('BloomFilter', 'commitIsHighProbabilityLeaf accuracy', async (ctx) => {
    const db = await ctx.createDB('bloom-leaf', {
      registry: kMergeTestRegistry,
    });
    try {
      await db.readyPromise();
      // Create an item and flush to persist a commit chain
      const item = db.create('/merge-test/bloom-repo', kMergeTestSchemaV1, {
        title: 'first',
      });
      await db.flush('/merge-test/bloom-repo');

      // Update to create a second commit
      item.set('title', 'second');
      await db.flush('/merge-test/bloom-repo');

      const repo = db.repository('/merge-test/bloom-repo')!;
      const head = repo.headForKey(item.key);
      assertTrue(head !== undefined, 'head should exist');

      // The head should be a high-probability leaf
      assertTrue(
        repo.commitIsHighProbabilityLeaf(head!),
        'head commit should be a high-probability leaf',
      );

      // A non-leaf parent should not be a high-probability leaf
      // (only if there are enough commits for bloom filter to be meaningful)
      const commits = Array.from(repo.commitsForKey(item.key));
      assertTrue(commits.length >= 2, 'should have at least 2 commits');
      // The second commit (parent of head) should NOT be a leaf
      const parent = commits[1];
      assertTrue(
        !repo.commitIsHighProbabilityLeaf(parent),
        'parent commit should not be a high-probability leaf',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });
}
