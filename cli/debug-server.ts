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
import {
  type BuildPluginLike,
  createBuildContext,
  type ReBuildContext,
} from '../build.ts';
import { getGoatConfig } from '../base/config.ts';
import { Server, type ServerOptions } from '../net/server/server.ts';
import { buildAssets } from './build-assets.ts';
import { notReached } from '../base/error.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { generateBuildInfo } from '../base/build-info.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { log } from '../logging/log.ts';
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
 * @group Debug Server
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
 * @group Debug Server
 */
export type DebugServerOptions<US extends Schema> =
  & Omit<ServerOptions<US>, 'staticAssets' | 'buildInfo' | 'domain'>
  & Partial<Pick<ServerOptions<US>, 'domain'>>
  & LiveReloadOptions
  & AppConfig
  & {
    /**
     * Custom esbuild plugins injected into the client bundle pipeline.
     * Deno-only. In development (`startDebugServer`), plugins are baked into
     * the build context at startup, run before GoatDB's fallback CSS loader,
     * and require a restart to change. Use them to rewrite CSS imports, resolve
     * package CSS, or provide other browser bundle transforms.
     *
     * @remarks The namespace `'node-stub'` is reserved by GoatDB internally.
     * User-supplied plugins must not register that name.
     */
    esbuildPlugins?: BuildPluginLike[];
    /**
     * Called after the server and database are initialized but before
     * HTTP listening begins. Use this to access the GoatDB instance
     * for server-side application logic (event handlers, background
     * processes, custom endpoints).
     */
    setup?: (server: Server<US>) => void | Promise<void>;
  };

/**
 * Starts a local debug server with live reload.
 *
 * The debug server automatically transpiles TypeScript and JSX using ESBuild
 * and watches for file changes to trigger rebuilds. Deno-only: the client
 * build context uses `@luca/esbuild-deno-loader`.
 *
 * @param options Options for running the debug server.
 * @returns Never returns - runs until the process is terminated.
 * @group Debug Server
 */
export async function startDebugServer<US extends Schema>(
  options: DebugServerOptions<US>,
): Promise<never> {
  if (getRuntime().id !== 'deno') {
    throw new Error(
      'startDebugServer() is only supported in Deno. GoatDB debug-server ' +
        'bundling uses @luca/esbuild-deno-loader; Node.js users should run ' +
        'the scaffolded dev server or use compile() for production builds.',
    );
  }
  getGoatConfig().debug = true; // Turn on debug mode globally

  const cwd = getRuntime().getCWD();
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

  log({ severity: 'INFO', message: 'Bundling client code...' });
  let bundlingStart = performance.now();

  const entryPoints = [
    {
      in: path.resolve(options.jsPath),
      out: APP_ENTRY_POINT,
    },
  ];

  await server.servicesForOrganization(options.orgId || 'localhost');

  if (options.setup) {
    await options.setup(server);
  }

  if (options.beforeBuild) {
    await options.beforeBuild();
  }

  // createBuildContext is development-only and never minifies;
  // appConfig.minify is intentionally not forwarded here.
  const ctx = await createBuildContext(
    entryPoints,
    options.esbuildPlugins,
  );
  const { esbuildPlugins: _ignoredEsbuildPlugins, ...buildOptions } = options;
  server.updateStaticAssets(
    await buildAssets(ctx, entryPoints, buildOptions),
  );

  if (options.afterBuild) {
    await options.afterBuild();
  }

  await server.start();

  const serverUrl = `${
    options.https ? 'https' : 'http'
  }://localhost:${server.port}`;
  await getRuntime().openBrowser(serverUrl);

  log({
    severity: 'INFO',
    message: `Bundling took ${
      ((performance.now() - bundlingStart) / 1000).toFixed(2)
    }sec`,
  });

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

  getRuntime().setupSignalHandler('SIGTERM', async () => {
    try {
      await cleanup();
      getRuntime().exit(0);
    } catch (err) {
      log({
        severity: 'ERROR',
        error: 'UncaughtServerError',
        message: `Debug server cleanup failed: ${err}`,
      });
      getRuntime().exit(1);
    }
  });

  if (options.watchDir) {
    watcher = await watchDirectory(path.resolve(options.watchDir));

    rebuildTimer = new SimpleTimer(300, false, async () => {
      log({ severity: 'INFO', message: 'Bundling client code...' });
      bundlingStart = performance.now();
      try {
        const config = getGoatConfig();
        const version = incrementBuildNumber(config.version);

        if (options.beforeBuild) {
          await options.beforeBuild();
        }

        server.updateStaticAssets(
          await buildAssets(ctx, entryPoints, buildOptions),
        );

        if (options.afterBuild) {
          await options.afterBuild();
        }

        config.version = version;
        log({
          severity: 'INFO',
          message: `Bundling took ${
            ((performance.now() - bundlingStart) / 1000).toFixed(2)
          }sec`,
        });
      } catch (err: unknown) {
        log({
          severity: 'ERROR',
          error: 'UncaughtServerError',
          message: 'Build failed. Will try again on next save.',
        });
        log({
          severity: 'ERROR',
          error: 'UncaughtServerError',
          message: `Build error: ${err}`,
        });
      }
    });

    const filterFunc = options.watchFilter || shouldRebuildAfterPathChange;
    const cwd = getRuntime().getCWD();

    for await (const event of watcher) {
      for (const p of event.paths) {
        const relativePath = p.startsWith(cwd)
          ? p.substring(cwd.length + 1)
          : p;
        if (filterFunc(relativePath)) {
          log({
            severity: 'INFO',
            message: `Detected change at ${relativePath}`,
          });
          rebuildTimer.schedule();
        }
      }
    }
  }

  notReached();
}
