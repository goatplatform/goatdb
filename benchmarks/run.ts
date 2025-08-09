import { runAcrossPlatforms } from '../base/multi-runner.ts';

/**
 * Runs benchmarks in Deno and/or Node.js environments based on command line arguments.
 *
 * Command line options:
 * --deno-inspect-brk: Enable Deno debugger
 * --node-inspect-brk: Enable Node.js debugger
 * --benchmark=<name> or -benchmark <name>: Run specific benchmark
 * --runtime=<deno|node|browser> or -runtime <deno|node|browser>: Run in specific runtime only
 *
 * @returns Promise that resolves when all benchmarks complete
 */
async function runBenchmarks(): Promise<void> {
  // Parse CLI arguments for inspect flags and benchmark selection
  const denoInspectBrk = Deno.args.includes('--deno-inspect-brk');
  const nodeInspectBrk = Deno.args.includes('--node-inspect-brk');
  const headless = Deno.args.includes('--headless');

  let benchmarkName: string | undefined = undefined;
  let runtime: string | undefined = undefined;

  // Parse command line arguments
  for (let i = 0; i < Deno.args.length; ++i) {
    const arg = Deno.args[i];
    if (
      arg === '--deno-inspect-brk' || arg === '--node-inspect-brk' ||
      arg === '--debug' || arg === '--headless'
    ) continue;

    // Parse benchmark name argument
    if (arg.startsWith('--benchmark=')) {
      benchmarkName = arg.substring('--benchmark='.length);
      continue;
    }
    if (arg === '-benchmark' || arg === '--benchmark') {
      benchmarkName = Deno.args[i + 1];
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
      '\nUsage: deno task bench [--headless] [--deno-inspect-brk] [--node-inspect-brk] [-benchmark <benchmark>] [--benchmark=<benchmark>] [-runtime <deno|node|browser|all>] [--debug]',
    );
    Deno.exit(1);
  }

  // Determine which runtimes to run based on arguments
  let runtimes: Array<'deno' | 'node' | 'browser'>;
  if (runtime) {
    if (runtime === 'all') {
      // Special case: run all runtimes when explicitly requested
      runtimes = ['deno', 'node', 'browser'];
    } else if (runtime !== 'deno' && runtime !== 'node' && runtime !== 'browser') {
      console.error(
        'Invalid value for --runtime:',
        runtime,
        '\nAllowed values: deno, node, browser, all',
      );
      Deno.exit(1);
    } else {
      runtimes = [runtime as 'deno' | 'node' | 'browser'];
    }
  } else {
    // Default to running all three runtimes (Deno, Node.js, Browser) unless specifically configured
    const runDeno = (denoInspectBrk && !nodeInspectBrk) ||
      (!denoInspectBrk && !nodeInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
    const runNode = (nodeInspectBrk && !denoInspectBrk) ||
      (!denoInspectBrk && !nodeInspectBrk) ||
      (denoInspectBrk && nodeInspectBrk);
    const runBrowser = !denoInspectBrk && !nodeInspectBrk; // Run browser benchmarks by default unless debugging

    runtimes = [];
    if (runDeno) runtimes.push('deno');
    if (runNode) runtimes.push('node');
    if (runBrowser) runtimes.push('browser');
  }

  try {
    await runAcrossPlatforms({
      entryPointServer: './benchmarks/benchmarks-entry-server.ts',
      entryPointBrowser: './benchmarks/benchmarks-entry-browser.ts',
      benchmark: benchmarkName,
      runtimes,
      debug: Deno.args.includes('--debug'),
      headless,
      denoInspectBrk,
      nodeInspectBrk,
      mode: 'benchmark',
    });
  } catch (error) {
    console.error('Benchmark execution failed:', (error as Error).message);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  runBenchmarks();
}