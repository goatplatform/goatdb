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
  browserOpenCommand,
  isBrowserOpenUrl,
  withTestBrowserOpenCommand,
} from '../base/runtime/browser-open.ts';
import type { LogEntry } from '../logging/log.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';
import { withLogCapture } from './test-utils.ts';

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

  TEST(
    'Runtime',
    'browserOpenCommand uses a direct Windows launcher',
    () => {
      assertEquals(browserOpenCommand('windows', 'http://localhost:1234'), {
        cmd: 'rundll32',
        args: ['url.dll,FileProtocolHandler', 'http://localhost:1234'],
      });
    },
  );

  TEST(
    'Runtime',
    'browserOpenCommand preserves Windows URL content as one raw arg',
    () => {
      assertEquals(
        browserOpenCommand('windows', 'https://example.com/a b?x=1&y=2|z'),
        {
          cmd: 'rundll32',
          args: [
            'url.dll,FileProtocolHandler',
            'https://example.com/a b?x=1&y=2|z',
          ],
        },
      );
    },
  );

  TEST('Runtime', 'browserOpenCommand preserves Windows URL quotes', () => {
    assertEquals(browserOpenCommand('windows', 'https://example.com/a"&calc'), {
      cmd: 'rundll32',
      args: ['url.dll,FileProtocolHandler', 'https://example.com/a"&calc'],
    });
  });

  TEST('Runtime', 'browserOpenCommand rejects unsafe or malformed URLs', () => {
    assertEquals(
      isBrowserOpenUrl('javascript:alert(1)'),
      false,
      'javascript: URLs must be rejected',
    );
    assertEquals(
      browserOpenCommand('darwin', 'javascript:alert(1)'),
      undefined,
      'javascript: URLs must be rejected',
    );
    assertEquals(
      isBrowserOpenUrl('file:///etc/passwd'),
      false,
      'file: URLs must be rejected',
    );
    assertEquals(
      browserOpenCommand('linux', 'file:///etc/passwd'),
      undefined,
      'file: URLs must be rejected',
    );
    assertEquals(
      isBrowserOpenUrl('data:text/html,<script>'),
      false,
      'data: URLs must be rejected',
    );
    assertEquals(
      browserOpenCommand('windows', 'data:text/html,<script>'),
      undefined,
      'data: URLs must be rejected',
    );
    assertEquals(isBrowserOpenUrl(''), false, 'empty URL must be rejected');
    assertEquals(
      browserOpenCommand('darwin', ''),
      undefined,
      'empty URL must be rejected',
    );
    assertEquals(
      isBrowserOpenUrl('https://'),
      false,
      'URLs without a host must be rejected',
    );
    assertEquals(
      browserOpenCommand('linux', 'https://'),
      undefined,
      'URLs without a host must be rejected',
    );
    assertEquals(
      isBrowserOpenUrl(' https://example.com'),
      false,
      'leading whitespace must be rejected instead of trimmed',
    );
    assertEquals(
      browserOpenCommand('windows', ' https://example.com'),
      undefined,
      'leading whitespace must be rejected instead of trimmed',
    );
    assertEquals(
      isBrowserOpenUrl('https://exa\nmple.com'),
      false,
      'control characters must be rejected',
    );
    assertEquals(
      browserOpenCommand('darwin', 'https://exa\nmple.com'),
      undefined,
      'control characters must be rejected',
    );
  });

  TEST(
    'Runtime',
    'browser adapter logs unsupported browser opening',
    async () => {
      let captured: NormalizedLogEntry<LogEntry>[] = [];
      await withLogCapture(async (c) => {
        captured = c;
        await BrowserAdapter.openBrowser('http://localhost:1234');
      });
      const warnings = captured.filter((e) =>
        e.severity === 'WARNING' &&
        e.error === 'MissingConfiguration' &&
        e.message?.includes('openBrowser() is not supported in browser')
      );
      assertEquals(
        warnings.length,
        1,
        'Browser adapter should report unsupported browser opening',
      );
    },
  );

  // setupSignalHandler tests

  TEST(
    'Runtime',
    'browser adapter setupSignalHandler returns no-op cleanup',
    () => {
      const cleanup = BrowserAdapter.setupSignalHandler('SIGTERM', () => {});
      assertTrue(typeof cleanup === 'function', 'cleanup should be a function');
      // Calling the no-op cleanup should never throw.
      cleanup();
      cleanup(); // idempotent
    },
  );

  // The async handler rejection logging path (used by Deno/Node adapters)
  // is exercised indirectly through the debug-server lifecycle tests in
  // cli-compile.test.ts. Direct testing would require sending real OS signals
  // or accessing internal closure state, which is invasive.
}

