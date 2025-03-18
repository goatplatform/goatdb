import { TestsRunner } from './mod.ts';

await import('./db-untrusted.test.ts');
await import('./db-trusted.test.ts');

await TestsRunner.default.run();

if (typeof self.Deno !== 'undefined') {
  self.Deno.exit(0);
}
