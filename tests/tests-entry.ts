import { isBrowser } from '../base/common.ts';
import { TestsRunner } from './mod.ts';
import setupUntrusted from './db-untrusted.test.ts';
import setupTrusted from './db-trusted.test.ts';
import { exit } from '../base/process.ts';

async function main(): Promise<void> {
  setupUntrusted();
  setupTrusted();

  await TestsRunner.default.run();

  if (!isBrowser()) {
    await exit(0);
  }
}

main();
