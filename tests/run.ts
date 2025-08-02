import { compileForNodeWithEsbuild, nodeRun } from './node-run.ts';
import { sourceMapDecoder } from './browser/sourcemap-decoder.ts';
import { assert } from '../base/error.ts';

/**
 * Runs tests in Deno and/or Node.js environments based on command line arguments.
 *
 * Command line options:
 * --deno-inspect-brk: Enable Deno debugger
 * --node-inspect-brk: Enable Node.js debugger
 * --suite=<name> or -suite <name>: Run specific test suite
 * --test=<name> or -test <name>: Run specific test
 * --runtime=<deno|node|browser> or -runtime <deno|node|browser>: Run in specific runtime only
 *
 * @returns Promise that resolves when all tests complete
 */
async function runTests(): Promise<void> {
  // Parse CLI arguments for inspect flags and suite/test selection
  const denoInspectBrk = Deno.args.includes('--deno-inspect-brk');
  const nodeInspectBrk = Deno.args.includes('--node-inspect-brk');

  let suiteName: string | undefined = undefined;
  let testName: string | undefined = undefined;
  let runtime: string | undefined = undefined;

  // Parse command line arguments
  for (let i = 0; i < Deno.args.length; ++i) {
    const arg = Deno.args[i];
    if (
      arg === '--deno-inspect-brk' || arg === '--node-inspect-brk' ||
      arg === '--debug'
    ) continue;

    // Parse suite name argument
    if (arg.startsWith('--suite=')) {
      suiteName = arg.substring('--suite='.length);
      continue;
    }
    if (arg === '-suite' || arg === '--suite') {
      suiteName = Deno.args[i + 1];
      i++;
      continue;
    }

    // Parse test name argument
    if (arg.startsWith('--test=')) {
      testName = arg.substring('--test='.length);
      continue;
    }
    if (arg === '-test' || arg === '--test') {
      testName = Deno.args[i + 1];
      i++;
      continue;
    }

    // Parse runtime argument
    if (arg.startsWith('--runtime=')) {
      runtime = arg.substring('--runtime='.length);
      continue;
    }
    if (arg === '-runtime' || arg === '--runtime') {
      runtime = Deno.args[i + 1];
      i++;
      continue;
    }

    // Unknown argument - show usage and exit
    console.error(
      'Unknown argument:',
      arg,
      '\nUsage: deno task test [--deno-inspect-brk] [--node-inspect-brk] [-suite <suite>] [--suite=<suite>] [-test <test>] [--test=<test>] [-runtime <deno|node|browser>] [--debug]',
    );
    Deno.exit(1);
  }

  const start = performance.now();

  // Determine which runtimes to run based on arguments
  let runDeno: boolean;
  let runNode: boolean;
  let runBrowser: boolean;
  if (runtime) {
    if (runtime !== 'deno' && runtime !== 'node' && runtime !== 'browser') {
      console.error(
        'Invalid value for --runtime:',
        runtime,
        '\nAllowed values: deno, node, browser',
      );
      Deno.exit(1);
    }
    runDeno = runtime === 'deno';
    runNode = runtime === 'node';
    runBrowser = runtime === 'browser';
  } else {
    // Default to running all three runtimes (Deno, Node.js, Browser) unless specifically configured
    runDeno = (denoInspectBrk && !nodeInspectBrk) ||
      (!denoInspectBrk && !nodeInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
    runNode = (nodeInspectBrk && !denoInspectBrk) ||
      (!denoInspectBrk && !denoInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
    runBrowser = !denoInspectBrk && !nodeInspectBrk; // Run browser tests by default unless debugging
  }

  let denoElapsed = 0;
  let nodeElapsed = 0;
  let esbuildElapsed = 0;
  let browserElapsed = 0;

  // Run tests in Deno if configured
  if (runDeno) {
    console.log('=== 🦖 Running tests in Deno... ===');
    const denoStart = performance.now();

    // Configure Deno command
    const denoArgs = ['run', '-A'];
    if (denoInspectBrk) {
      denoArgs.push('--inspect-brk');
    }
    denoArgs.push('./tests/tests-entry-server.ts');

    // Set up environment variables
    const denoEnv: Record<string, string> = { ...Deno.env.toObject() };
    if (suiteName) {
      denoEnv['GOATDB_SUITE'] = suiteName;
    }
    if (testName) {
      denoEnv['GOATDB_TEST'] = testName;
    }

    // Execute Deno tests
    const denoCmd = new Deno.Command('deno', {
      args: denoArgs,
      stdout: 'inherit',
      stderr: 'inherit',
      env: denoEnv,
    });
    await denoCmd.output();

    const denoEnd = performance.now();
    denoElapsed = (denoEnd - denoStart) / 1000;
    console.log('=== 🦖 Tests in Deno completed ===\n');
  }

  // Run tests in Node.js if configured
  if (runNode) {
    console.log('=== ⚡️ Running tests in Node.js... ===');

    // Set up environment variables
    const nodeEnv: Record<string, string> = { ...Deno.env.toObject() };
    if (suiteName) {
      nodeEnv['GOATDB_SUITE'] = suiteName;
    }
    if (testName) {
      nodeEnv['GOATDB_TEST'] = testName;
    }

    // Compile with esbuild before timing
    const inputFile = './tests/tests-entry-server.ts';
    const outName = 'tests-entry-server';
    console.log('🛠️ Bundling with esbuild for Node.js...');
    const esbuildStart = performance.now();
    const esbuildResult = await compileForNodeWithEsbuild(inputFile, outName);
    const esbuildEnd = performance.now();
    esbuildElapsed = (esbuildEnd - esbuildStart) / 1000;
    console.log(
      `🛠️ esbuild bundling completed in ${esbuildElapsed.toFixed(2)}s`,
    );

    const nodeStart = performance.now();
    // Execute Node.js tests (timing only the Node.js phase)
    assert(
      await nodeRun(esbuildResult, nodeInspectBrk, nodeEnv),
      'Node.js tests failed',
    );
    const nodeEnd = performance.now();
    nodeElapsed = (nodeEnd - nodeStart) / 1000;
    console.log('=== ⚡️ Tests in Node.js completed ===');
  }

  // Run tests in Browser if configured
  if (runBrowser) {
    console.log('=== 🌐 Running tests in Browser... ===');

    try {
      // Dynamic import to keep Playwright optional
      const { runBrowserTests } = await import(
        './browser/playwright-runner.ts'
      );

      const browserStart = performance.now();
      const summary = await runBrowserTests({
        suite: suiteName,
        test: testName,
        debug: Deno.args.includes('--debug'),
      });

      const browserEnd = performance.now();
      browserElapsed = (browserEnd - browserStart) / 1000;

      if (summary.failed > 0) {
        console.error(
          `=== 🌐 Browser tests failed: ${summary.failed} failures ===`,
        );
        console.error();
        console.error('Failed tests:');
        const failures = summary.results.filter((r) => !r.passed);

        for (let i = 0; i < failures.length; i++) {
          const result = failures[i];
          console.error(
            `${i + 1}. ${result.suiteName}/${result.testName} (${
              Math.round(result.duration)
            }ms)`,
          );
          if (result.error) {
            console.error(`   ${result.error.name}: ${result.error.message}`);
            // Use pre-decoded stack trace if available, otherwise show original
            const stack = (result.error as any).decodedStack ||
              result.error.stack;
            if (stack) {
              const stackLines = stack.split('\n');
              for (const line of stackLines) {
                if (line.trim()) console.error(`   ${line.trim()}`);
              }
            }
          }
        }
        console.error();

        // Cleanup sourcemap decoder
        sourceMapDecoder.destroy();
      } else {
        console.log(
          `=== 🌐 Browser tests completed: ${summary.passed} passed ===`,
        );

        // Cleanup sourcemap decoder on success
        sourceMapDecoder.destroy();
      }
    } catch (error) {
      console.error('=== 🌐 Browser tests failed ===');

      // Cleanup sourcemap decoder on error
      sourceMapDecoder.destroy();
      console.error('Error:', (error as Error).message);
    }
  }

  // Print summary of test execution times
  const end = performance.now();
  const totalElapsed = (end - start) / 1000;
  let summary = '=== 🕒 Summary:';
  if (runDeno) {
    summary += ` Deno: ${denoElapsed.toFixed(2)}s`;
  }
  if (runNode) {
    summary += ` | esbuild: ${esbuildElapsed.toFixed(2)}s | Node.js: ${
      nodeElapsed.toFixed(2)
    }s`;
  }
  if (runBrowser) {
    summary += ` | Browser: ${browserElapsed.toFixed(2)}s`;
  }
  summary += ` | Total: ${totalElapsed.toFixed(2)}s ===`;
  console.log(summary);
}

if (import.meta.main) {
  runTests();
}
