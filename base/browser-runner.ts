import { kMinuteMs, kSecondMs } from './date.ts';
import { ProcessManager } from './process-manager.ts';

/**
 * Options for running browser-based tests or benchmarks.
 *
 * @property suite - (Optional) Name of the test suite to run.
 * @property test - (Optional) Name of a specific test to run.
 * @property benchmark - (Optional) Name of a specific benchmark to run.
 * @property debug - (Optional) If true, enables debug mode for verbose output.
 * @property headless - (Optional) If true, runs browser in headless mode.
 * @property port - (Optional) Port number for the debug server (default: 8080).
 * @property mode - (Optional) Run mode: 'test' for tests, 'benchmark' for benchmarks.
 */
export interface BrowserRunOptions {
  suite?: string;
  test?: string;
  benchmark?: string;
  debug?: boolean;
  headless?: boolean;
  port?: number;
  mode?: 'test' | 'benchmark';
}

/**
 * Runs browser tests/benchmarks using Playwright automation.
 *
 * This function:
 * 1. Starts an HTTPS debug server with the browser test bundle
 * 2. Launches a Chrome browser with required features enabled
 * 3. Navigates to the test runner page
 * 4. Waits for tests to complete
 * 5. Returns the test summary
 */
export async function runBrowserTests(
  options: BrowserRunOptions = {},
): Promise<any> {
  const port = options.port || 8080;
  const isBenchmarkMode = options.mode === 'benchmark';
  console.log(
    `Starting HTTP debug server for browser ${
      isBenchmarkMode ? 'benchmarks' : 'tests'
    }...`,
  );

  // Set environment variables for server configuration
  const env: Record<string, string> = {};
  if (options.suite) {
    env['GOATDB_SUITE'] = options.suite;
  }
  if (options.test) {
    env['GOATDB_TEST'] = options.test;
  }
  if (options.benchmark) {
    env['GOATDB_BENCHMARK'] = options.benchmark;
  }

  // Start debug server with HTTPS using the appropriate entry point
  const serverArgs = [
    'run',
    '-A',
    isBenchmarkMode
      ? './benchmarks/browser/debug-server-entry.ts'
      : './tests/browser/debug-server-entry.ts',
  ];

  console.log(`Running: deno ${serverArgs.join(' ')}`);

  // Start server process with ProcessManager
  const processManager = new ProcessManager();
  const serverProcess = processManager.spawn('deno', serverArgs, {
    env,
    stdout: 'piped',
    stderr: 'piped',
  });

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
      headless: options.headless ?? isCI ?? false, // Auto-enable in CI, default to showing UI locally
      timeout: 0, // Disable browser launch timeout
      args: browserArgs,
    });

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      acceptDownloads: false,
      viewport: (!options.headless || options.debug) ? { width: 1200, height: 800 } : null,
    });

    // Set context timeouts to avoid Playwright-level timeouts
    context.setDefaultTimeout(0); // Disable default timeouts
    context.setDefaultNavigationTimeout(30000); // Keep reasonable navigation timeout

    const page = await context.newPage();

    // Enable source map support for better error reporting
    const client = await page.context().newCDPSession(page);
    await client.send('Runtime.enable');
    await client.send('Debugger.enable');

    // Console logging removed for clean output

    // Listen for page errors (Playwright automatically provides source-mapped stacks)
    page.on('pageerror', (err) => {
      console.error('[Browser Error]', err.message);
      console.error(err.stack); // Already source-mapped by Playwright
    });

    // Forward browser console output to terminal
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      console.log(text);
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

    // Benchmarks take longer than tests
    const timeoutMs = isBenchmarkMode ? 10 * kMinuteMs : 2 * kMinuteMs;

    await page.waitForFunction(
      () => (window as any).testResults?.completed === true,
      { timeout: timeoutMs },
    );

    // Get the test/benchmark results
    const summary = await page.evaluate(() => (window as any).testResults);

    // Handle both test and benchmark result formats
    const passed = summary.passed ?? summary.summary?.passed ?? 0;
    const failed = summary.failed ?? summary.summary?.failed ?? 0;


    try {
      // Log failed test details (source maps handled automatically by Playwright)
      if (failed > 0 && summary.results) {
        console.error('\nFailed tests:');
        const failures = summary.results.filter((r: any) => !r.passed);
        
        for (let i = 0; i < failures.length; i++) {
          const result = failures[i];
          console.error(
            `${i + 1}. ${result.suiteName}/${result.testName} (${
              Math.round(result.duration)
            }ms)`,
          );
          if (result.error) {
            console.error(`   ${result.error.name}: ${result.error.message}`);
            // Playwright provides source-mapped stack traces automatically
            if (result.error.stack) {
              const stackLines = result.error.stack.split('\n');
              for (const line of stackLines) {
                if (line.trim()) console.error(`   ${line.trim()}`);
              }
            }
          }
        }
      }

      const duration = summary.duration ?? summary.metadata?.duration ?? 0;

      // Take screenshot in debug mode
      if (options.debug) {
        console.log('Taking screenshot...');
        await page.screenshot({
          path: 'browser-test-results.png',
          fullPage: true,
        });
        console.log('Screenshot saved to browser-test-results.png');
      }

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
    // Clean up all processes with ProcessManager
    await processManager.cleanup();
  }
}
