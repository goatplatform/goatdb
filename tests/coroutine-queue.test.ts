import {
  type CancellablePromise,
  Coroutine,
  CoroutineQueue,
  CoroutineScheduler,
  type Scheduler,
} from '../base/coroutine.ts';
import { assertEquals } from './asserts.ts';
import { fail, record } from './coroutine-test-helpers.ts';
import { TEST } from './mod.ts';

class StepScheduler implements Scheduler {
  private _coroutine: Coroutine<unknown> | undefined;

  schedule<T>(g: Generator<T, T>): CancellablePromise<T> {
    const [coroutine, promise] = Coroutine.pack(0, g);
    this._coroutine = coroutine as Coroutine<unknown>;
    return promise;
  }

  runNext(): void {
    if (!this._coroutine) throw new Error('No coroutine scheduled');
    this._coroutine.run();
  }
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
    'continues FIFO after a throwing task',
    async () => {
      const queue = new CoroutineQueue(new CoroutineScheduler());
      const order: string[] = [];

      const error = new Error('boom');

      const pA = queue.schedule(record(order, 'A'));
      const pB = queue.schedule(fail(error));
      const pC = queue.schedule(record(order, 'C'));

      const results = await Promise.allSettled([pA, pB, pC]);

      assertEquals(results[0].status, 'fulfilled');
      assertEquals(results[1].status, 'rejected');
      if (results[1].status === 'rejected') {
        assertEquals(results[1].reason, error);
      }
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

  TEST(
    'CoroutineQueue',
    'maintains FIFO and reuse after a large batch',
    async () => {
      const scheduler = new StepScheduler();
      const queue = new CoroutineQueue(scheduler);
      const order: string[] = [];
      const promises: Promise<void>[] = [];

      // A large batch protects FIFO and drain/reuse behavior under sustained work.
      const count = 100;
      for (let i = 0; i < count; i++) {
        promises.push(queue.schedule(record(order, `T${i}`)));
      }
      for (let i = 0; i <= count; i++) scheduler.runNext();

      await Promise.all(promises);

      const expected = Array.from(
        { length: count },
        (_, i) => `T${i}`,
      );
      assertEquals(order, expected);
      assertEquals(queue.size, 0);
      const probe: string[] = [];
      const probePromise = queue.schedule(record(probe, 'after'));
      scheduler.runNext();
      await probePromise;
      scheduler.runNext();
      assertEquals(probe, ['after']);
    },
  );

  TEST(
    'CoroutineQueue',
    'respects cooperative cancellation via cancel()',
    async () => {
      const scheduler = new StepScheduler();
      const queue = new CoroutineQueue(scheduler);
      const order: string[] = [];

      function* cancellable(): Generator<void, void> {
        order.push('started');
        yield;
        const current = Coroutine.current();
        if (current && !current.shouldRun) {
          order.push('cancelled-cooperatively');
          return;
        }
        order.push('should-not-reach');
      }

      const p = queue.schedule(cancellable());
      // WHY: Drive exactly one worker step so cancellation occurs at its yield.
      scheduler.runNext();
      p.cancel();
      scheduler.runNext();
      await p;
      scheduler.runNext();

      assertEquals(order, ['started', 'cancelled-cooperatively']);
      assertEquals(queue.size, 0);
      const probe: string[] = [];
      const probePromise = queue.schedule(record(probe, 'after'));
      scheduler.runNext();
      await probePromise;
      scheduler.runNext();
      assertEquals(probe, ['after']);
    },
  );
}
