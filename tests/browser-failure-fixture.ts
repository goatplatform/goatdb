import { TEST } from './mod.ts';
import { getEnvVar } from '../base/os.ts';
import { BROWSER_FAILURE_FILTER_TEST } from './test-filter-constants.ts';

export default function setupBrowserFailureFixture(): void {
  if (getEnvVar('GOATDB_TEST') !== BROWSER_FAILURE_FILTER_TEST) return;
  TEST('TestRunner', BROWSER_FAILURE_FILTER_TEST, () => {
    throw new Error('intentional browser failure');
  });
}
