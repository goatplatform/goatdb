import * as path from '@std/path';
import { startDebugServer } from '../../server/debug-server.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import { FileImplGet } from '../../base/json-log/file-impl.ts';
import { exit } from '../../base/process.ts';
import { getEnvVar } from '../../base/os.ts';

/**
 * Entry point for browser test debug server.
 * This starts an HTTPS debug server specifically for browser testing.
 */
async function browserTestsServerMain() {
  try {
    console.log('Starting HTTPS debug server for browser tests...');
    await startDebugServer<Schema>({
      path: path.join(
        await (await FileImplGet()).getTempDir(),
        'browser-test-data',
      ),
      buildDir: './build',
      jsPath: './tests/tests-entry-browser.ts',
      htmlPath: './tests/browser/test-runner.html',
      port: 8080,
      orgId: 'browser-test-org',
      https: { selfSigned: true },
      watchDir: '.',
      customConfig: {
        testMode: true,
        suite: getEnvVar('GOATDB_SUITE'),
        test: getEnvVar('GOATDB_TEST'),
      },
    });
  } catch (error) {
    console.error('Failed to start debug server:', error);
    exit(1);
  }
}

if (import.meta.main) {
  browserTestsServerMain();
}
