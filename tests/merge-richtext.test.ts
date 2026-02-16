import { TEST } from './mod.ts';
import { assertExists, assertTrue } from './asserts.ts';
import {
  createRemoteCommit,
  kMergeTestRegistry,
  kRichTextTestSchema,
} from './merge-test-utils.ts';
import { treeToPlaintext } from '../cfds/richtext/tree.ts';
import type { RichText } from '../cfds/richtext/tree.ts';
import { sleep } from '../base/time.ts';

const RS = kRichTextTestSchema;

function makeRichText(text: string): RichText {
  return {
    root: {
      children: [
        {
          tagName: 'p',
          children: [{ text }],
        },
      ],
    },
  };
}

function makeRichTextInserted(
  original: string,
  insertion: string,
  position: number,
): RichText {
  const result = original.slice(0, position) + insertion +
    original.slice(position);
  return makeRichText(result);
}

function makeRichTextDeleted(
  original: string,
  position: number,
  count: number,
): RichText {
  const result = original.slice(0, position) + original.slice(position + count);
  return makeRichText(result);
}

function getRichTextContent(item: { get(key: string): unknown }): string {
  const rt = item.get('body') as RichText;
  if (!rt || !rt.root) return '';
  return treeToPlaintext(rt.root);
}

export default function setup() {
  TEST(
    'MergeRichText',
    'concurrent insertions at different positions',
    async (ctx) => {
      const db = await ctx.createDB('rt-diff-pos', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();

        const baseText = 'Hello World';

        // Create item via GoatDB API with richtext body
        const item = db.create('/richtext-test/rt1', kRichTextTestSchema, {
          body: makeRichText(baseText),
        });
        await db.flush('/richtext-test/rt1');

        const repo = db.repository('/richtext-test/rt1')!;
        const baseHead = repo.headForKey(item.key)!;

        // Local change: insert " Dear" at position 5 -> "Hello Dear World"
        item.set('body', makeRichTextInserted(baseText, ' Dear', 5));
        await db.flush('/richtext-test/rt1');

        // Remote change: insert "!" at end -> "Hello World!"
        const remote = createRemoteCommit({
          key: item.key,
          schema: RS,
          data: {
            body: makeRichTextInserted(baseText, '!', baseText.length),
          },
          parents: [baseHead.id],
          session: 'remote-rt',
          timestamp: Date.now() - 10_000,
        });
        await repo.persistVerifiedCommits([remote]);
        await sleep(200); // Wait for automatic merge

        const result = repo.valueForKey(item.key);
        assertExists(result, 'merged value should exist');
        const content = getRichTextContent(result![0]);
        // Both insertions should be present
        assertTrue(
          content.includes('Dear'),
          `merged text should contain "Dear", got: "${content}"`,
        );
        assertTrue(
          content.includes('!'),
          `merged text should contain "!", got: "${content}"`,
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'MergeRichText',
    'concurrent insertions at same position',
    async (ctx) => {
      const db = await ctx.createDB('rt-same-pos', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();

        const baseText = 'AB';

        // Create item via GoatDB API
        const item = db.create('/richtext-test/rt2', kRichTextTestSchema, {
          body: makeRichText(baseText),
        });
        await db.flush('/richtext-test/rt2');

        const repo = db.repository('/richtext-test/rt2')!;
        const baseHead = repo.headForKey(item.key)!;

        // Local change: insert "X" at position 1
        item.set('body', makeRichTextInserted(baseText, 'X', 1));
        await db.flush('/richtext-test/rt2');

        // Remote change: insert "Y" at position 1
        const remote = createRemoteCommit({
          key: item.key,
          schema: RS,
          data: { body: makeRichTextInserted(baseText, 'Y', 1) },
          parents: [baseHead.id],
          session: 'remote-rt',
          timestamp: Date.now() - 10_000,
        });
        await repo.persistVerifiedCommits([remote]);
        await sleep(200); // Wait for automatic merge

        const result = repo.valueForKey(item.key);
        assertExists(result, 'merged value should exist');
        const content = getRichTextContent(result![0]);
        // Both insertions should be present in some deterministic order
        assertTrue(
          content.includes('X'),
          `merged text should contain "X", got: "${content}"`,
        );
        assertTrue(
          content.includes('Y'),
          `merged text should contain "Y", got: "${content}"`,
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );

  TEST(
    'MergeRichText',
    'concurrent deletion and insertion',
    async (ctx) => {
      const db = await ctx.createDB('rt-del-ins', {
        registry: kMergeTestRegistry,
      });
      try {
        await db.readyPromise();

        const baseText = 'ABCD';

        // Create item via GoatDB API
        const item = db.create('/richtext-test/rt3', kRichTextTestSchema, {
          body: makeRichText(baseText),
        });
        await db.flush('/richtext-test/rt3');

        const repo = db.repository('/richtext-test/rt3')!;
        const baseHead = repo.headForKey(item.key)!;

        // Local change: delete char at position 1 (B) -> "ACD"
        item.set('body', makeRichTextDeleted(baseText, 1, 1));
        await db.flush('/richtext-test/rt3');

        // Remote change: insert "X" at position 1 -> "AXBCD"
        const remote = createRemoteCommit({
          key: item.key,
          schema: RS,
          data: { body: makeRichTextInserted(baseText, 'X', 1) },
          parents: [baseHead.id],
          session: 'remote-rt',
          timestamp: Date.now() - 10_000,
        });
        await repo.persistVerifiedCommits([remote]);
        await sleep(200); // Wait for automatic merge

        const result = repo.valueForKey(item.key);
        assertExists(result, 'merged value should exist');
        const content = getRichTextContent(result![0]);
        // Insertion should be preserved
        assertTrue(
          content.includes('X'),
          `merged text should contain inserted "X", got: "${content}"`,
        );
        // A and D should still be present
        assertTrue(
          content.includes('A'),
          `merged text should contain "A", got: "${content}"`,
        );
        assertTrue(
          content.includes('D'),
          `merged text should contain "D", got: "${content}"`,
        );
      } finally {
        await db.flushAll();
        await db.close();
      }
    },
  );
}
