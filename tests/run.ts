import { nodeRun } from './node-run.ts';

async function main(): Promise<void> {
  console.log('=== 🦖 Running tests in Deno... ===');
  const denoCmd = new Deno.Command('deno', {
    args: ['run', '-A', './tests/tests-entry.ts'],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await denoCmd.output();
  console.log('=== 🦖 Tests in Deno completed ===\n');
  // Run tests in Node.js
  console.log('=== ⚡️ Running tests in Node.js... ===');
  await nodeRun('./tests/tests-entry.ts');
  console.log('=== ⚡️ Tests in Node.js completed ===');
}

main();
