import { CoroutineQueue, CoroutineScheduler } from '../base/coroutine.ts';
import { assertEquals } from './asserts.ts';
import { TEST } from './mod.ts';

// deno-lint-ignore require-yield
function* record(order: string[], label: string): Generator<void, void> {
  order.push(label);
}

export default function setupCoroutineQueueTests(): void {
  TEST(
    'CoroutineQueue',
    'executes an initial batch in scheduling order',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());
      const order: string[] = [];

      await Promise.all([
        queue.schedule(record(order, 'A')),
        queue.schedule(record(order, 'B')),
        queue.schedule(record(order, 'C')),
      ]);

      assertEquals(order, ['A', 'B', 'C']);
    },
  );

  TEST(
    'CoroutineQueue',
    'does not start an overlapping worker for work added by an active task',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());
      const order: string[] = [];
      const addedTasks: Promise<void>[] = [];

      function* firstTask(): Generator<void, void> {
        order.push('A:start');
        addedTasks.push(queue.schedule(record(order, 'B')));
        addedTasks.push(queue.schedule(record(order, 'C')));
        yield;
        order.push('A:end');
      }

      await queue.schedule(firstTask());
      await Promise.all(addedTasks);

      assertEquals(order, ['A:start', 'A:end', 'B', 'C']);
    },
  );

  TEST(
    'CoroutineQueue',
    'preserves FIFO with multi-yield generators',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());
      const order: string[] = [];

      // Generator that yields multiple times — tests interleaving doesn't
      // break serial FIFO execution.
      function* gen(label: string, count: number): Generator<void, void> {
        for (let i = 0; i < count; i++) {
          order.push(`${label}:${i}`);
          yield;
        }
        order.push(`${label}:done`);
      }

      await Promise.all([
        queue.schedule(gen('A', 3)),
        queue.schedule(gen('B', 2)),
        queue.schedule(gen('C', 1)),
      ]);

      // A must fully finish all its yields before B starts, and B before C.
      assertEquals(order, [
        'A:0',
        'A:1',
        'A:2',
        'A:done',
        'B:0',
        'B:1',
        'B:done',
        'C:0',
        'C:done',
      ]);
    },
  );

  TEST(
    'CoroutineQueue',
    'reports correct size during and after execution',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());
      const order: string[] = [];

      // Schedule before the worker runs — queue should reflect pending count.
      const p1 = queue.schedule(record(order, 'A'));
      assertEquals(queue.size, 1);
      const p2 = queue.schedule(record(order, 'B'));
      assertEquals(queue.size, 2);

      await Promise.all([p1, p2]);
      assertEquals(queue.size, 0);
      assertEquals(order, ['A', 'B']);
    },
  );

  TEST(
    'CoroutineQueue',
    'accepts new work after queue drains',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());
      const order: string[] = [];

      // First batch
      await Promise.all([
        queue.schedule(record(order, 'A')),
        queue.schedule(record(order, 'B')),
      ]);
      assertEquals(order, ['A', 'B']);
      assertEquals(queue.size, 0);

      // A drained queue must run newly scheduled work in a fresh worker.
      await queue.schedule(record(order, 'C'));
      assertEquals(order, ['A', 'B', 'C']);
    },
  );

  TEST(
    'CoroutineQueue',
    'maintains FIFO with large batches',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());
      const order: string[] = [];
      const count = 50;
      const promises: Promise<void>[] = [];

      for (let i = 0; i < count; i++) {
        promises.push(queue.schedule(record(order, `T${i}`)));
      }

      await Promise.all(promises);

      const expected = Array.from({ length: count }, (_, i) => `T${i}`);
      assertEquals(order, expected);
    },
  );

  TEST(
    'CoroutineQueue',
    'continues FIFO after a throwing task',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());
      const order: string[] = [];

      // deno-lint-ignore require-yield
      function* bad(): Generator<void, void> {
        throw new Error('boom');
      }

      const pA = queue.schedule(record(order, 'A'));
      const pB = queue.schedule(bad());
      const pC = queue.schedule(record(order, 'C'));

      const results = await Promise.allSettled([pA, pB, pC]);

      assertEquals(results[0].status, 'fulfilled');
      assertEquals(results[1].status, 'rejected');
      assertEquals(results[2].status, 'fulfilled');
      // Rejected task does not contribute to order; queue proceeds.
      assertEquals(order, ['A', 'C']);
      assertEquals(queue.size, 0);
    },
  );

  TEST(
    'CoroutineQueue',
    'skips a queued item cancelled via cancelImmediately',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());
      const order: string[] = [];

      const pA = queue.schedule(record(order, 'A'));
      const pB = queue.schedule(record(order, 'B'));
      const pC = queue.schedule(record(order, 'C'));

      // Cancel B synchronously before worker tick — exercises
      // while(!completed) skip in _workCoroutine.
      pB.cancelImmediately();

      await Promise.all([pA, pB, pC]);

      assertEquals(order, ['A', 'C']);
      assertEquals(queue.size, 0);
    },
  );

  TEST(
    'CoroutineQueue',
    'propagates return values',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());

      function* retNum(): Generator<number, number> {
        yield 0;
        return 42;
      }

      // deno-lint-ignore require-yield
      function* retStr(): Generator<string, string> {
        return 'hi';
      }

      const vNum = await queue.schedule(retNum());
      assertEquals(vNum, 42);

      const vStr = await queue.schedule(retStr());
      assertEquals(vStr, 'hi');

      // Ordering: both return values resolve via FIFO.
      const p1 = queue.schedule(retNum());
      const p2 = queue.schedule(retStr());
      const [r1, r2] = await Promise.all([p1, p2]);
      assertEquals(r1, 42);
      assertEquals(r2, 'hi');
      assertEquals(queue.size, 0);
    },
  );
}
