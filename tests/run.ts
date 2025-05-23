import { nodeRun } from './node-run.ts';

/**
 * Runs tests in Deno and/or Node.js environments based on command line arguments.
 *
 * Command line options:
 * --deno-inspect-brk: Enable Deno debugger
 * --node-inspect-brk: Enable Node.js debugger
 * --suite=<name> or -suite <name>: Run specific test suite
 * --test=<name> or -test <name>: Run specific test
 * --runtime=<deno|node> or -runtime <deno|node>: Run in specific runtime only
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
    if (arg === '--deno-inspect-brk' || arg === '--node-inspect-brk') continue;

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
      '\nUsage: deno task test [--deno-inspect-brk] [--node-inspect-brk] [-suite <suite>] [--suite=<suite>] [-test <test>] [--test=<test>] [-runtime <deno|node>]',
    );
    Deno.exit(1);
  }

  const start = performance.now();

  // Determine which runtimes to run based on arguments
  let runDeno: boolean;
  let runNode: boolean;
  if (runtime) {
    if (runtime !== 'deno' && runtime !== 'node') {
      console.error(
        'Invalid value for --runtime:',
        runtime,
        '\nAllowed values: deno, node',
      );
      Deno.exit(1);
    }
    runDeno = runtime === 'deno';
    runNode = runtime === 'node';
  } else {
    // Default to running both runtimes unless specifically configured
    runDeno = (denoInspectBrk && !nodeInspectBrk) ||
      (!denoInspectBrk && !nodeInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
    runNode = (nodeInspectBrk && !denoInspectBrk) ||
      (!denoInspectBrk && !denoInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
  }

  let denoElapsed = 0;
  let nodeElapsed = 0;

  // Run tests in Deno if configured
  if (runDeno) {
    console.log('=== 🦖 Running tests in Deno... ===');
    const denoStart = performance.now();

    // Configure Deno command
    const denoArgs = ['run', '-A'];
    if (denoInspectBrk) {
      denoArgs.push('--inspect-brk');
    }
    denoArgs.push('./tests/tests-entry.ts');

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
    const nodeStart = performance.now();

    // Set up environment variables
    const nodeEnv: Record<string, string> = { ...Deno.env.toObject() };
    if (suiteName) {
      nodeEnv['GOATDB_SUITE'] = suiteName;
    }
    if (testName) {
      nodeEnv['GOATDB_TEST'] = testName;
    }

    // Execute Node.js tests
    await nodeRun('./tests/tests-entry.ts', nodeInspectBrk, nodeEnv);

    const nodeEnd = performance.now();
    nodeElapsed = (nodeEnd - nodeStart) / 1000;
    console.log('=== ⚡️ Tests in Node.js completed ===');
  }

  // Print summary of test execution times
  const end = performance.now();
  const totalElapsed = (end - start) / 1000;
  let summary = '=== 🕒 Summary:';
  if (runDeno) {
    summary += ` Deno: ${denoElapsed.toFixed(2)}s`;
  }
  if (runNode) {
    summary += ` | Node.js: ${nodeElapsed.toFixed(2)}s`;
  }
  summary += ` | Total: ${totalElapsed.toFixed(2)}s ===`;
  console.log(summary);
}

if (import.meta.main) {
  runTests();
}
