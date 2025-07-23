import { cli } from './base/development.ts';
import * as path from 'jsr:@std/path';
import { zip } from 'jsr:@deno-library/compress';

export async function buildDocs(): Promise<void> {
  await cli('rm', '-rf', 'build/docs');
  await cli('mkdir', '-p', 'build/docs');
  
  // Build Docusaurus using Deno's npm: specifier
  const buildProcess = new Deno.Command('deno', {
    args: [
      'run',
      '-A',
      'npm:@docusaurus/core',
      'build',
      '--out-dir',
      '../build/docs',
    ],
    cwd: 'docs',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  
  const { code } = await buildProcess.output();
  if (code !== 0) {
    throw new Error(`Docusaurus build failed with code ${code}`);
  }
  
  await zip.compress('build/docs', 'build/docs.zip');
  await cli('cp', './llms.txt', 'build/docs/');
  console.log('Docs built successfully under build/docs');
}

async function serveDocs(): Promise<void> {
  // Start Docusaurus dev server using Deno's npm: specifier
  new Deno.Command('deno', {
    args: [
      'run',
      '-A',
      'npm:@docusaurus/core',
      'start',
    ],
    cwd: 'docs',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn();
}

if (import.meta.main) {
  const cmd = Deno.args[0];
  if (!cmd || (cmd !== 'build' && cmd !== 'serve')) {
    console.error('Usage: deno run -A docs-build.ts <build|serve>');
    Deno.exit(1);
  }
  if (cmd === 'build') {
    await buildDocs();
  } else if (cmd === 'serve') {
    await serveDocs();
  }
}