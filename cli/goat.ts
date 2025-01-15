import yargs from 'yargs';
import * as path from '@std/path';
import { startDebugServer } from '../server/debug-server.ts';
import { prettyJSON } from '../base/common.ts';

async function main(): Promise<void> {
  const args = yargs(Deno.args)
    .command('run', 'Run a React webapp in debug mode')
    .demandCommand()
    .parse();
  console.log(prettyJSON(args));
  await startDebugServer(path.join(Deno.cwd(), 'goat.json'));
}

main();
