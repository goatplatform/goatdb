import { nodeRun } from './node-run.ts';

async function runTests(): Promise<void> {
  // Parse CLI arguments for inspect flags and suite/test selection
  const denoInspectBrk = Deno.args.includes('--deno-inspect-brk');
  const nodeInspectBrk = Deno.args.includes('--node-inspect-brk');

  let suiteName: string | undefined = undefined;
  let testName: string | undefined = undefined;
  let runtime: string | undefined = undefined;

  // Print usage if unknown flags are provided
  for (let i = 0; i < Deno.args.length; ++i) {
    const arg = Deno.args[i];
    if (arg === '--deno-inspect-brk' || arg === '--node-inspect-brk') continue;
    // Handle --suite=<value> or -suite <value>
    if (arg.startsWith('--suite=')) {
      suiteName = arg.substring('--suite='.length);
      continue;
    }
    if (arg === '-suite' || arg === '--suite') {
      suiteName = Deno.args[i + 1];
      i++;
      continue;
    }
    // Handle --test=<value> or -test <value>
    if (arg.startsWith('--test=')) {
      testName = arg.substring('--test='.length);
      continue;
    }
    if (arg === '-test' || arg === '--test') {
      testName = Deno.args[i + 1];
      i++;
      continue;
    }
    // Handle --runtime=<value> or -runtime <value>
    if (arg.startsWith('--runtime=')) {
      runtime = arg.substring('--runtime='.length);
      continue;
    }
    if (arg === '-runtime' || arg === '--runtime') {
      runtime = Deno.args[i + 1];
      i++;
      continue;
    }
    console.error(
      'Unknown argument:',
      arg,
      '\nUsage: deno task test [--deno-inspect-brk] [--node-inspect-brk] [-suite <suite>] [--suite=<suite>] [-test <test>] [--test=<test>] [-runtime <deno|node>]',
    );
    Deno.exit(1);
  }

  const start = performance.now();

  // Determine which runtimes to run
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
    runDeno = (denoInspectBrk && !nodeInspectBrk) ||
      (!denoInspectBrk && !nodeInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
    runNode = (nodeInspectBrk && !denoInspectBrk) ||
      (!denoInspectBrk && !denoInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
  }

  let denoElapsed = 0;
  let nodeElapsed = 0;

  if (runDeno) {
    console.log('=== 🦖 Running tests in Deno... ===');
    const denoStart = performance.now();
    const denoArgs = ['run', '-A'];
    if (denoInspectBrk) {
      denoArgs.push('--inspect-brk');
    }
    denoArgs.push('./tests/tests-entry.ts');
    const denoEnv: Record<string, string> = { ...Deno.env.toObject() };
    if (suiteName) {
      denoEnv['GOATDB_SUITE'] = suiteName;
    }
    if (testName) {
      denoEnv['GOATDB_TEST'] = testName;
    }
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

  if (runNode) {
    console.log('=== ⚡️ Running tests in Node.js... ===');
    const nodeStart = performance.now();
    // Pass suite and test as env vars to nodeRun
    const nodeEnv: Record<string, string> = { ...Deno.env.toObject() };
    if (suiteName) {
      nodeEnv['GOATDB_SUITE'] = suiteName;
    }
    if (testName) {
      nodeEnv['GOATDB_TEST'] = testName;
    }
    await nodeRun('./tests/tests-entry.ts', nodeInspectBrk, nodeEnv);
    const nodeEnd = performance.now();
    nodeElapsed = (nodeEnd - nodeStart) / 1000;
    console.log('=== ⚡️ Tests in Node.js completed ===');
  }

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
