import { cli } from './base/development.ts';
import * as path from 'jsr:@std/path';
import { zip } from 'jsr:@deno-library/compress';

export async function buildDocs(): Promise<void> {
  await cli('rm', '-rf', 'build/docs');
  await cli('mkdir', '-p', 'build/docs');
  await cli(
    'jekyll',
    'build',
    '-s',
    'docs',
    '-d',
    'build/docs',
  );
  await zip.compress('build/docs', 'build/docs.zip');
  // await cli('mkdir', '-p', 'build/docs/api');
  // await cli(
  //   'deno',
  //   'doc',
  //   '--name=GoatDB',
  //   '--output=build/docs/api',
  //   './mod.ts',
  // );
  // await cli('mkdir', '-p', 'build/docs/api/react');
  // await cli(
  //   'deno',
  //   'doc',
  //   '--name="GoatDB React Hooks"',
  //   '--output=build/docs/api/react',
  //   './react/hooks.ts',
  // );
  // await cli('mkdir', '-p', 'build/docs/api/server');
  // await cli(
  //   'deno',
  //   'doc',
  //   '--name="GoatDB Server API"',
  //   '--output=build/docs/api/server',
  //   './server/mod.ts',
  // );
  await cli('cp', './llms.txt', 'build/docs/');
  console.log('Docs built successfully under build/docs');
}

async function serveDocs(): Promise<void> {
  await buildDocs();

  // Start the file server as a subprocess
  new Deno.Command('deno', {
    args: [
      'run',
      '-A',
      'https://deno.land/std/http/file_server.ts',
      '--port',
      '4000',
      '--watch',
    ],
    cwd: 'build/docs',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn();

  // Debounce timer for rebuilds
  let rebuildTimeout: number | undefined;
  const debounce = (fn: () => void, delay: number) => {
    if (rebuildTimeout) {
      clearTimeout(rebuildTimeout);
    }
    rebuildTimeout = setTimeout(fn, delay) as unknown as number;
  };

  // Filtering logic similar to debug-server.ts
  const kIgnoredDirectories = ['node_modules', '.git', 'server-data', 'build'];
  function shouldRebuildAfterPathChange(p: string): boolean {
    if (p.endsWith('.tmp')) return false;
    const components = p.split(path.SEPARATOR);
    for (const comp of components) {
      if (comp.startsWith('.')) return false;
    }
    if (kIgnoredDirectories.includes(components[0])) return false;
    console.log(`Detected change at ${p}`);
    return true;
  }

  // Watch the docs directory for changes
  const watcher = Deno.watchFs(path.resolve('docs'));
  const cwd = Deno.cwd();
  for await (const event of watcher) {
    for (const p of event.paths) {
      const relPath = path.relative(cwd, p);
      if (shouldRebuildAfterPathChange(relPath)) {
        debounce(async () => {
          console.log('Rebuilding docs...');
          await buildDocs();
        }, 300);
        break;
      }
    }
  }
}

if (import.meta.main) {
  const cmd = Deno.args[0];
  if (!cmd || (cmd !== 'build' && cmd !== 'serve')) {
    console.error('Usage: deno run -A gen-docs.ts <build|serve>');
    Deno.exit(1);
  }
  if (cmd === 'build') {
    await buildDocs();
  } else if (cmd === 'serve') {
    await serveDocs();
  }
}
