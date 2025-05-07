import { nodeRun } from './node-run.ts';

async function main(): Promise<void> {
  const start = performance.now();
  console.log('=== 🦖 Running tests in Deno... ===');
  const denoStart = performance.now();
  const denoCmd = new Deno.Command('deno', {
    args: ['run', '-A', './tests/tests-entry.ts'],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await denoCmd.output();
  const denoEnd = performance.now();
  const denoElapsed = ((denoEnd - denoStart) / 1000).toFixed(2);
  console.log('=== 🦖 Tests in Deno completed ===\n');
  // Run tests in Node.js
  console.log('=== ⚡️ Running tests in Node.js... ===');
  const nodeStart = performance.now();
  await nodeRun('./tests/tests-entry.ts');
  const nodeEnd = performance.now();
  const nodeElapsed = ((nodeEnd - nodeStart) / 1000).toFixed(2);
  console.log('=== ⚡️ Tests in Node.js completed ===');
  const end = performance.now();
  const totalElapsed = ((end - start) / 1000).toFixed(2);
  console.log(
    `=== 🕒 Summary: Deno: ${denoElapsed}s | Node.js: ${nodeElapsed}s | Total: ${totalElapsed}s ===`,
  );
}

main();
