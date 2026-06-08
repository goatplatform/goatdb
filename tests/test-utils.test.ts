import { TEST } from './mod.ts';
import { assertEquals, assertThrows } from './asserts.ts';
import { getEffectiveCWD } from '../base/runtime/index.ts';
import { withTestCWD } from './test-utils.ts';

export default function setupTestUtilsTests(): void {
  TEST(
    'TestUtils',
    'withTestCWD restores the effective cwd after async rejection',
    async () => {
      const originalCWD = getEffectiveCWD();

      await assertThrows(
        async () => {
          await withTestCWD('/test-utils-rejection', async () => {
            assertEquals(getEffectiveCWD(), '/test-utils-rejection');
            await Promise.resolve();
            throw new Error('withTestCWD-async-rejection');
          });
        },
        Error,
        'withTestCWD-async-rejection',
      );

      assertEquals(
        getEffectiveCWD(),
        originalCWD,
        'withTestCWD must restore the original cwd after async rejection',
      );
    },
  );
}
