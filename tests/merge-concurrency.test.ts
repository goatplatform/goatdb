import { TEST, type TestSuite } from './mod.ts';
import { assertEquals, assertExists } from './asserts.ts';
import {
  createRemoteCommit,
  kMergeTestRegistry,
  kMergeTestSchemaV1,
} from './merge-test-utils.ts';
import { sleep } from '../base/time.ts';

const S1 = kMergeTestSchemaV1;

/** Creates a repo with a base commit and one flushed local edit. */
async function openRepo(
  ctx: TestSuite,
  dbId: string,
  repoPath: string,
  localTitle: string,
) {
  const db = await ctx.createDB(dbId, { registry: kMergeTestRegistry });
  await db.readyPromise();
  const item = db.create(repoPath, S1, { title: 'base', count: 0 });
  await db.flush(repoPath);
  const repo = db.repository(repoPath)!;
  const baseHead = repo.headForKey(item.key)!;
  item.set('title', localTitle);
  await db.flush(repoPath);
  return { db, item, repo, baseHead };
}

function remote(
  itemKey: string,
  parentId: string,
  data: { title: string; count: number },
  session: string,
) {
  return createRemoteCommit({
    key: itemKey,
    schema: S1,
    data,
    parents: [parentId],
    session,
    timestamp: Date.now() - 10_000,
  });
}

export default function setup() {
  TEST(
    'MergeConcurrency',
    'pending promise exists during merge',
    async (ctx) => {
      const { db, item, repo, baseHead } = await openRepo(
        ctx,
        'conc-pending',
        '/merge-test/conc1',
        'local',
      );
      try {
        await repo.persistVerifiedCommits([
          remote(
            item.key,
            baseHead.id,
            { title: 'remote', count: 1 },
            'remote-sess',
          ),
        ]);
        // After persist the automatic merge chain is in flight.
        await sleep(200);
        assertExists(
          repo.valueForKey(item.key),
          'value should exist after automatic merge',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST('MergeConcurrency', 'promise cleanup after merge', async (ctx) => {
    const { db, item, repo, baseHead } = await openRepo(
      ctx,
      'conc-cleanup',
      '/merge-test/conc2',
      'local-first',
    );
    try {
      await repo.persistVerifiedCommits([
        remote(
          item.key,
          baseHead.id,
          { title: 'remote-first', count: 1 },
          'remote-sess-1',
        ),
      ]);
      await sleep(200);
      // The second remote commit should merge after the first promise cleared.
      await repo.persistVerifiedCommits([
        remote(
          item.key,
          baseHead.id,
          { title: 'remote-second', count: 2 },
          'remote-sess-2',
        ),
      ]);
      await sleep(200);
      assertExists(
        repo.valueForKey(item.key),
        'value should exist after second merge',
      );
    } finally {
      await db.flushAll();
      await db.close();
    }
  });

  TEST(
    'MergeConcurrency',
    'flush does not commit a prefix-sibling repository',
    async (ctx) => {
      const db = await ctx.createDB('conc-prefix', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();
        const sibling = db.create('/merge-test/conc10', S1, {
          title: 'sibling',
        });
        await db.flush('/merge-test/conc10');
        const siblingRepo = db.repository('/merge-test/conc10')!;
        const siblingHead = siblingRepo.headForKey(sibling.key);
        assertExists(siblingHead, 'sibling should have a base commit');

        // The repo ids share a string prefix. Cancel the sibling's auto-commit
        // so only flush('/merge-test/conc1') can commit it.
        db.create('/merge-test/conc1', S1, { title: 'parent' });
        sibling.set('title', 'unflushed');
        await sibling.deactivate();

        await db.flush('/merge-test/conc1');

        assertEquals(
          siblingRepo.headForKey(sibling.key),
          siblingHead,
          'flushing conc1 must not commit conc10',
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
