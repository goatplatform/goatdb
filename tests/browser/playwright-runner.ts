import { kMinuteMs, kSecondMs } from '../../base/date.ts';
import type { TestSummary } from '../mod.ts';
import { sourceMapDecoder } from './sourcemap-decoder.ts';

export interface BrowserTestOptions {
  suite?: string;
  test?: string;
  debug?: boolean;
  port?: number;
}

/**
 * Runs browser tests using Playwright automation.
 *
 * This function:
 * 1. Starts an HTTPS debug server with the browser test bundle
 * 2. Launches a Chrome browser with required features enabled
 * 3. Navigates to the test runner page
 * 4. Waits for tests to complete
 * 5. Returns the test summary
 */
export async function runBrowserTests(
  options: BrowserTestOptions = {},
): Promise<TestSummary> {
  const port = options.port || 8080;
  console.log('Starting HTTP debug server for browser tests...');

  // Set environment variables for server configuration
  const env: Record<string, string> = {};
  if (options.suite) {
    env['GOATDB_SUITE'] = options.suite;
  }
  if (options.test) {
    env['GOATDB_TEST'] = options.test;
  }

  // Start debug server with HTTPS using the browser test entry point
  const serverArgs = [
    'run',
    '-A',
    './tests/browser/debug-server-entry.ts',
  ];

  console.log(`Running: deno ${serverArgs.join(' ')}`);

  // Start server process directly for proper cleanup
  const serverCmd = new Deno.Command('deno', {
    args: serverArgs,
    env,
    stdout: 'piped',
    stderr: 'piped',
  });

  const serverProcess = serverCmd.spawn();

  // Give server time to start and generate certificate
  console.log('Waiting for server to start...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    // Dynamic import Playwright (optional dependency)
    console.log('Launching browser...');
    const { chromium } = await import('playwright');

    // Detect if running in Docker/CI environment
    const isDocker = await Deno.stat('/.dockerenv').then(() => true).catch(() =>
      false
    );
    const isCI = Deno.env.get('CI') === 'true' ||
      Deno.env.get('GITHUB_ACTIONS') === 'true';

    // Minimal browser args - most certificate handling is done via ignoreHTTPSErrors
    const browserArgs = [
      // Essential for OPFS and other secure-context APIs on localhost
      '--unsafely-treat-insecure-origin-as-secure=https://localhost:8080',
      // Enable required features
      '--enable-features=FileSystemAccessAPI',
      // Test environment optimizations
      '--disable-extensions',
      '--no-first-run',
    ];

    // Add Docker/CI specific flags
    if (isDocker || isCI) {
      browserArgs.push(
        '--disable-dev-shm-usage', // Prevent /dev/shm issues in Docker
        '--no-sandbox', // Required when running as root in Docker
        '--disable-gpu', // No GPU in CI environments
      );
    }

    const browser = await chromium.launch({
      headless: !options.debug,
      timeout: 0, // Disable browser launch timeout
      args: browserArgs,
    });

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      acceptDownloads: false,
      viewport: options.debug ? { width: 1200, height: 800 } : null,
    });

    // Set context timeouts to avoid Playwright-level timeouts
    context.setDefaultTimeout(0); // Disable default timeouts
    context.setDefaultNavigationTimeout(30000); // Keep reasonable navigation timeout

    const page = await context.newPage();

    // Set up console logging for debugging
    page.on('console', (msg) => {
      console.log(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    // Listen for page errors
    page.on('pageerror', (err) => {
      console.error('[Browser Error]', err.message);
    });

    // Navigate to HTTPS test server (required for OPFS, Web Workers, Web Locks)
    const testUrl = `https://localhost:${port}`;
    console.log(`Navigating to ${testUrl}...`);
    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });

    // Wait for test bundle to load and tests to start
    console.log('[DEBUG] About to wait for GoatDBConfig...');
    try {
      await page.waitForFunction(() => {
        return typeof (window as any).GoatDBConfig !== 'undefined';
      }, { timeout: 10 * kSecondMs });
      console.log('[DEBUG] GoatDBConfig found!');
    } catch (e) {
      console.error(
        '[DEBUG] Failed to find GoatDBConfig:',
        (e as Error).message,
      );
      throw e;
    }

    await page.waitForFunction(
      () => (window as any).testResults?.completed === true,
      { timeout: 2 * kMinuteMs },
    );

    // Get the test results
    const summary = await page.evaluate(() =>
      (window as any).testResults
    ) as TestSummary;
    console.log(
      `Browser tests completed: ${summary.passed} passed, ${summary.failed} failed`,
    );

    try {
      // Fetch source map while server is still running
      if (summary.failed > 0) {
        console.log('Fetching source map for error decoding...');
        try {
          const sourceMapResponse = await page.evaluate(async () => {
            const response = await fetch('/app.js.map');
            if (!response.ok) {
              throw new Error(`Failed to fetch source map: ${response.status}`);
            }
            return await response.text();
          });

          const sourceMapData = JSON.parse(sourceMapResponse);

          // Decode error stack traces for failed tests
          for (const result of summary.results) {
            if (!result.passed && result.error?.stack) {
              const decoded = await sourceMapDecoder.decodeStackTrace(
                result.error.stack,
                testUrl,
                sourceMapData,
              );
              // Add decoded stack as a property on the error
              (result.error as any).decodedStack = decoded.decoded;
            }
          }
          console.log('Source map decoding completed');
        } catch (sourceMapError) {
          console.warn(
            'Failed to decode source maps:',
            (sourceMapError as Error).message,
          );
          // Continue without source maps - tests still ran
        }
      }

      console.log(
        `Browser tests completed: ${summary.passed} passed, ${summary.failed} failed (${summary.duration}ms)`,
      );
      console.log('About to take screenshot/close browser...');

      // Take screenshot in debug mode
      if (options.debug) {
        console.log('Taking screenshot...');
        await page.screenshot({
          path: 'browser-test-results.png',
          fullPage: true,
        });
        console.log('Screenshot saved to browser-test-results.png');
      }

      console.log('Closing browser...');
      // Force browser close with timeout since GoatDB timers may keep event loop busy
      await Promise.race([
        browser.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Browser close timed out')), 5000)
        ),
      ]).catch((error) => {
        console.warn('Browser close issue:', error.message);
        // Browser close timed out - this is expected with GoatDB active timers
      });
      console.log('Browser closed successfully');
      return summary;
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
      // Just return the summary - cleanup will happen at process level
      return summary;
    }
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') {
      console.error(
        'Browser tests timed out. Check the test runner page for details.',
      );
      throw new Error('Browser tests timed out after 2 minutes');
    } else if ((error as Error).message?.includes('Cannot resolve module')) {
      console.error('Playwright not installed. Run: npm install playwright');
      console.error('Or install browsers: npx playwright install chromium');
      throw new Error('Playwright dependency missing');
    }
    throw error;
  } finally {
    // Clean up server process
    console.log('Cleaning up server process...');
    try {
      console.log('Sending SIGTERM to server process...');
      serverProcess.kill('SIGTERM');

      // Wait for graceful shutdown with timeout
      const result = await Promise.race([
        serverProcess.status.then(() => 'exited'),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
      ]);

      if (result === 'timeout') {
        console.log(
          'Server process did not terminate gracefully, forcing SIGKILL...',
        );
        try {
          serverProcess.kill('SIGKILL');
          await serverProcess.status; // Wait for forced termination
        } catch (killError) {
          console.warn('Error with SIGKILL:', (killError as Error).message);
        }
      } else {
        console.log('Server process terminated gracefully');
      }
    } catch (error) {
      console.warn(
        'Error cleaning up server process:',
        (error as Error).message,
      );
    }
    console.log('Browser test execution completed');
  }
}

/**
 * Main entry point for running browser tests from command line
 */
export async function main(): Promise<void> {
  try {
    const summary = await runBrowserTests({
      debug: Deno.args.includes('--debug'),
      suite: Deno.args.find((arg) => arg.startsWith('--suite='))?.split('=')[1],
      test: Deno.args.find((arg) => arg.startsWith('--test='))?.split('=')[1],
    });

    if (summary.failed > 0) {
      console.error(`Browser tests failed: ${summary.failed} failures`);
      Deno.exit(1);
    }

    console.log(`All browser tests passed: ${summary.passed} tests`);
  } catch (error) {
    console.error('Browser test execution failed:', (error as Error).message);
    Deno.exit(1);
  }
}

// Auto-run when used as entry point
if (import.meta.main) {
  main();
}
