/**
 * Development server with live reload functionality.
 *
 * This module provides a debug server for local development that automatically
 * rebuilds and reloads when source files change.
 *
 * @module GoatDB/DebugServer
 */
import * as path from '../base/path.ts';
import { SimpleTimer } from '../base/timer.ts';
import { tuple4Get, tuple4Set } from '../base/tuple.ts';
import type { VersionNumber } from '../base/version-number.ts';
import { createBuildContext, type ReBuildContext } from '../build.ts';
import { getGoatConfig } from '../base/config.ts';
import { Server, type ServerOptions } from '../net/server/server.ts';
import { buildAssets } from './build-assets.ts';
import { notReached } from '../base/error.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { generateBuildInfo } from '../base/build-info.ts';
import { isLinux, isMac, isWindows } from '../base/os.ts';
import { isDeno, isNode } from '../base/common.ts';
import { cli } from '../base/development.ts';
import type { Schema } from '../cfds/base/schema.ts';
import type { AppConfig } from './app-config.ts';
import {
  type FileWatcher,
  shouldRebuildAfterPathChange,
  watchDirectory,
} from '../base/file-watcher.ts';
import { pathExists } from '../base/json-log/file-impl.ts';

function incrementBuildNumber(version: VersionNumber): VersionNumber {
  return tuple4Set(version, 0, tuple4Get(version, 0) + 1);
}

/**
 * Options for live reload behavior.
 */
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

/**
 * Options for the debug server, combining server options with live reload
 * and app configuration.
 */
export type DebugServerOptions<US extends Schema> =
  & Omit<ServerOptions<US>, 'staticAssets' | 'buildInfo' | 'domain'>
  & Partial<Pick<ServerOptions<US>, 'domain'>>
  & LiveReloadOptions
  & AppConfig;

async function openBrowser(url: string): Promise<void> {
  if (isDeno()) {
    let cmd: Deno.Command;
    if (isMac()) {
      cmd = new Deno.Command('open', { args: [url] });
    } else if (isLinux()) {
      cmd = new Deno.Command('xdg-open', { args: [url] });
    } else if (isWindows()) {
      cmd = new Deno.Command('cmd', { args: ['/c', 'start', url] });
    } else {
      return;
    }
    const { success, code } = await cmd.output();
    if (!success) {
      console.error(`Failed opening browser. Code: ${code}`);
    }
  } else if (isNode()) {
    // Node.js: use open command via CLI helper
    if (isMac()) {
      await cli('open', url);
    } else if (isLinux()) {
      await cli('xdg-open', url);
    } else if (isWindows()) {
      await cli('cmd', '/c', 'start', url);
    }
  }
}

function getCwd(): string {
  if (isDeno()) {
    return Deno.cwd();
  } else if (isNode()) {
    return process.cwd();
  }
  return '/';
}

/**
 * Starts a local debug server with live reload.
 *
 * The debug server automatically transpiles TypeScript and JSX using ESBuild
 * and watches for file changes to trigger rebuilds.
 *
 * @param options Options for running the debug server.
 * @returns Never returns - runs until the process is terminated.
 */
export async function startDebugServer<US extends Schema>(
  options: DebugServerOptions<US>,
): Promise<never> {
  getGoatConfig().debug = true; // Turn on debug mode globally

  const cwd = getCwd();
  let configPath = options.denoJson || options.packageJson;
  if (!configPath) {
    const denoJsonPath = path.join(cwd, 'deno.json');
    const packageJsonPath = path.join(cwd, 'package.json');
    configPath = await pathExists(denoJsonPath)
      ? denoJsonPath
      : packageJsonPath;
  }
  if (!await pathExists(configPath)) {
    throw new Error(
      `No config file found. Expected deno.json or package.json in "${cwd}".`,
    );
  }
  const buildInfo = await generateBuildInfo(configPath);
  buildInfo.debugBuild = true;

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
    await buildAssets(ctx, entryPoints, options),
  );

  if (options.afterBuild) {
    await options.afterBuild();
  }

  await server.start();

  const serverUrl = `${
    options.https ? 'https' : 'http'
  }://localhost:${server.port}`;
  openBrowser(serverUrl);

  console.log(
    `Bundling took ${
      ((performance.now() - bundlingStart) / 1000).toFixed(2)
    }sec`,
  );

  // Declare cleanup variables
  let watcher: FileWatcher | undefined;
  let rebuildTimer: SimpleTimer | undefined;

  // Setup signal handler for graceful shutdown
  const cleanup = async () => {
    watcher?.close();
    rebuildTimer?.unschedule();
    await server.stop();
    ctx.close();
  };

  if (isDeno()) {
    Deno.addSignalListener('SIGTERM', async () => {
      await cleanup();
      Deno.exit(0);
    });
  } else if (isNode()) {
    process.on('SIGTERM', async () => {
      await cleanup();
      process.exit(0);
    });
  }

  if (options.watchDir) {
    watcher = await watchDirectory(path.resolve(options.watchDir));

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
          await buildAssets(ctx, entryPoints, options),
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
    const cwd = getCwd();

    for await (const event of watcher) {
      for (const p of event.paths) {
        const relativePath = p.startsWith(cwd)
          ? p.substring(cwd.length + 1)
          : p;
        if (filterFunc(relativePath)) {
          console.log(`Detected change at ${relativePath}`);
          rebuildTimer.schedule();
        }
      }
    }
  }

  notReached();
}
