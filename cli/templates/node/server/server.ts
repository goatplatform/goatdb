import {
  type BuildInfo,
  Server,
  staticAssetsFromJS,
} from '@goatdb/goatdb/server';
import { getRuntime, prettyJSON } from '@goatdb/goatdb';
import { registerSchemas } from '../common/schema.js';
import yargs from 'yargs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// These imported files will be automatically generated during compilation
import encodedStaticAssets from '../build/staticAssets.json' with {
  type: 'json',
};
import kBuildInfo from '../build/buildInfo.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Arguments {
  path?: string;
  port?: number;
  info?: boolean;
}

// Production server - https://goatdb.dev/docs/server
/**
 * This is the main server entry point for Node.js. Edit it to include any
 * custom setup as needed.
 *
 * The build.ts script is responsible for compiling this entry point script
 * into a production bundle.
 *
 * Add custom endpoints and middleware before starting the server.
 * See https://goatdb.dev/docs/server-logic
 *
 * Example:
 *   server.registerEndpoint(new MyWebhookEndpoint());
 *   server.registerMiddleware(new MyRateLimitMiddleware());
 */
async function main(): Promise<void> {
  const runtime = getRuntime();
  const buildInfo: BuildInfo = kBuildInfo as BuildInfo;
  const args = yargs(runtime.getArgs())
    .version(buildInfo.appVersion)
    .option('port', {
      type: 'number',
      default: 8080,
      description: 'Port to run the server on',
    })
    .option('path', {
      type: 'string',
      default: join(__dirname, '../server-data'),
      description: 'Path to server data directory',
    })
    .option('info', {
      alias: 'i',
      type: 'boolean',
      description: 'Print technical information',
    })
    .help()
    .argv as Arguments;

  registerSchemas();

  if (args.info) {
    console.log(
      (buildInfo.appName || 'app') + ' v' + (buildInfo.appVersion || 'unknown'),
    );
    console.log(prettyJSON(buildInfo));
    console.log('\nRuntime:', runtime.getSystemInfo());
    runtime.exit(0);
  }

  const server = new Server({
    staticAssets: staticAssetsFromJS(encodedStaticAssets),
    path: args.path!,
    buildInfo,
    port: args.port,
  });

  await server.start();

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const forceExit = setTimeout(() => runtime.exit(1), 5000);
    // setTimeout returns a Node.js Timeout with .unref() in standard Node.js.
    // The SEA template uses unref?.() because esbuild may transpile it to a
    // context that lacks the typed unref, but here we always have it.
    forceExit.unref();
    server.stop().then(() => runtime.exit(0)).catch((e) => {
      console.error(e);
      runtime.exit(1);
    });
  };
  runtime.setupSignalHandler('SIGTERM', shutdown);
  runtime.setupSignalHandler('SIGINT', shutdown);

  console.log(`GoatDB server running at http://localhost:${server.port}`);
}

if (getRuntime().isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error('Server startup failed:', err);
    getRuntime().exit(1);
  });
}