/**
 * Runtime tests that only apply to the Deno runtime.
 * Gated at the registry/entry-point level.
 */
export function setupRuntimeDenoTests(): void {
  TEST(
    'Runtime',
    'deno adapter setupSignalHandler returns callable cleanup',
    () => {
      const cleanup = DenoAdapter.setupSignalHandler('SIGINT', () => {});
      assertTrue(typeof cleanup === 'function', 'cleanup should be a function');
      // Register and immediately unregister — no signal is sent.
      cleanup();
      cleanup(); // idempotent (second call must not throw)
    },
  );

  TEST(
    'Runtime',
    'deno adapter logs unsupported browser opening',
    async () => {
      await withTestBrowserOpenCommand(
        () => undefined,
        async () => {
          let captured: NormalizedLogEntry<LogEntry>[] = [];
          await withLogCapture(async (c) => {
            captured = c;
            await DenoAdapter.openBrowser('http://localhost:1234');
          });
          const warnings = captured.filter((e) =>
            e.severity === 'WARNING' &&
            e.error === 'MissingConfiguration' &&
            e.message?.includes('Unable to open browser on unsupported OS')
          );
          assertEquals(
            warnings.length,
            1,
            'Deno adapter should report unsupported browser opening',
          );
        },
      );
    },
  );

  TEST(
    'Runtime',
    'deno adapter logs invalid browser URLs as sanitized bad requests',
    async () => {
      const invalidUrl = 'javascript:alert(1)\nhttps://secret.example';
      let captured: NormalizedLogEntry<LogEntry>[] = [];
      await withLogCapture(async (c) => {
        captured = c;
        await DenoAdapter.openBrowser(invalidUrl);
      });
      const warnings = captured.filter((e) =>
        e.severity === 'WARNING' &&
        e.error === 'BadRequest' &&
        e.message?.includes('Refusing to open invalid browser URL')
      );
      assertEquals(
        warnings.length,
        1,
        'Deno adapter should reject invalid browser URLs explicitly',
      );
      assertTrue(
        !warnings[0].message?.includes(invalidUrl),
        'Deno adapter must not echo raw invalid URLs into logs',
      );
    },
  );
}

/**
 * Runtime tests that only apply to the Node.js runtime.
 * Gated at the registry/entry-point level.
 */
export function setupRuntimeNodeTests(): void {
  TEST(
    'Runtime',
    'node adapter setupSignalHandler returns callable cleanup',
    () => {
      const cleanup = NodeAdapter.setupSignalHandler('SIGINT', () => {});
      assertTrue(typeof cleanup === 'function', 'cleanup should be a function');
      cleanup();
      cleanup(); // idempotent
    },
  );

  TEST(
    'Runtime',
    'node adapter logs unsupported browser opening',
    async () => {
      await withTestBrowserOpenCommand(
        () => undefined,
        async () => {
          let captured: NormalizedLogEntry<LogEntry>[] = [];
          await withLogCapture(async (c) => {
            captured = c;
            await NodeAdapter.openBrowser('http://localhost:1234');
          });
          const warnings = captured.filter((e) =>
            e.severity === 'WARNING' &&
            e.error === 'MissingConfiguration' &&
            e.message?.includes('Unable to open browser on unsupported OS')
          );
          assertEquals(
            warnings.length,
            1,
            'Node adapter should report unsupported browser opening',
          );
        },
      );
    },
  );

  TEST(
    'Runtime',
    'node adapter logs invalid browser URLs as sanitized bad requests',
    async () => {
      const invalidUrl = 'javascript:alert(1)\nhttps://secret.example';
      let captured: NormalizedLogEntry<LogEntry>[] = [];
      await withLogCapture(async (c) => {
        captured = c;
        await NodeAdapter.openBrowser(invalidUrl);
      });
      const warnings = captured.filter((e) =>
        e.severity === 'WARNING' &&
        e.error === 'BadRequest' &&
        e.message?.includes('Refusing to open invalid browser URL')
      );
      assertEquals(
        warnings.length,
        1,
        'Node adapter should reject invalid browser URLs explicitly',
      );
      assertTrue(
        !warnings[0].message?.includes(invalidUrl),
        'Node adapter must not echo raw invalid URLs into logs',
      );
    },
  );
}
