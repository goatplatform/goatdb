import { appEntryPoints, buildAssets } from '../../cli/build-assets.ts';
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

    const appConfig = {
      buildDir: './build',
      jsPath: './benchmarks/benchmarks-entry-browser.ts',
      htmlPath: './benchmarks/browser/benchmark-runner.html',
      assetsPath: './benchmarks/browser/assets',
    };
    const staticAssets = await buildAssets(
      undefined,
      appEntryPoints(appConfig),
      appConfig,
    );

    const customConfig: Record<string, unknown> = {
      benchmarkMode: true,
      benchmark: getEnvVar('GOATDB_BENCHMARK'),
      system_hardware: getEnvVar('GOATDB_SYSTEM_HARDWARE'),
    };

    const { server, setPort } = createTestServer({
      path: path.join(
        await (await FileImplGet()).getTempDir(),
        'browser-benchmark-data',
      ),
      port: 0,
      orgId: 'browser-benchmark-org',
      staticAssets,
      createdBy: 'benchmark',
      appVersion: '0.0.0-benchmark',
      appName: 'GoatDB Browser Benchmarks',
      customConfig,
    });

    await server.start();
    setPort(server.port!);
    // Server reads customConfig by reference (not a copy), so mutating here
    // propagates the port to the running server's config.
    customConfig.serverPort = server.port;
    console.log(
      `Browser benchmark server running at https://localhost:${server.port}`,
    );
  } catch (error) {
    console.error('Failed to start debug server:', error);
    exit(1);
  }
}

if (import.meta.main) {
  browserBenchmarksServerMain();
}
