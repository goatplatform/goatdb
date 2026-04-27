import { runAcrossPlatforms } from '../base/multi-runner.ts';
import { EXIT_CODE_NO_MATCH, NoMatchError } from './mod.ts';
import { sourceMapDecoder } from './browser/sourcemap-decoder.ts';

/**
 * Runs tests in Deno and/or Node.js environments based on command line arguments.
 *
 * Command line options:
 * --deno-inspect-brk: Enable Deno debugger
 * --node-inspect-brk: Enable Node.js debugger
 * --suite=<name> or -suite <name>: Run a suite by exact suite name
 * --test=<name> or -test <name>: Run tests by exact registered test name
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
      '\nUsage: deno task test [--deno-inspect-brk] [--node-inspect-brk] [-suite <exact-suite-name>] [--suite=<exact-suite-name>] [-test <exact-test-name>] [--test=<exact-test-name>] [-runtime <deno|node|browser>] [--debug]',
    );
    Deno.exit(1);
  }

  // Determine which runtimes to run based on arguments
  let runtimes: Array<'deno' | 'node' | 'browser'>;
  if (runtime) {
    if (runtime !== 'deno' && runtime !== 'node' && runtime !== 'browser') {
      console.error(
        'Invalid value for --runtime:',
        runtime,
        '\nAllowed values: deno, node, browser',
      );
      Deno.exit(1);
    }
    runtimes = [runtime as 'deno' | 'node' | 'browser'];
  } else {
    // Default to running all three runtimes (Deno, Node.js, Browser) unless specifically configured
    const runDeno = (denoInspectBrk && !nodeInspectBrk) ||
      (!denoInspectBrk && !nodeInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
    const runNode = (nodeInspectBrk && !denoInspectBrk) ||
      (!denoInspectBrk && !nodeInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
    const runBrowser = !denoInspectBrk && !nodeInspectBrk;

    runtimes = [];
    if (runDeno) {
      runtimes.push('deno');
    }
    if (runNode) {
      runtimes.push('node');
    }
    if (runBrowser) {
      runtimes.push('browser');
    }
  }

  try {
    await runAcrossPlatforms({
      entryPointServer: './tests/tests-entry-server.ts',
      entryPointBrowser: './tests/tests-entry-browser.ts',
      suite: suiteName,
      test: testName,
      runtimes,
      debug: Deno.args.includes('--debug'),
      denoInspectBrk,
      nodeInspectBrk,
      mode: 'test',
    });

    // Cleanup sourcemap decoder
    sourceMapDecoder.destroy();
  } catch (error) {
    // Cleanup sourcemap decoder on error
    sourceMapDecoder.destroy();
    console.error('Test execution failed:', (error as Error).message);
    Deno.exit(error instanceof NoMatchError ? EXIT_CODE_NO_MATCH : 1);
  }
}

if (import.meta.main) {
  runTests();
}
