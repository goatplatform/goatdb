import yargs from 'yargs';
import * as path from '@std/path';
import { Server } from '../net/server/server.ts';
import { staticAssetsFromJS } from '../net/server/static-assets.ts';
import encodedStaticAsses from '../build/staticAssets.json' with {
  type: 'json',
};
import buildInfo from '../build/build-info.json' with { type: 'json' };
import { prettyJSON } from '../base/common.ts';

interface Arguments {
  path?: string;
}

function main(): void {
  yargs(Deno.args)
    .command(
      '<path>',
      'Start the server at the specified path',
      (args: Arguments) => {
        const server = new Server({
          staticAssets: staticAssetsFromJS(encodedStaticAsses),
          path: args.path || path.join(Deno.cwd(), 'server-data'),
          buildInfo,
        });
        server.start();
      },
    )
    .command('<version>', 'Display version info about this server', () => {
      console.log(prettyJSON(buildInfo));
    })
    .demandCommand()
    .parse();
}

if (import.meta.main) main();
