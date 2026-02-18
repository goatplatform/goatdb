import { cli } from '../base/development.ts';
import { zip } from 'jsr:@deno-library/compress';

export async function buildDocs(): Promise<void> {
  await cli('rm', '-rf', 'build/docs');
  await cli('mkdir', '-p', 'build/docs');

  // Build Docusaurus via npx (Deno's npm: specifier has ESM compat issues)
  const buildProcess = new Deno.Command('npx', {
    args: [
      'docusaurus',
      'build',
      '--out-dir',
      '../build/docs',
    ],
    cwd: 'docs', // Run from docs directory where docusaurus.config.ts is located
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const { code } = await buildProcess.output();
  if (code !== 0) {
    throw new Error(`Docusaurus build failed with code ${code}`);
  }

  // Compress the contents of build/docs, not the folder itself
  await zip.compress('build/docs', 'build/docs.zip', { excludeSrc: true });
  console.log('Docs built successfully under build/docs');
}

async function serveDocs(): Promise<void> {
  console.log('🚀 Starting Docusaurus development server...');

  // Start the dev server process
  const serveProcess = new Deno.Command('npx', {
    args: [
      'docusaurus',
      'start',
    ],
    cwd: 'docs', // Run from docs directory where docusaurus.config.ts is located
    stdout: 'inherit',
    stderr: 'inherit',
  });

  // Spawn and don't wait - dev servers should run indefinitely
  const child = serveProcess.spawn();

  console.log('📡 Server starting at http://localhost:3000');
  console.log('Press Ctrl+C to stop the server');

  // Wait for the process to exit (only happens when user stops it)
  const status = await child.status;

  if (status.code !== 0) {
    throw new Error(`Docusaurus serve failed with code ${status.code}`);
  }
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
