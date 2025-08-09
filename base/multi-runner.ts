import { compileForNodeWithEsbuild, nodeRun } from './node-runner.ts';
import { runBrowserTests } from './browser-runner.ts';

/**
 * Configuration options for running code across multiple JavaScript runtimes.
 *
 * @property entryPointServer - Path to the entry point file for server-side
 *                             (Deno/Node) execution.
 * @property entryPointBrowser - Path to the entry point file for browser
 *                              execution.
 * @property suite - (Optional) Name of the test suite to run.
 * @property test - (Optional) Name of a specific test to run.
 * @property benchmark - (Optional) Name of a specific benchmark to run.
 * @property runtimes - Array of runtimes to execute in. Valid values: 'deno',
 *                      'node', 'browser'.
 * @property debug - (Optional) If true, enables debug mode for verbose output.
 * @property headless - (Optional) If true, runs browser in headless mode.
 * @property denoInspectBrk - (Optional) If true, runs Deno with the
 *                           --inspect-brk flag for debugging.
 * @property nodeInspectBrk - (Optional) If true, runs Node.js with the
 *                           --inspect-brk flag for debugging.
 * @property mode - (Optional) Run mode: 'test' for tests, 'benchmark' for
 *                  benchmarks.
 */
export interface RunConfig {
  entryPointServer: string;
  entryPointBrowser: string;
  suite?: string;
  test?: string;
  benchmark?: string;
  runtimes: Array<'deno' | 'node' | 'browser'>;
  debug?: boolean;
  headless?: boolean;
  denoInspectBrk?: boolean;
  nodeInspectBrk?: boolean;
  mode?: 'test' | 'benchmark';
}

/**
 * Represents the timing results for running code across multiple runtimes.
 *
 * @property denoElapsed - Time elapsed (in milliseconds) for the Deno run.
 * @property nodeElapsed - Time elapsed (in milliseconds) for the Node.js run.
 * @property esbuildElapsed - Time elapsed (in milliseconds) for the esbuild
 *                            compilation step.
 * @property browserElapsed - Time elapsed (in milliseconds) for the browser run.
 * @property totalElapsed - Total time elapsed (in milliseconds) for all
 *                          configured runs.
 */
export interface RunResult {
  denoElapsed: number;
  nodeElapsed: number;
  esbuildElapsed: number;
  browserElapsed: number;
  totalElapsed: number;
}

/**
 * Runs TypeScript code across multiple JavaScript runtimes (Deno, Node.js,
 * Browser).
 * This is the generic orchestrator extracted from tests/run.ts.
 */
export async function runAcrossPlatforms(
  config: RunConfig,
): Promise<RunResult> {
  const start = performance.now();
  let denoElapsed = 0;
  let nodeElapsed = 0;
  let esbuildElapsed = 0;
  let browserElapsed = 0;

  const runDeno = config.runtimes.includes('deno');
  const runNode = config.runtimes.includes('node');
  const runBrowser = config.runtimes.includes('browser');

  // Run in Deno if configured
  if (runDeno) {
    console.log('=== 🦖 Running in Deno... ===');
    const denoStart = performance.now();

    // Configure Deno command
    const denoArgs = ['run', '-A'];
    if (config.denoInspectBrk) {
      denoArgs.push('--inspect-brk');
    }
    denoArgs.push(config.entryPointServer);

    // Set up environment variables
    const denoEnv: Record<string, string> = { ...Deno.env.toObject() };
    if (config.suite) {
      denoEnv['GOATDB_SUITE'] = config.suite;
    }
    if (config.test) {
      denoEnv['GOATDB_TEST'] = config.test;
    }
    if (config.benchmark) {
      denoEnv['GOATDB_BENCHMARK'] = config.benchmark;
    }

    // Execute Deno
    const denoCmd = new Deno.Command('deno', {
      args: denoArgs,
      stdout: 'inherit',
      stderr: 'inherit',
      env: denoEnv,
    });
    await denoCmd.output();

    const denoEnd = performance.now();
    denoElapsed = (denoEnd - denoStart) / 1000;
  }

  // Run in Node.js if configured
  if (runNode) {
    console.log('=== ⚡️ Running in Node.js... ===');

    // Set up environment variables
    const nodeEnv: Record<string, string> = { ...Deno.env.toObject() };
    if (config.suite) {
      nodeEnv['GOATDB_SUITE'] = config.suite;
    }
    if (config.test) {
      nodeEnv['GOATDB_TEST'] = config.test;
    }
    if (config.benchmark) {
      nodeEnv['GOATDB_BENCHMARK'] = config.benchmark;
    }

    // Compile with esbuild before timing
    const outName = 'cross-platform-entry';
    console.log('🛠️ Bundling with esbuild for Node.js...');
    const esbuildStart = performance.now();
    const esbuildResult = await compileForNodeWithEsbuild(
      config.entryPointServer,
      outName,
    );
    const esbuildEnd = performance.now();
    esbuildElapsed = (esbuildEnd - esbuildStart) / 1000;
    console.log(
      `🛠️ esbuild bundling completed in ${esbuildElapsed.toFixed(2)}s`,
    );

    const nodeStart = performance.now();
    // Execute Node.js (timing only the Node.js phase)
    const success = await nodeRun(
      esbuildResult,
      config.nodeInspectBrk,
      nodeEnv,
    );
    if (!success) {
      throw new Error('Node.js execution failed');
    }
    const nodeEnd = performance.now();
    nodeElapsed = (nodeEnd - nodeStart) / 1000;
  }

  // Run in Browser if configured
  if (runBrowser) {
    console.log('=== 🌐 Running in Browser... ===');

    try {
      const browserStart = performance.now();
      const summary = await runBrowserTests({
        suite: config.suite,
        test: config.test,
        benchmark: config.benchmark,
        debug: config.debug,
        headless: config.headless,
        mode: config.mode || 'test',
      });

      const browserEnd = performance.now();
      browserElapsed = (browserEnd - browserStart) / 1000;

      // Handle both test and benchmark result formats
      const failed = summary.failed ?? summary.summary?.failed ?? 0;
      const passed = summary.passed ?? summary.summary?.passed ?? 0;

      if (failed > 0) {
        console.error(
          `=== 🌐 Browser execution failed: ${failed} failures ===`,
        );
        console.error();
        console.error('Failed tests:');
        const failures = summary.results
          ? summary.results.filter((r: any) => !r.passed)
          : [];

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
      } else {
        console.log(
          `=== 🌐 Browser execution completed: ${passed} passed ===`,
        );
      }
    } catch (error) {
      console.error('=== 🌐 Browser execution failed ===');
      console.error('Error:', (error as Error).message);
      throw error;
    }
  }

  // Print summary of execution times
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

  return {
    denoElapsed,
    nodeElapsed,
    esbuildElapsed,
    browserElapsed,
    totalElapsed,
  };
}
