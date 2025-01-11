import yargs from 'yargs';
import * as path from '@std/path';
import { startDebugServer } from '../server/debug-server.ts';

async function main(): Promise<void> {
  const args = yargs(Deno.args)
    .command('run <script> <dataDir>', 'Run a React webapp in debug mode', {
      assets: {
        desc: 'Path to static assets directory. Will be available under the /assets/* URL.',
      },
    })
    .demandCommand()
    .parse();
  await startDebugServer(
    path.resolve(args.script),
    path.resolve(args.dataDir),
    path.resolve(args.assets),
  );
}

main();
