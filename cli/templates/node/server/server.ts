import {
  type BuildInfo,
  Server,
  staticAssetsFromJS,
} from '@goatdb/goatdb/server';
import { prettyJSON } from '@goatdb/goatdb';
import { registerSchemas } from '../common/schema.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
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
 * TODO: Add custom routes and middleware below
 */
async function main(): Promise<void> {
  const buildInfo: BuildInfo = kBuildInfo as BuildInfo;
  const args = yargs(hideBin(process.argv))
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
    console.log('\nNode.js version:', process.version);
    console.log('Platform:', process.platform, process.arch);
    process.exit(0);
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
    const forceExit = setTimeout(() => process.exit(1), 5000);
    forceExit.unref();
    server.stop().then(() => process.exit(0)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`GoatDB server running at http://localhost:${server.port}`);
}

// Node.js ESM main detection (cross-platform)
if (
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((err) => {
    console.error('Server startup failed:', err);
    process.exit(1);
  });
}
