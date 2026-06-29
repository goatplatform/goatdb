// Type declarations for Node.js SEA module.
// Why: the scaffold must type-check outside @types/node's SEA coverage.
declare module 'node:sea' {
  export function getAsset(key: string): ArrayBuffer;
  export function getAsset(key: string, encoding: 'utf8'): string;
  export function isSea(): boolean;
}

import {
  type BuildInfo,
  Server,
  staticAssetsFromJS,
} from '@goatdb/goatdb/server';
import {
  getRuntime,
  prettyJSON,
  type ReadonlyJSONObject,
} from '@goatdb/goatdb';
import { registerSchemas } from '../common/schema.js';
import { basename, join } from 'node:path';

interface Arguments {
  path?: string;
  port?: number;
  info?: boolean;
  help?: boolean;
  version?: boolean;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Parse command line arguments.
 * Simple parser to avoid bundling yargs into the SEA binary.
 */
function parseArgs(
  args: string[],
  runtime: ReturnType<typeof getRuntime>,
): Arguments {
  const result: Arguments = {
    port: 8080,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      const portStr = args[i + 1];
      if (portStr === undefined || portStr.startsWith('-')) {
        console.error('--port requires a value.');
        runtime.exit(1);
      } else {
        i++;
        const parsed = parseInt(portStr, 10);
        if (isValidPort(parsed)) {
          result.port = parsed;
        } else {
          console.error(`Invalid port: ${portStr}.`);
          runtime.exit(1);
        }
      }
    } else if (arg.startsWith('--port=')) {
      const portStr = arg.substring(arg.indexOf('=') + 1);
      const parsed = parseInt(portStr, 10);
      if (isValidPort(parsed)) {
        result.port = parsed;
      } else {
        console.error(`Invalid port: ${portStr}.`);
        runtime.exit(1);
      }
    } else if (arg === '--path') {
      const val = args[i + 1];
      if (val === undefined || val.startsWith('-')) {
        console.error('--path requires a value.');
        runtime.exit(1);
      } else {
        i++;
        result.path = val;
      }
    } else if (arg.startsWith('--path=')) {
      const val = arg.substring(arg.indexOf('=') + 1);
      if (!val) {
        console.error('--path requires a value.');
        runtime.exit(1);
      } else {
        result.path = val;
      }
    } else if (arg === '--info' || arg === '-i') {
      result.info = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg.startsWith('-')) {
      console.warn(`Warning: Unknown flag "${arg}" ignored.`);
    } else if (!result.path) {
      result.path = arg;
    }
  }

  if (!result.path) {
    result.path = join(runtime.getCWD(), 'server-data');
  }

  return result;
}

function printHelp(
  info: BuildInfo,
  runtime: ReturnType<typeof getRuntime>,
): void {
  console.log(`
${info.appName || 'app'} v${info.appVersion || 'unknown'}

Usage: ${basename(runtime.getExecPath())} [options] [path]

Options:
  --port, -p <number>   Port to run the server on (default: 8080)
  --path <string>       Path to server data directory (default: ./server-data from current working directory)
  --info, -i            Print build information and exit
  --version, -v         Print version and exit
  --help, -h            Show this help message
`);
}

function requireSea(
  runtime: ReturnType<typeof getRuntime>,
): typeof import('node:sea') {
  try {
    return require('node:sea') as typeof import('node:sea');
  } catch {
    console.error(
      'This file must be run as a compiled SEA binary. ' +
        'Use `goatdb compile` to build it.',
    );
    return runtime.exit(1);
  }
}

function loadEmbeddedAssets(
  sea: typeof import('node:sea'),
  runtime: ReturnType<typeof getRuntime>,
): { encodedAssets: ReadonlyJSONObject; buildInfo: BuildInfo } {
  try {
    return {
      encodedAssets: JSON.parse(sea.getAsset('staticAssets.json', 'utf8')),
      buildInfo: JSON.parse(sea.getAsset('buildInfo.json', 'utf8')),
    };
  } catch (err) {
    console.error(
      'Failed to load embedded assets. Binary may be corrupted.',
    );
    console.error(err);
    return runtime.exit(1);
  }
}

// Production server - https://goatdb.dev/docs/server
/**
 * This is the SEA-compiled server entry point for Node.js.
 * Assets are loaded from the embedded SEA blob.
 */
async function main(): Promise<void> {
  const runtime = getRuntime();

  // Load embedded assets via node:sea.
  const sea = requireSea(runtime);
  const { encodedAssets, buildInfo } = loadEmbeddedAssets(sea, runtime);

  const args = parseArgs(runtime.getArgs(), runtime);

  if (args.help) {
    printHelp(buildInfo, runtime);
    runtime.exit(0);
  }

  if (args.version) {
    console.log(buildInfo.appVersion || 'unknown');
    runtime.exit(0);
  }

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
    staticAssets: staticAssetsFromJS(encodedAssets),
    path: args.path!,
    buildInfo,
    port: args.port,
  });

  await server.start();
  console.log(`GoatDB server running at http://localhost:${server.port}`);

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const forceExit = setTimeout(() => runtime.exit(1), 5_000);
    forceExit.unref?.();
    server.stop().then(() => runtime.exit(0)).catch((e) => {
      console.error(e);
      runtime.exit(1);
    });
  };
  runtime.setupSignalHandler('SIGTERM', shutdown);
  runtime.setupSignalHandler('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Server startup failed:', err);
  getRuntime().exit(1);
});
