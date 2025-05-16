import { isBrowser, isDeno, isNode } from '../base/common.ts';
import { TestsRunner } from './mod.ts';
import setupUntrusted from './db-untrusted.test.ts';
import setupTrusted from './db-trusted.test.ts';
import setupItemPath from './item-path.ts';
import setupOrderstamp from './orderstamp-expose.test.ts';
import setupGoatRequestTest from './goat-request.test.ts';
import setupSession from './session.test.ts';
import { exit } from '../base/process.ts';

// Minimal interface for globalThis with process.env
interface GlobalWithProcessEnv {
  process?: {
    env?: Record<string, string | undefined>;
  };
}

// Cross-platform env getter
function getEnvVar(key: string): string | undefined {
  if (isDeno()) {
    // deno-lint-ignore no-explicit-any
    return (Deno.env as any)?.get?.(key);
  } else if (isNode()) {
    const g = globalThis as unknown as GlobalWithProcessEnv;
    return g.process?.env?.[key];
  }
  return undefined;
}

async function main(): Promise<void> {
  setupUntrusted();
  setupTrusted();
  setupItemPath();
  setupOrderstamp();
  setupGoatRequestTest();
  setupSession();

  // Read suite and test name from environment variables (cross-platform)
  const suiteName = getEnvVar('GOATDB_SUITE');
  const testName = getEnvVar('GOATDB_TEST');

  await TestsRunner.default.run(suiteName, testName);

  if (!isBrowser()) {
    await exit(0);
  }
}

main();
