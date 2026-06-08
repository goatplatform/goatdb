import { TEST } from './mod.ts';
import { getEnvVar } from '../base/os.ts';
import { BROWSER_FAILURE_FILTER_TEST } from './test-filter-constants.ts';

export default function setupBrowserFailureFixture(): void {
  // Intentionally gated by env var: this fixture registers a test that always
  // fails, used to verify the browser test runner's failure handling. It is
  // only activated when GOATDB_TEST matches the fixture filter string.
  if (getEnvVar('GOATDB_TEST') !== BROWSER_FAILURE_FILTER_TEST) return;
  TEST('TestRunner', BROWSER_FAILURE_FILTER_TEST, () => {
    throw new Error('intentional browser failure');
  });
}
