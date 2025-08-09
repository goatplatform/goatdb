import * as path from '@std/path';
import { startDebugServer } from '../../server/debug-server.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import { FileImplGet } from '../../base/json-log/file-impl.ts';
import { exit } from '../../base/process.ts';
import { getEnvVar } from '../../base/os.ts';

/**
 * Entry point for browser benchmark debug server.
 * This starts an HTTPS debug server specifically for browser benchmarking.
 */
async function browserBenchmarksServerMain() {
  try {
    console.log('Starting HTTPS debug server for browser benchmarks...');
    await startDebugServer<Schema>({
      path: path.join(
        await (await FileImplGet()).getTempDir(),
        'browser-benchmark-data',
      ),
      buildDir: './build',
      jsPath: './benchmarks/benchmarks-entry-browser.ts',
      htmlPath: './benchmarks/browser/benchmark-runner.html',
      assetsPath: './benchmarks/browser/assets',
      port: 8080,
      orgId: 'browser-benchmark-org',
      https: { selfSigned: true },
      watchDir: '.',
      customConfig: {
        benchmarkMode: true,
        benchmark: getEnvVar('GOATDB_BENCHMARK'),
      },
    });
  } catch (error) {
    console.error('Failed to start debug server:', error);
    exit(1);
  }
}

if (import.meta.main) {
  browserBenchmarksServerMain();
}