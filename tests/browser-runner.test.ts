import {
  browserConsoleLogEntry,
  browserConsoleSeverity,
  logBrowserConsole,
  logBrowserPageError,
} from '../base/browser-log.ts';
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { withLogCapture } from './test-utils.ts';

export default function setupBrowserRunnerTests(): void {
  TEST(
    'BrowserRunner',
    'browser console severities preserve useful signal',
    () => {
      assertEquals(browserConsoleSeverity('log'), 'INFO');
      assertEquals(browserConsoleSeverity('warning'), 'WARNING');
      assertEquals(browserConsoleSeverity('error'), 'ERROR');
      assertEquals(browserConsoleSeverity('assert'), 'ERROR');
      assertEquals(browserConsoleSeverity('trace'), 'DEBUG');
    },
  );

  TEST(
    'BrowserRunner',
    'browser console grouping noise is dropped before logging',
    () => {
      assertEquals(browserConsoleLogEntry('clear', 'ignored'), undefined);
      assertEquals(browserConsoleLogEntry('startGroup', 'ignored'), undefined);
      assertEquals(browserConsoleLogEntry('endGroup', 'ignored'), undefined);
    },
  );

  TEST(
    'BrowserRunner',
    'browser console errors become structured BrowserConsoleError logs',
    async () => {
      await withLogCapture(async (captured) => {
        logBrowserConsole('error', 'boom');
        assertEquals(captured.length, 1);
        assertEquals(captured[0].severity, 'ERROR');
        assertEquals(captured[0].error, 'BrowserConsoleError');
        assertTrue(
          (captured[0].message as string).includes('[browser:error] boom'),
          'browser console error logs must preserve the Playwright console type',
        );
      });
    },
  );

  TEST(
    'BrowserRunner',
    'page errors become UncaughtClientError logs with stack traces',
    async () => {
      await withLogCapture(async (captured) => {
        logBrowserPageError({
          message: 'client exploded',
          stack: 'Error: client exploded\n    at browser.js:1:1',
        });
        assertEquals(captured.length, 1);
        assertEquals(captured[0].severity, 'ERROR');
        assertEquals(captured[0].error, 'UncaughtClientError');
        assertEquals(captured[0].message, 'client exploded');
        assertTrue(
          (captured[0].trace as string).includes('browser.js:1:1'),
          'browser page errors must keep the stack for source-mapped diagnostics',
        );
      });
    },
  );
}
