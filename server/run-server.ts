import * as path from '@std/path';
import yargs from 'yargs';
import { Server } from '../net/server/server.ts';
import { staticAssetsFromJS } from '../net/server/static-assets.ts';
import encodedStaticAsses from '../build/staticAssets.json' with { type: 'json' };
import buildInfo from '../build/build-info.json' assert { type: 'json' };

interface Arguments {
  path?: string;
}

async function main(): Promise<void> {
const args: Arguments = yargs(Deno.args)
    .command('<path>', 'Start the server at the specified path')
    .demandCommand()
    .parse();

  const server = new Server({
    staticAssets: staticAssetsFromJS(encodedStaticAsses),
    path: args.path || path.join(import.meta.url, 'server-data'),
  });
  await server.start();
}

main();
