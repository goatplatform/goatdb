import * as path from '@std/path';
import { SimpleTimer } from '../base/timer.ts';
import { tuple4Get, tuple4Set } from '../base/tuple.ts';
import type { VersionNumber } from '../base/version-number.ts';
import { createBuildContext } from '../build.ts';
import { getGoatConfig } from './config.ts';
import { Server, type ServerOptions } from '../net/server/server.ts';
import { buildAssets } from './generate-static-assets.ts';
import { notReached } from '../base/error.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { generateBuildInfo } from './build-info.ts';
import { isLinux, isMac, isWindows } from '../base/os.ts';
import type { Schema } from '../cfds/base/schema.ts';
import type { AppConfig } from './app-config.ts';
function incrementBuildNumber(version: VersionNumber): VersionNumber {
  return tuple4Set(version, 0, tuple4Get(version, 0) + 1);
}

const kIgnoredDirectories = ['node_modules', '.git', 'server-data', 'build'];

function shouldRebuildAfterPathChange(p: string): boolean {
  // Ignore deno's temporary files
  if (p.endsWith('.tmp')) {
    return false;
  }
  // Ignore paths where any of the components start with '.'
  const components = p.split(path.SEPARATOR_PATTERN);
  for (const comp of components) {
    if (comp.startsWith('.')) {
      return false;
    }
  }
  // Explicitly ignored directories
  if (kIgnoredDirectories.includes(components[0])) {
    return false;
  }
  console.log(`Detected change at ${p}`);
  return true;
}

async function openBrowser(url: string): Promise<void> {
  let cmd: Deno.Command;
  if (isMac()) {
    cmd = new Deno.Command('open', {
      args: [
        '-na',
        'Google Chrome',
        '--args',
        '--incognito',
        url,
      ],
    });
  } else if (isLinux()) {
    // TODO: Incognito mode
    cmd = new Deno.Command('xdg-open', {
      args: [
        url,
      ],
    });
  } else if (isWindows()) {
    // TODO: Incognito mode
    cmd = new Deno.Command('start', {
      args: [
        url,
      ],
    });
  } else {
    // Unsupported platform
    return;
  }
  const { success, code } = await cmd.output();
  if (!success) {
    console.error(`Failed opening google chrome. Code: ${code}`);
  }
}

export type LiveReloadOptions = {
  /**
   * Full path to watch for changes. When a file changes under this path the
   * server will trigger a rebuild and reload of the client code.
   */
  watchDir?: string;
  /**
   * An optional filter function that decides what changes under the `watchDir`
   * will trigger a reload. The default implementation ignores the following
   * paths:
   *
   * - All paths starting with '.'
   * - All files ending with '.tmp'
   * - .git/*
   * - node_modules/*
   * - server-data/*
   * - build/*
   *
   * @param path The changed path.
   * @returns `true` for a rebuild to happen, `false` otherwise.
   */
  watchFilter?: (path: string) => boolean;
  /**
   * The organization id to use for the debug server. This allows you to locally
   * simulate and debug a specific organization's environment by running the
   * server as if it were handling requests for that organization.
   */
  orgId?: string;
  /**
   * An optional function that is called before a build is triggered.
   *
   * This hook can be used to run additional build steps, for example,
   * triggering a tailwindcss rebuild to generate updated CSS before
   * the main application rebuild happens.
   */
  beforeBuild?: () => Promise<void>;
  /**
   * An optional function that is called after a build is triggered.
   */
  afterBuild?: () => Promise<void>;
};

export type DebugServerOptions<US extends Schema> =
  & Omit<ServerOptions<US>, 'staticAssets' | 'buildInfo' | 'domain'>
  & Partial<Pick<ServerOptions<US>, 'domain'>>
  & LiveReloadOptions
  & AppConfig;

/**
 * Starts a local debug server. The debug server implements a live reload that
 * automatically transpiles TypeScript and JSX using ESBuild.
 *
 * @param options Options for running the debug server.
 */
export async function startDebugServer<US extends Schema>(
  options: DebugServerOptions<US>,
): Promise<never> {
  getGoatConfig().debug = true; // Turn on debug mode globally
  const buildInfo = await generateBuildInfo(
    options.denoJson || path.join(Deno.cwd(), 'deno.json'),
  );
  buildInfo.debugBuild = true;
  if (typeof options.domain === 'undefined') {
    const protocol = options.https ? 'https' : 'http';
    const defaultPort = options.https ? 8443 : 8080;
    const port = options.port || defaultPort;
    
    options.domain = {
      resolveOrg: () => `${protocol}://localhost:${port}`,
      resolveDomain: () => 'localhost',
    };
  }
  const server = new Server({
    ...(options as unknown as ServerOptions<US>),
    buildInfo,
  });
  console.log('Bundling client code...');
  let bundlingStart = performance.now();
  const entryPoints = [
    {
      in: path.resolve(options.jsPath),
      out: APP_ENTRY_POINT,
    },
  ];
  await server.servicesForOrganization(options.orgId || 'localhost');
  if (options.beforeBuild) {
    await options.beforeBuild();
  }
  const ctx = await createBuildContext(entryPoints);
  server.updateStaticAssets(
    await buildAssets(
      ctx,
      entryPoints,
      options,
    ),
  );
  if (options.afterBuild) {
    await options.afterBuild();
  }
  await server.start();
  openBrowser(options.domain.resolveOrg(options.orgId || 'localhost'));
  console.log(
    `Bundling took ${
      ((performance.now() - bundlingStart) / 1000).toFixed(2)
    }sec`,
  );
  
  // Declare cleanup variables
  let watcher: Deno.FsWatcher | undefined;
  let rebuildTimer: SimpleTimer | undefined;
  
  // Setup SIGTERM handler for graceful shutdown
  Deno.addSignalListener('SIGTERM', async () => {
    watcher?.close();
    rebuildTimer?.unschedule();
    await server.stop();
    ctx.close();
    Deno.exit(0);
  });
  
  if (options.watchDir) {
    watcher = Deno.watchFs(path.resolve(options.watchDir));
    rebuildTimer = new SimpleTimer(300, false, async () => {
      console.log('Bundling client code...');
      bundlingStart = performance.now();
      try {
        const config = getGoatConfig();
        const version = incrementBuildNumber(config.version);
        if (options.beforeBuild) {
          await options.beforeBuild();
        }
        server.updateStaticAssets(
          await buildAssets(
            ctx,
            entryPoints,
            options,
          ),
        );
        if (options.afterBuild) {
          await options.afterBuild();
        }
        config.version = version;
        console.log(
          `Bundling took ${
            ((performance.now() - bundlingStart) / 1000).toFixed(2)
          }sec`,
        );
      } catch (err: unknown) {
        console.error('Build failed. Will try again on next save.');
        console.error(err);
      }
    });
    const filterFunc = options.watchFilter || shouldRebuildAfterPathChange;
    const cwd = Deno.cwd();
    for await (const event of watcher) {
      for (const p of event.paths) {
        if (filterFunc(p.substring(cwd.length + 1))) {
          rebuildTimer.schedule();
        }
      }
    }
  }
  notReached();
}
