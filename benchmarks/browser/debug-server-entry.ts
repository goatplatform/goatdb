import { buildAssets } from '../../cli/build-assets.ts';
import { APP_ENTRY_POINT } from '../../net/server/static-assets.ts';
import { FileImplGet } from '../../base/json-log/file-impl.ts';
import * as path from '../../base/path.ts';
import { getEnvVar } from '../../base/os.ts';
import { exit } from '../../base/process.ts';
import { createTestServer } from '../../tests/browser/create-test-server.ts';

/**
 * Entry point for browser benchmark debug server.
 * This starts an HTTPS debug server specifically for browser benchmarking.
 */
async function browserBenchmarksServerMain() {
  try {
    console.log('Starting HTTPS debug server for browser benchmarks...');

    const staticAssets = await buildAssets(
      undefined,
      [{ in: './benchmarks/benchmarks-entry-browser.ts', out: APP_ENTRY_POINT }],
      {
        buildDir: './build',
        jsPath: './benchmarks/benchmarks-entry-browser.ts',
        htmlPath: './benchmarks/browser/benchmark-runner.html',
        assetsPath: './benchmarks/browser/assets',
      },
    );

    const server = createTestServer({
      path: path.join(
        await (await FileImplGet()).getTempDir(),
        'browser-benchmark-data',
      ),
      port: 8080,
      orgId: 'browser-benchmark-org',
      staticAssets,
      createdBy: 'benchmark',
      appVersion: '0.0.0-benchmark',
      appName: 'GoatDB Browser Benchmarks',
      customConfig: {
        benchmarkMode: true,
        benchmark: getEnvVar('GOATDB_BENCHMARK'),
      },
    });

    await server.start();
    console.log('Browser benchmark server running at https://localhost:8080');
  } catch (error) {
    console.error('Failed to start debug server:', error);
    exit(1);
  }
}

if (import.meta.main) {
  browserBenchmarksServerMain();
}
