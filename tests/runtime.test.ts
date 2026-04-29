import { TEST } from './mod.ts';
import { assertEquals, assertThrows, assertTrue } from './asserts.ts';
import { BrowserAdapter } from '../base/runtime/adapters/browser.ts';
import { DenoAdapter } from '../base/runtime/adapters/deno.ts';
import { NodeAdapter } from '../base/runtime/adapters/node.ts';
import {
  clearRuntimeCache,
  getRegisteredAdapters,
  getRuntime,
} from '../base/runtime/index.ts';
import {
  getGlobalLoggerStreams,
  type LogEntry,
  type LogStream,
  setGlobalLoggerStreams,
} from '../logging/log.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';

declare const __BUNDLE_TARGET__: string | undefined;

export default function setupRuntimeTests(): void {
  // I-001: Runtime Detection Caching
  TEST('Runtime', 'getRuntime returns cached instance (I-001)', () => {
    clearRuntimeCache();
    const first = getRuntime();
    const second = getRuntime();
    const third = getRuntime();
    assertTrue(
      first === second,
      'Second call should return same object reference',
    );
    assertTrue(
      second === third,
      'Third call should return same object reference',
    );
  });

  // I-002: TestConfig Always Present
  TEST('Runtime', 'testConfig is always present (I-002)', () => {
    const adapter = getRuntime();
    assertTrue(
      adapter.testConfig !== undefined,
      'testConfig should be defined',
    );
    assertTrue(
      typeof adapter.testConfig.cleanupDelayMs === 'number',
      'cleanupDelayMs should be a number',
    );
    assertTrue(
      adapter.testConfig.cleanupDelayMs >= 0,
      'cleanupDelayMs should be >= 0',
    );
    assertTrue(
      typeof adapter.testConfig.supportsHttpServer === 'boolean',
      'supportsHttpServer should be a boolean',
    );
    assertTrue(
      typeof adapter.testConfig.dbDefaults === 'object' &&
        adapter.testConfig.dbDefaults !== null,
      'dbDefaults should be an object',
    );
  });

  // C-001: Registration Order
  TEST('Runtime', 'adapters registered in correct order (C-001)', () => {
    const adapters = getRegisteredAdapters();
    // When bundled, __BUNDLE_TARGET__ is defined and only one adapter registers.
    // When unbundled (Deno, Node dev), all three register.
    if (typeof __BUNDLE_TARGET__ === 'undefined') {
      assertTrue(adapters.length >= 3, 'Should have at least 3 adapters');
      assertEquals(adapters[0].id, 'deno', 'First adapter should be Deno');
      assertEquals(
        adapters[1].id,
        'browser',
        'Second adapter should be Browser',
      );
      assertEquals(adapters[2].id, 'node', 'Third adapter should be Node');
    } else {
      assertTrue(
        adapters.length >= 1,
        'Should have at least 1 adapter when bundled',
      );
      assertEquals(
        adapters[0].id,
        __BUNDLE_TARGET__,
        `Bundled adapter should match target "${__BUNDLE_TARGET__}"`,
      );
    }
  });

  // I-003: testConfig is frozen
  TEST('Runtime', 'testConfig is frozen (I-003)', () => {
    const adapter = getRuntime();
    assertTrue(
      Object.isFrozen(adapter.testConfig),
      'testConfig should be frozen',
    );
  });

  TEST('Runtime', 'browser adapter exit is unsupported', () => {
    assertThrows(
      () => BrowserAdapter.exit(0),
      Error,
      'exit() is not available in browser',
    );
  });

  TEST('Runtime', 'browser adapter openBrowser is a no-op', async () => {
    await BrowserAdapter.openBrowser('http://localhost:1234');
  });

  if (getRuntime().id !== 'browser') {
    TEST(
      'Runtime',
      'process adapters log unsupported browser opening',
      async () => {
        const captured: NormalizedLogEntry<LogEntry>[] = [];
        const stream: LogStream = {
          appendEntry(e) {
            captured.push(e);
          },
        };
        const previousStreams = getGlobalLoggerStreams();
        const originalDenoGetOS = DenoAdapter.getOS;
        const originalNodeGetOS = NodeAdapter.getOS;
        try {
          setGlobalLoggerStreams([stream]);
          DenoAdapter.getOS = () => 'unknown';
          NodeAdapter.getOS = () => 'unknown';

          await DenoAdapter.openBrowser('http://localhost:1234');
          await NodeAdapter.openBrowser('http://localhost:1234');
        } finally {
          DenoAdapter.getOS = originalDenoGetOS;
          NodeAdapter.getOS = originalNodeGetOS;
          setGlobalLoggerStreams(previousStreams);
        }

        const warnings = captured.filter((e) =>
          e.severity === 'WARNING' &&
          e.error === 'MissingConfiguration' &&
          e.message?.includes('Unable to open browser on unsupported OS')
        );
        assertEquals(
          warnings.length,
          2,
          'Deno and Node adapters should report unsupported browser opening',
        );
      },
    );
  }
}
