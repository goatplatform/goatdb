import { flattenRichText } from '../cfds/richtext/flat-rep.ts';
import { normalizeRichText } from '../cfds/richtext/normalize/index.ts';
import { StringRep } from '../cfds/richtext/string-rep.ts';
import {
  kCoreValueTreeNodeOpts,
  type RichText,
} from '../cfds/richtext/tree.ts';
import { assertEquals } from './asserts.ts';
import { TEST } from './mod.ts';

// Rich-text characterization: pinned output for the normalize, flat-rep and
// StringRep layers. These depend on core-value clone/equals/hash, but they are
// not serializer contracts, so they live outside the core-value suite.

const kRichTextDoc: RichText = {
  root: {
    children: [
      { tagName: 'p', children: [{ text: 'hi' }] },
      { tagName: 'p', children: [{ text: 'yo' }] },
    ],
  },
};

export default function setup(): void {
  TEST(
    'RichTextSerialization',
    'nested non-ref inline-task moves to sibling below',
    () => {
      // WHY: setup.ts registers the inline-task rule under the node key
      // `t_inline-task`, which getKeysForNode already emits for any element with
      // that tagName. The planned isRefMarker matcher removal (#82) only removes
      // the legacy ref registration path; plain inline-task nodes match before
      // and after.
      const doc = {
        root: {
          children: [
            {
              tagName: 'p',
              children: [
                { text: 'a' },
                { tagName: 'inline-task', children: [{ text: 'task' }] },
                { text: 'b' },
              ],
            },
          ],
        },
      } as unknown as RichText;
      const out = normalizeRichText(doc);
      const kids = out.root.children as { tagName?: string }[];
      assertEquals(kids.length, 3);
      assertEquals(kids[0].tagName, 'p');
      assertEquals(kids[1].tagName, 'inline-task');
      assertEquals(kids[2].tagName, 'p');
    },
  );

  TEST(
    'RichTextSerialization',
    'flatRep produces a stable atom stream',
    () => {
      const flat = Array.from(flattenRichText(kRichTextDoc, true, true));
      assertEquals(
        JSON.stringify(flat),
        '[{"__elementSpacer":true},{"tagName":"p","children":[{"text":"hi"}]},{"depthMarker":1},{"text":"h"},{"text":"i"},{"text":""},{"depthMarker":0},{"__elementSpacer":true},{"tagName":"p","children":[{"text":"yo"}]},{"depthMarker":1},{"text":"y"},{"text":"o"},{"text":""},{"depthMarker":0}]',
      );
    },
  );

  TEST(
    'RichTextSerialization',
    'StringRep encode is byte-identical and decodes',
    () => {
      const flat = Array.from(flattenRichText(kRichTextDoc, true, true));
      const rep = new StringRep(kCoreValueTreeNodeOpts);
      const encoded = rep.encode(flat);
      // WHY: code points are assigned in first-seen order; element nodes ignore
      // their children (treeAtomKeyFilterIgnoreText), so both paragraphs share
      // code 1 while text nodes stay distinct.
      assertEquals(
        encoded,
        '\n\u0001\u0002\u0003\u0004\u0005\u0006\n\u0001\u0002\u0007\b\u0005\u0006',
      );
      assertEquals(
        [...encoded].map((c) => c.codePointAt(0)),
        [10, 1, 2, 3, 4, 5, 6, 10, 1, 2, 7, 8, 5, 6],
      );
      assertEquals(Array.from(rep.decode(encoded)).length, flat.length);
    },
  );
}
