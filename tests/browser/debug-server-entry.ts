import { buildAssets } from '../../cli/build-assets.ts';
import { APP_ENTRY_POINT } from '../../net/server/static-assets.ts';
import { FileImplGet } from '../../base/json-log/file-impl.ts';
import * as path from '../../base/path.ts';
import { getEnvVar } from '../../base/os.ts';
import { exit } from '../../base/process.ts';
import { createTestServer } from './create-test-server.ts';

/**
 * Entry point for browser test debug server.
 * This starts an HTTPS debug server specifically for browser testing.
 */
async function browserTestsServerMain() {
  try {
    console.log('Starting HTTPS debug server for browser tests...');

    const staticAssets = await buildAssets(
      undefined,
      [{ in: './tests/tests-entry-browser.ts', out: APP_ENTRY_POINT }],
      {
        buildDir: './build',
        jsPath: './tests/tests-entry-browser.ts',
        htmlPath: './tests/browser/test-runner.html',
      },
    );

    const server = createTestServer({
      path: path.join(
        await (await FileImplGet()).getTempDir(),
        'browser-test-data',
      ),
      port: 8080,
      orgId: 'browser-test-org',
      staticAssets,
      createdBy: 'test',
      appVersion: '0.0.0-test',
      appName: 'GoatDB Browser Tests',
      customConfig: {
        testMode: true,
        suite: getEnvVar('GOATDB_SUITE'),
        test: getEnvVar('GOATDB_TEST'),
      },
    });

    await server.start();
    console.log('Browser test server running at https://localhost:8080');
  } catch (error) {
    console.error('Failed to start debug server:', error);
    exit(1);
  }
}

if (import.meta.main) {
  browserTestsServerMain();
}
