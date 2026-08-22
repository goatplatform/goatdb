import { Coroutine, CoroutineScheduler } from '../base/coroutine.ts';
import { assertEquals } from './asserts.ts';
import { fail, record } from './coroutine-test-helpers.ts';
import { TEST } from './mod.ts';

export default function setupCoroutineSchedulerTests(): void {
  TEST(
    'Coroutine',
    'does not mark a failed coroutine as cancelled',
    async () => {
      const error = new Error('boom');
      const [coroutine, promise] = Coroutine.pack(1, fail(error));
      coroutine.run();
      const [result] = await Promise.allSettled([promise]);

      assertEquals(coroutine.cancelled, false);
      assertEquals(result.status, 'rejected');
      if (result.status === 'rejected') assertEquals(result.reason, error);
    },
  );

  TEST('CoroutineScheduler', 'continues after a coroutine throws', async () => {
    const scheduler = new CoroutineScheduler();
    const error = new Error('boom');
    const order: string[] = [];
    const results = await Promise.allSettled([
      scheduler.schedule(fail(error)),
      scheduler.schedule(record(order, 'sibling')),
    ]);

    assertEquals(results[0].status, 'rejected');
    if (results[0].status === 'rejected') {
      assertEquals(results[0].reason, error);
    }
    assertEquals(results[1].status, 'fulfilled');
    await scheduler.schedule(record(order, 'later'));
    assertEquals(order, ['sibling', 'later']);
  });
}
