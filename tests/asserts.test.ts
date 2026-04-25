import { TEST, type TestSuite } from './mod.ts';
import {
  assertEquals,
  assertExists,
  assertFalse,
  assertLessThan,
  assertNotExists,
  assertThrows,
  assertTrue,
  expectToContain,
} from './asserts.ts';
import {
  getGlobalLoggerStreams,
  setGlobalLoggerStreams,
} from '../logging/log.ts';

export default function setupAssertsTests() {
  TEST(
    'Asserts',
    'assertThrows restores logger streams after sync success',
    (_ctx: TestSuite) => {
      const previousStreams = getGlobalLoggerStreams();
      const customStreams = [{ appendEntry() {} }];
      setGlobalLoggerStreams(customStreams);
      try {
        assertThrows(() => {
          throw new Error('boom');
        });
        assertTrue(
          getGlobalLoggerStreams() === customStreams,
          'assertThrows must restore logger streams after a sync throw',
        );
      } finally {
        setGlobalLoggerStreams(previousStreams);
      }
    },
  );

  TEST(
    'Asserts',
    'assertThrows restores logger streams after sync failure',
    (_ctx: TestSuite) => {
      const previousStreams = getGlobalLoggerStreams();
      const customStreams = [{ appendEntry() {} }];
      setGlobalLoggerStreams(customStreams);
      try {
        let threw = false;
        try {
          assertThrows(() => {/* no throw */});
        } catch (_e) {
          threw = true;
        }
        assertTrue(threw, 'assertThrows must fail when sync fn does not throw');
        assertTrue(
          getGlobalLoggerStreams() === customStreams,
          'assertThrows must restore logger streams after a sync failure',
        );
      } finally {
        setGlobalLoggerStreams(previousStreams);
      }
    },
  );

  TEST(
    'Asserts',
    'assertThrows restores logger streams after async success',
    async (_ctx: TestSuite) => {
      const previousStreams = getGlobalLoggerStreams();
      const customStreams = [{ appendEntry() {} }];
      setGlobalLoggerStreams(customStreams);
      try {
        await assertThrows(async () => {
          throw new Error('async boom');
        });
        assertTrue(
          getGlobalLoggerStreams() === customStreams,
          'assertThrows must restore logger streams after an async rejection',
        );
      } finally {
        setGlobalLoggerStreams(previousStreams);
      }
    },
  );

  TEST(
    'Asserts',
    'assertThrows restores logger streams after async mismatch failure',
    async (_ctx: TestSuite) => {
      const previousStreams = getGlobalLoggerStreams();
      const customStreams = [{ appendEntry() {} }];
      setGlobalLoggerStreams(customStreams);
      try {
        let threw = false;
        try {
          await assertThrows(async () => {
            throw new Error('generic');
          }, TypeError);
        } catch (_e) {
          threw = true;
        }
        assertTrue(
          threw,
          'assertThrows must fail when async rejection does not match the requested error class',
        );
        assertTrue(
          getGlobalLoggerStreams() === customStreams,
          'assertThrows must restore logger streams after an async mismatch failure',
        );
      } finally {
        setGlobalLoggerStreams(previousStreams);
      }
    },
  );

  TEST('Asserts', 'assertThrows catches sync throws', (_ctx: TestSuite) => {
    assertThrows(() => {
      throw new Error('boom');
    });
  });

  TEST(
    'Asserts',
    'assertThrows fails when sync does not throw',
    (_ctx: TestSuite) => {
      let threw = false;
      try {
        assertThrows(() => {/* no throw */});
      } catch (_e) {
        threw = true;
      }
      assertTrue(threw, 'assertThrows must throw when fn does not throw');
    },
  );

  TEST(
    'Asserts',
    'assertThrows catches async rejection',
    async (_ctx: TestSuite) => {
      await assertThrows(async () => {
        throw new Error('async boom');
      });
    },
  );

  TEST(
    'Asserts',
    'assertThrows fails when async does not reject',
    async (_ctx: TestSuite) => {
      let threw = false;
      try {
        await assertThrows(async () => {/* no throw */});
      } catch (_e) {
        threw = true;
      }
      assertTrue(
        threw,
        'assertThrows must throw when async fn does not reject',
      );
    },
  );

  TEST(
    'Asserts',
    'assertThrows checks error class (sync)',
    (_ctx: TestSuite) => {
      class MyError extends Error {}
      assertThrows(() => {
        throw new MyError('typed');
      }, MyError);
      // Wrong class must fail
      let threw = false;
      try {
        assertThrows(() => {
          throw new Error('generic');
        }, MyError);
      } catch (_e) {
        threw = true;
      }
      assertTrue(threw, 'Wrong error class must cause assertThrows to throw');
    },
  );

  TEST(
    'Asserts',
    'assertThrows checks message substring (sync)',
    (_ctx: TestSuite) => {
      assertThrows(
        () => {
          throw new Error('exact message here');
        },
        Error,
        'exact message',
      );
      let threw = false;
      try {
        assertThrows(
          () => {
            throw new Error('different');
          },
          Error,
          'not present',
        );
      } catch (_e) {
        threw = true;
      }
      assertTrue(threw, 'Missing substring must cause assertThrows to throw');
    },
  );

  TEST(
    'Asserts',
    'assertThrows checks error class (async)',
    async (_ctx: TestSuite) => {
      class MyError extends Error {}
      await assertThrows(async () => {
        throw new MyError('typed');
      }, MyError);
      let threw = false;
      try {
        await assertThrows(async () => {
          throw new Error('generic');
        }, MyError);
      } catch (_e) {
        threw = true;
      }
      assertTrue(
        threw,
        'Wrong error class in async must cause assertThrows to throw',
      );
    },
  );

  TEST(
    'Asserts',
    'assertThrows 2-arg string overload (failMessage)',
    (_ctx: TestSuite) => {
      // Passing case: fn throws, custom message is unused
      assertThrows(() => {
        throw new Error('boom');
      }, 'custom msg');
      // Failing case: fn does NOT throw, AssertionError message must be 'custom msg'
      let threw = false;
      let msg = '';
      try {
        assertThrows(() => {/* no throw */}, 'custom msg');
      } catch (e) {
        threw = true;
        msg = e instanceof Error ? e.message : '';
      }
      assertTrue(
        threw,
        'assertThrows must throw when fn does not throw (string overload)',
      );
      assertEquals(
        msg,
        'custom msg',
        'Error message must equal the custom failMessage',
      );
    },
  );

  TEST(
    'Asserts',
    'assertThrows handles non-Error thrown values',
    (_ctx: TestSuite) => {
      // Throwing a plain string must pass when no errorClass is specified
      assertThrows(() => {
        throw 'a string';
      });
      // Throwing a plain string when an Error class is expected must fail
      let threw = false;
      try {
        assertThrows(() => {
          throw 'a string';
        }, Error);
      } catch (_e) {
        threw = true;
      }
      assertTrue(
        threw,
        'Non-Error thrown value must fail when errorClass is Error',
      );
    },
  );

  TEST(
    'Asserts',
    'assertThrows async with both errorClass and msgSubstring',
    async (_ctx: TestSuite) => {
      // Correct class + matching substring must pass
      await assertThrows(
        async () => {
          throw new TypeError('bad input value');
        },
        TypeError,
        'bad input',
      );
      // Correct class + wrong substring must fail
      let threw = false;
      try {
        await assertThrows(
          async () => {
            throw new TypeError('bad input value');
          },
          TypeError,
          'not present',
        );
      } catch (_e) {
        threw = true;
      }
      assertTrue(
        threw,
        'Wrong msgSubstring in async must cause assertThrows to throw',
      );
    },
  );

  TEST('Asserts', 'assertFalse passes for false', (_ctx: TestSuite) => {
    assertFalse(false);
  });

  TEST('Asserts', 'assertFalse fails for true', (_ctx: TestSuite) => {
    let threw = false;
    try {
      assertFalse(true);
    } catch (_e) {
      threw = true;
    }
    assertTrue(threw, 'assertFalse must throw when value is true');
  });

  TEST(
    'Asserts',
    'assertFalse uses custom message',
    (_ctx: TestSuite) => {
      let msg = '';
      try {
        assertFalse(true, 'custom false msg');
      } catch (e) {
        msg = e instanceof Error ? e.message : '';
      }
      assertEquals(msg, 'custom false msg');
    },
  );

  TEST('Asserts', 'assertNotExists passes for null', (_ctx: TestSuite) => {
    assertNotExists(null);
  });

  TEST(
    'Asserts',
    'assertNotExists passes for undefined',
    (_ctx: TestSuite) => {
      assertNotExists(undefined);
    },
  );

  TEST(
    'Asserts',
    'assertNotExists fails for non-null value',
    (_ctx: TestSuite) => {
      let threw = false;
      try {
        assertNotExists('something');
      } catch (_e) {
        threw = true;
      }
      assertTrue(threw, 'assertNotExists must throw for non-null value');
    },
  );

  TEST(
    'Asserts',
    'assertNotExists uses custom message',
    (_ctx: TestSuite) => {
      let msg = '';
      try {
        assertNotExists(42, 'custom notexists msg');
      } catch (e) {
        msg = e instanceof Error ? e.message : '';
      }
      assertEquals(msg, 'custom notexists msg');
    },
  );

  TEST(
    'Asserts',
    'assertEquals passes for equal primitives',
    (_ctx: TestSuite) => {
      assertEquals(1, 1);
      assertEquals('hello', 'hello');
      assertEquals(true, true);
    },
  );

  TEST(
    'Asserts',
    'assertEquals fails for unequal values',
    (_ctx: TestSuite) => {
      let threw = false;
      try {
        assertEquals(1, 2);
      } catch (_e) {
        threw = true;
      }
      assertTrue(threw, 'assertEquals must throw for unequal values');
    },
  );

  TEST(
    'Asserts',
    'assertLessThan passes when actual < expected',
    (_ctx: TestSuite) => {
      assertLessThan(1, 2);
    },
  );

  TEST(
    'Asserts',
    'assertLessThan throws when actual >= expected',
    (_ctx: TestSuite) => {
      assertThrows(() => assertLessThan(2, 2));
      assertThrows(() => assertLessThan(3, 2));
    },
  );

  TEST(
    'Asserts',
    'assertExists passes for non-null/non-undefined',
    (_ctx: TestSuite) => {
      assertExists(0);
      assertExists('');
      assertExists(false);
      assertExists({});
    },
  );

  TEST(
    'Asserts',
    'assertExists throws for null and undefined',
    (_ctx: TestSuite) => {
      assertThrows(() => assertExists(null));
      assertThrows(() => assertExists(undefined));
    },
  );

  TEST(
    'Asserts',
    'expectToContain passes when value is in array',
    (_ctx: TestSuite) => {
      expectToContain([1, 2, 3], 2);
      expectToContain(['a', 'b'], 'a');
    },
  );

  TEST(
    'Asserts',
    'expectToContain throws when value is absent',
    (_ctx: TestSuite) => {
      assertThrows(() => expectToContain([1, 2], 3));
    },
  );
}
