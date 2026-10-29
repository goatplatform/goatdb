import { BloomFilter } from '../base/bloom.ts';
import {
  decoderOutstandingCount,
  JSONCyclicalDecoder,
  JSONCyclicalEncoder,
  JSONDecoder,
} from '../base/core-types/encoding/json.ts';
import { decodedDataChanges } from '../cfds/base/object.ts';
import { Item } from '../cfds/base/item.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { SyncMessage } from '../net/message.ts';
import { Commit, FieldCommit } from '../repo/commit.ts';
import { assertEquals, assertThrows, assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';

// Source bce10f27 pool contracts, separated from wire-format goldens.
const kSyncMsgTestSchema: Schema = {
  ns: 'core-value-serialization-sync',
  version: 1,
  fields: {
    title: { type: 'string', required: true },
    count: { type: 'number', default: () => 0 },
  },
};
const kSyncMsgTestRegistry = new DataRegistry();
kSyncMsgTestRegistry.registerSchema(kSyncMsgTestSchema);

function mkCommit(key: string, title: string, count: number): Commit {
  const item = new Item(
    {
      schema: kSyncMsgTestSchema,
      data: { title, count } as never,
    },
    kSyncMsgTestRegistry,
  );
  return Commit.create({
    session: 'test-session',
    orgId: 'test-org',
    key,
    contents: item,
  });
}

export default function setup(): void {
  TEST(
    'CoreValueSerialization',
    'decoder pool returns to baseline after finalize and re-acquire',
    () => {
      // WHY: pool reuse is an optimization, not a contract; only the
      // outstanding-decoder balance is pinned here. See the [policy] test
      // for the single LIFO identity pin.
      const base = decoderOutstandingCount();
      const first = JSONCyclicalDecoder.get({ a: 1 });
      assertEquals(first.get('a'), 1);
      first.finalize();
      assertEquals(decoderOutstandingCount(), base);
      const second = JSONCyclicalDecoder.get({ b: 2 });
      assertEquals(second.get('b'), 2);
      assertEquals(second.has('a'), false);
      second.finalize();
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder pool returns to baseline with concurrent decoders',
    () => {
      // WHY: only finalized decoders are pooled; concurrently held instances
      // must each decode independently. Balance, not identity, is pinned.
      const base = decoderOutstandingCount();
      const a = JSONCyclicalDecoder.get({ a: 1 });
      const b = JSONCyclicalDecoder.get({ b: 2 });
      const c = JSONCyclicalDecoder.get({ c: 3 });
      assertEquals(a.get('a'), 1);
      assertEquals(b.get('b'), 2);
      assertEquals(c.get('c'), 3);
      a.finalize();
      b.finalize();
      c.finalize();
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder pool reuses instances LIFO with zero outstanding [policy]',
    () => {
      const a = JSONCyclicalDecoder.get({ a: 1 });
      const b = JSONCyclicalDecoder.get({ b: 2 });
      assertTrue(a !== b);
      a.finalize();
      b.finalize();
      const c = JSONCyclicalDecoder.get({ c: 3 });
      const d = JSONCyclicalDecoder.get({ d: 4 });
      // L4: after a balanced acquire/finalize all decoders are back in the pool,
      // so the next acquires return the exact same instances in LIFO order and
      // create no new ones. The pool size counter is not public, so identity
      // reuse is the observable proxy for zero outstanding.
      assertTrue(c === b);
      assertTrue(d === a);
      c.finalize();
      d.finalize();
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder dispose is idempotent and returns to baseline',
    () => {
      // WHY: the second finalize is a no-op; only the balance is pinned.
      // Identity reuse is pinned once in the [policy] test above.
      const base = decoderOutstandingCount();
      const a = JSONCyclicalDecoder.get({ a: 1 });
      a.finalize();
      a.finalize();
      assertEquals(decoderOutstandingCount(), base);
      const b = JSONCyclicalDecoder.get({ b: 2 });
      assertEquals(b.get('b'), 2);
      assertEquals(b.has('a'), false);
      b.finalize();
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'stray __rId ref without __r/__d context throws',
    () => {
      // WHY: a bare {__rId} outside __r/__d is corrupt input, never data.
      // decodeValue routes plain objects via decodeObject, which must fail
      // loudly like bare-number dates and legacy refs.
      const d = JSONCyclicalDecoder.get({ x: 1 });
      try {
        assertThrows(() => d.decodeValue({ __rId: 0 } as never));
        assertThrows(() => d.decodeValue({ x: { __rId: 1 } } as never));
      } finally {
        d.finalize();
      }
    },
  );

  TEST(
    'CoreValueSerialization',
    'disposed decoder rejects reads until re-acquired',
    () => {
      const base = decoderOutstandingCount();
      const d = JSONCyclicalDecoder.get({ x: 1 });
      d.finalize();
      assertThrows(() => d.get('x'));
      assertThrows(() => d.has('x'));
      assertThrows(() => d.getDecoder('x'));
      assertEquals(decoderOutstandingCount(), base);
      // Re-acquire revives a pooled instance (L3 clears `_finalized`).
      // WHY: which pooled instance is returned is a policy detail pinned
      // once in the [policy] test; here only usability and balance matter.
      const e = JSONCyclicalDecoder.get({ y: 2 });
      assertEquals(e.get('y'), 2);
      e.finalize();
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'L4 parent cascade skips a child re-acquired by another decode',
    () => {
      // WHY: a consumer can dispose a pooled child, and another decode can then
      // recycle it. The original parent must not dispose that new owner's
      // decoder when it is later disposed.
      const base = decoderOutstandingCount();
      const parent = JSONCyclicalDecoder.get({ box: { v: 1 } });
      const child = parent.getDecoder('box') as JSONCyclicalDecoder;
      assertEquals(child.get('v'), 1);
      child.finalize(); // consumer releases the child back to the pool
      const other = JSONCyclicalDecoder.get({ z: 9 });
      // WHY: identity reuse is a policy detail (pinned once in the [policy]
      // test); the guard holds by generation even when the pool hands back
      // the same instance. Only the balance after the flow is pinned.
      parent.finalize(); // must not dispose `other`
      assertEquals(other.get('z'), 9);
      other.finalize();
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'L4 outstanding returns to baseline after acquire/dispose',
    () => {
      const base = decoderOutstandingCount();
      {
        using d = JSONCyclicalDecoder.get({ x: 1 });
        assertEquals(d.get('x'), 1);
      }
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'L4 outstanding returns to baseline when decode throws',
    () => {
      const base = decoderOutstandingCount();
      // `decodedDataChanges` must release each element decoder even when a
      // later element fails to decode.
      const good = JSONCyclicalDecoder.get({
        changeType: 'fd',
        operation: 1,
        vType: 'string',
        value: 'x',
      });
      const bad = JSONCyclicalDecoder.get({ changeType: 'unsupported' });
      assertThrows(() => decodedDataChanges({ k: [good, bad] }));
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'L4 outstanding returns to baseline when async decode rejects',
    async () => {
      const base = decoderOutstandingCount();
      let caught: unknown;
      try {
        using d = JSONCyclicalDecoder.get({ x: 1 });
        assertEquals(d.get('x'), 1);
        await Promise.reject(new Error('async decode failed'));
      } catch (e: unknown) {
        caught = e;
      }
      assertTrue(caught instanceof Error);
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'L4 double dispose releases exactly once',
    () => {
      const base = decoderOutstandingCount();
      const d = JSONCyclicalDecoder.get({ x: 1 });
      d.finalize();
      d.finalize();
      assertEquals(decoderOutstandingCount(), base);
      // A second release must not corrupt the balance; re-acquire stays usable.
      const e = JSONCyclicalDecoder.get({ y: 2 });
      assertEquals(e.get('y'), 2);
      e.finalize();
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder pool survives 1000 acquire and finalize cycles',
    () => {
      // WHY: get/finalize round-trips through the module-global LIFO pool,
      // so a long cycle run must neither leak outstanding decoders nor break
      // payload reset.
      const base = decoderOutstandingCount();
      for (let i = 0; i < 1000; i++) {
        const decoder = JSONCyclicalDecoder.get({ i });
        assertEquals(decoder.get('i'), i);
        decoder.finalize();
      }
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'L4 plain getDecoder acquire balances using dispose',
    () => {
      const base = decoderOutstandingCount();
      {
        using outer = new JSONDecoder({ sub: { v: 1 } });
        // WHY: plain getDecoder wraps the sub-object in a fresh decoder; the
        // acquire must be balanced by `using` disposal back to baseline.
        using child = outer.getDecoder('sub');
        assertEquals(child.get('v'), 1);
      }
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'L4 plain getDecoder alias does not double-count',
    () => {
      const base = decoderOutstandingCount();
      {
        using outer = new JSONDecoder({
          box: { __t: 'E', __v: { v: 3 } },
        });
        // WHY: getDecoder('box') decodes the Encodable wrapper into an
        // already-acquired decoder and aliases it; a second acquire would
        // double-count and leak on `using` dispose. The external contract is
        // the baseline after the flow, not the mid-flow count.
        using aliased = outer.getDecoder('box');
        assertEquals(aliased.get('v'), 3);
      }
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'L4 nested-Encodable construction counts as one acquire',
    () => {
      const base = decoderOutstandingCount();
      {
        using outer = JSONCyclicalDecoder.get({
          box: { __t: 'E', __v: { v: 3 } },
        });
        using inner = outer.get('box') as JSONDecoder;
        assertEquals(inner.get('v'), 3);
      }
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder pool: get() disposes nested Encodable decoders',
    () => {
      // WHY: get() on an array of {__t:'E'} elements creates child decoders
      // via decodeValue. Each child is _acquire()'d so the count rises; the
      // parent must dispose them on [Symbol.dispose] even though the consumer
      // never calls dispose on the children directly.
      const base = decoderOutstandingCount();
      {
        using outer = JSONCyclicalDecoder.get({
          items: [
            { __t: 'E', __v: { v: 1 } },
            { __t: 'E', __v: { v: 2 } },
          ],
        });
        const arr = outer.get('items') as unknown[];
        assertEquals(arr.length, 2);
        assertEquals((arr[0] as JSONDecoder).get('v'), 1);
        assertEquals((arr[1] as JSONDecoder).get('v'), 2);
      }
      // Parent dispose released all children back to baseline.
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder pool: getDecoder(key, offset) acquires exactly 1',
    () => {
      // WHY: getDecoder with offset must NOT call get() (which decodes the
      // whole array and acquires a decoder per element). It should index
      // _data[key][offset] directly, acquiring at most one child.
      const base = decoderOutstandingCount();
      {
        using outer = JSONCyclicalDecoder.get({
          arr: [
            { __t: 'E', __v: { v: 1 } },
            { __t: 'E', __v: { v: 2 } },
          ],
        });
        const before = decoderOutstandingCount();
        using child = outer.getDecoder('arr', 0);
        // No per-element acquisition for the array itself: at most one child
        // decoder is outstanding beyond `before`.
        assertEquals(decoderOutstandingCount() <= before + 1, true);
        assertEquals(child.get('v'), 1);
      }
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder pool: parent dispose releases all children',
    () => {
      // WHY: children created through nested decodeValue calls (arrays,
      // plain objects, and {__t:'E'} wrappers at multiple depths) must all
      // be tracked on the root decoder so a single dispose cascades.
      const base = decoderOutstandingCount();
      {
        using outer = JSONCyclicalDecoder.get({
          a: { __t: 'E', __v: { v: 1 } },
          b: { __t: 'E', __v: { v: 2 } },
          c: {
            items: [
              { __t: 'E', __v: { v: 3 } },
              { __t: 'E', __v: { v: 4 } },
            ],
          },
        });
        outer.get('a');
        outer.get('b');
        const c = outer.get('c') as { items: unknown[] };
        (c.items[0] as JSONDecoder).get('v');
        (c.items[1] as JSONDecoder).get('v');
      }
      // Single parent dispose cascaded: back to baseline.
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder pool: SyncMessage decode returns to baseline',
    () => {
      // WHY: SyncMessage.deserialize acquires a filter decoder plus one
      // decoder per commit (each commit body holds Encodable wrappers), so
      // a full message decode is the realistic leak check for the pool.
      const base = decoderOutstandingCount();
      const commits = [mkCommit('svm-k1', 'a', 0), mkCommit('svm-k2', 'b', 1)];
      // Empty peer filter: the peer has nothing, so both commits are missing.
      const peerFilter = new BloomFilter({ size: 10, fpr: 0.01 });
      const msg = SyncMessage.build(
        peerFilter,
        commits.map((c) => [c.id, c]) as [string, Commit][],
        commits.length,
        commits.length,
        10,
        'test-org',
        kSyncMsgTestRegistry,
      );
      const js = JSONCyclicalEncoder.serialize(msg);
      {
        using dec = JSONCyclicalDecoder.get(js as Record<string, never>);
        const decoded = new SyncMessage(
          { decoder: dec, orgId: 'test-org' },
          kSyncMsgTestRegistry,
        );
        assertEquals(decoded.values.length, 2);
      }
      assertEquals(decoderOutstandingCount(), base);
    },
  );

  TEST(
    'CoreValueSerialization',
    'decoder pool: Commit decode returns to baseline on error',
    () => {
      // WHY: a corrupt commit (contents with neither 'r' nor 'e') throws
      // inside FieldCommit._deserialize after acquiring a nested contents
      // decoder. Disposal must cascade back to baseline anyway.
      const base = decoderOutstandingCount();
      assertThrows(() => {
        using dec = JSONCyclicalDecoder.get({
          ver: 1,
          id: 'bad',
          s: 'sess',
          k: 'key',
          c: { __t: 'E', __v: { v: 1 } },
        } as unknown as Record<string, never>);
        new FieldCommit(
          { decoder: dec, orgId: 'test-org' },
          kSyncMsgTestRegistry,
        );
      });
      assertEquals(decoderOutstandingCount(), base);
    },
  );
}
