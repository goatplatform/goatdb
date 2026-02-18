import yargs from 'yargs';
import * as path from '@std/path';
import { prettyJSON } from '@goatdb/goatdb';
import {
  type BuildInfo,
  Server,
  staticAssetsFromJS,
} from '@goatdb/goatdb/server';
import { registerSchemas } from '../common/schema.ts';
// These imported files will be automatically generated during compilation
import encodedStaticAssets from '../build/staticAssets.json' with {
  type: 'json',
};
import kBuildInfo from '../build/buildInfo.json' with { type: 'json' };

interface Arguments {
  path?: string;
  port?: number;
  version?: boolean;
  info?: boolean;
}

// Production server - https://goatdb.dev/docs/server
/**
 * This is the main server entry point. Edit it to include any custom setup
 * as needed.
 *
 * The build.ts script is responsible for compiling this entry point script
 * into a self contained executable.
 *
 * Add custom endpoints and middleware before starting the server.
 * See https://goatdb.dev/docs/server-logic
 *
 * Example:
 *   server.registerEndpoint(new MyWebhookEndpoint());
 *   server.registerMiddleware(new MyRateLimitMiddleware());
 */
async function main(): Promise<void> {
  const buildInfo: BuildInfo = kBuildInfo as BuildInfo;
  const args: Arguments = yargs(Deno.args)
    .command(
      '<path>',
      'Start the server at the specified path',
    )
    .version(buildInfo.appVersion)
    .option('port', {
      type: 'number',
      default: 8080,
      description: 'Port to run the server on',
    })
    .option('info', {
      alias: 'i',
      desc: 'Print technical information',
      type: 'boolean',
    })
    .help()
    .parse();
  registerSchemas();
  if (args.info) {
    console.log(
      (buildInfo.appName || 'app') + ' v' + (buildInfo.appVersion || 'unknown'),
    );
    console.log(prettyJSON(buildInfo));
    Deno.exit();
  }
  const server = new Server({
    staticAssets: staticAssetsFromJS(encodedStaticAssets),
    path: args.path || path.join(Deno.cwd(), 'server-data'),
    buildInfo,
    port: args.port,
  });
  await server.start();
  console.log(`GoatDB server running at http://localhost:${server.port}`);

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => Deno.exit(1), 5000);
    server.stop().then(() => Deno.exit(0)).catch((e) => {
      console.error(e);
      Deno.exit(1);
    });
  };
  Deno.addSignalListener('SIGTERM', shutdown);
  Deno.addSignalListener('SIGINT', shutdown);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    Deno.exit(1);
  });
}
