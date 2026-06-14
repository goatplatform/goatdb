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
  resolveBuildEntryPath,
} from '../build.ts';
import { getGoatConfig } from '../base/config.ts';
import { Server, type ServerOptions } from '../net/server/server.ts';
import { buildAssets, type EntryPoint } from './build-assets.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import type { BuildInfo } from '../base/build-info.ts';
import { exit } from '../base/process.ts';
import {
  getEffectiveCWD,
  getEffectiveRuntimeId,
  getRuntime,
  openBrowser,
} from '../base/runtime/index.ts';
import { log } from '../logging/log.ts';
import type { Schema } from '../cfds/base/schema.ts';
import type { AppConfig } from './app-config.ts';
import {
  type FileWatcher,
  shouldRebuildAfterPathChange,
  watchDirectory,
} from '../base/file-watcher.ts';
import { notReached } from '../base/error.ts';
import {
  resolveRuntimeBuildInfo,
  type RuntimeConfigFileOptions,
} from './runtime-build-info.ts';

/** Guards startDebugServer against concurrent calls that would corrupt config.debug save/restore. */
let _debugServerActive = false;

function incrementBuildNumber(version: VersionNumber): VersionNumber {
  return tuple4Set(version, 0, tuple4Get(version, 0) + 1);
}

function setupDebugServerSignalHandlers(
  handler: () => void,
): () => void {
  const runtime = getRuntime();
  const cleanup1 = runtime.setupSignalHandler('SIGTERM', handler);
  const cleanup2 = runtime.setupSignalHandler('SIGINT', handler);
  return () => {
    try {
      cleanup1();
    } catch {
      // Ignore cleanup races during shutdown.
    }
    try {
      cleanup2();
    } catch {
      // Ignore cleanup races during shutdown.
    }
  };
}

/** @internal Shared watch-loop so iterator failures surface to callers. */
export async function runDebugServerWatchLoop(
  watcher: FileWatcher,
  cwd: string,
  filterFunc: (path: string) => boolean,
  onMatch: (relativePath: string) => void,
): Promise<void> {
  for await (const event of watcher) {
    for (const p of event.paths) {
      const relativePath = p.startsWith(cwd) ? p.substring(cwd.length + 1) : p;
      if (filterFunc(relativePath)) {
        onMatch(relativePath);
      }
    }
  }
}

function debugServerOrigin<US extends Schema>(
  server: Server<US>,
  options: DebugServerOptions<US>,
): string {
  const protocol = options.https ? 'https:' : 'http:';
  const resolved = options.domain?.resolveOrg(options.orgId || 'localhost');
  if (resolved) {
    try {
      const url = new URL(resolved);
      url.protocol = protocol;
      if (!url.port || url.port === '0') {
        url.port = String(server.port);
      }
      url.pathname = '';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch {
      // Fall through to the local default below.
    }
  }
  const hostname = options.https && 'selfSigned' in options.https &&
      options.https.hostname
    ? options.https.hostname
    : 'localhost';
  return `${protocol}//${hostname}:${server.port}`;
}

// ── Debug server lifecycle helpers ──────────────────────────────────────

/** @internal Mutable holder for resources acquired during setup. */
interface DebugServerResources {
  ctx: ReBuildContext | undefined;
  watcher: FileWatcher | undefined;
  rebuildTimer: SimpleTimer | undefined;
  shuttingDown: boolean;
  cleanup(): Promise<void>;
  stopped: Promise<void>;
  removeSignalHandlers(): void;
}

function createDebugServerLifecycle<US extends Schema>(
  server: Server<US>,
): DebugServerResources {
  let resolveStopped!: () => void;
  let cleanupPromise: Promise<void> | undefined;
  const resources: DebugServerResources = {
    ctx: undefined,
    watcher: undefined,
    rebuildTimer: undefined,
    shuttingDown: false,
    stopped: new Promise<void>((resolve) => {
      resolveStopped = resolve;
    }),
    cleanup() {
      if (cleanupPromise) return cleanupPromise;
      resources.shuttingDown = true;
      cleanupPromise = (async () => {
        try {
          resources.watcher?.close();
          resources.rebuildTimer?.unschedule();
          try {
            await server.stop();
          } finally {
            resources.ctx?.close();
          }
        } finally {
          resolveStopped();
        }
      })();
      return cleanupPromise;
    },
    removeSignalHandlers() {},
  };

  let signalShutdownStarted = false;
  const signalHandler = (): void => {
    if (signalShutdownStarted) return;
    signalShutdownStarted = true;
    // Must be synchronous: setupSignalHandler does not await async callbacks.
    void resources.cleanup().then(() => exit(0)).catch((err) => {
      log({
        severity: 'ERROR',
        error: 'UncaughtServerError',
        message: `Debug server cleanup failed: ${err}`,
        trace: err instanceof Error ? err.stack : undefined,
      });
      exit(1);
    });
  };
  resources.removeSignalHandlers = setupDebugServerSignalHandlers(
    signalHandler,
  );

  return resources;
}

async function resolveDebugServerConfig(
  runtime: 'deno' | 'node',
  cwd: string,
  options: RuntimeConfigFileOptions,
): Promise<{ buildInfo: BuildInfo }> {
  const buildInfo = await resolveRuntimeBuildInfo(runtime, cwd, options);
  buildInfo.debugBuild = true;
  return { buildInfo };
}

/**
 * Relative jsPath values resolve against the real runtime CWD (not the
 * test-overridden effective CWD) so paths like './client/index.tsx' work
 * from the project root where startDebugServer was invoked.
 */
function buildDebugServerEntryPoints<US extends Schema>(
  options: DebugServerOptions<US>,
): { entryPoints: EntryPoint[]; appConfig: AppConfig } {
  const entryPoints = [
    {
      in: resolveBuildEntryPath(
        path.isFileUrlPath(options.jsPath) || path.isAbsolute(options.jsPath)
          ? options.jsPath
          : path.join(getRuntime().getCWD(), options.jsPath),
      ),
      out: APP_ENTRY_POINT,
    },
  ];
  const appConfig: AppConfig = {
    buildDir: options.buildDir,
    jsPath: options.jsPath,
    htmlPath: options.htmlPath,
    cssPath: options.cssPath,
    assetsPath: options.assetsPath,
    assetsFilter: options.assetsFilter,
    denoJson: options.denoJson,
    packageJson: options.packageJson,
    minify: options.minify,
    appName: options.appName,
  };
  return { entryPoints, appConfig };
}

async function runDebugServerBuild<US extends Schema>(
  resources: DebugServerResources,
  server: Server<US>,
  entryPoints: EntryPoint[],
  appConfig: AppConfig,
  options: DebugServerOptions<US>,
): Promise<void> {
  await server.servicesForOrganization(options.orgId || 'localhost');
  if (options.setup) await options.setup(server);
  if (options.beforeBuild) await options.beforeBuild();
  // createBuildContext is development-only and never minifies;
  // appConfig.minify is intentionally not forwarded here.
  resources.ctx = await createBuildContext(
    entryPoints,
    options.esbuildPlugins,
  );
  server.updateStaticAssets(
    await buildAssets(resources.ctx, entryPoints, appConfig),
  );
  if (options.afterBuild) await options.afterBuild();
  await server.start();
}

async function setupDebugServerWatcher<US extends Schema>(
  resources: DebugServerResources,
  server: Server<US>,
  entryPoints: EntryPoint[],
  appConfig: AppConfig,
  options: DebugServerOptions<US>,
): Promise<void> {
  if (!options.watchDir) return;
  resources.watcher = await watchDirectory(path.resolve(options.watchDir));
  resources.rebuildTimer = new SimpleTimer(300, false, async () => {
    if (resources.shuttingDown) return;
    log({ severity: 'INFO', message: 'Bundling client code...' });
    const bundlingStart = performance.now();
    try {
      const config = getGoatConfig();
      const version = incrementBuildNumber(config.version);
      if (options.beforeBuild) await options.beforeBuild();
      server.updateStaticAssets(
        await buildAssets(resources.ctx, entryPoints, appConfig),
      );
      if (options.afterBuild) await options.afterBuild();
      config.version = version;
      log({
        severity: 'INFO',
        message: `Bundling took ${
          ((performance.now() - bundlingStart) / 1000).toFixed(2)
        }sec`,
      });
    } catch (err: unknown) {
      log({
        severity: 'WARNING',
        error: 'BuildFailure',
        message: 'Build failed. Will try again on next save.',
      });
      log({
        severity: 'WARNING',
        error: 'BuildFailure',
        message: err instanceof Error ? err.message : String(err),
        trace: err instanceof Error ? err.stack : undefined,
      });
    }
  });
}

async function runDebugServerWatcherLoop(
  resources: DebugServerResources,
  cwd: string,
  options: LiveReloadOptions,
): Promise<void> {
  if (!resources.watcher || !resources.rebuildTimer) return;
  const filterFunc = options.watchFilter || shouldRebuildAfterPathChange;
  try {
    await runDebugServerWatchLoop(
      resources.watcher,
      cwd,
      filterFunc,
      (relativePath) => {
        log({
          severity: 'INFO',
          message: `Detected change at ${relativePath}`,
        });
        resources.rebuildTimer!.schedule();
      },
    );
  } catch (err) {
    if (!resources.shuttingDown) {
      log({
        severity: 'ERROR',
        error: 'UncaughtServerError',
        message: `Debug server file watcher failed for ${options.watchDir}: ${
          String(err)
        }`,
        trace: err instanceof Error ? err.stack : undefined,
      });
    }
    throw err;
  }
  if (resources.shuttingDown) {
    await resources.cleanup();
    return;
  }
  notReached('Debug server file watcher exited unexpectedly.');
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
 * Active debug-server session handle, exposed via the `onReady` callback.
 * Provides the running server, its local URL, and an idempotent `stop()` for
 * programmatic shutdown.
 * @group Debug Server
 */
export type DebugServerSession<US extends Schema> = {
  /**
   * The started server instance.
   */
  server: Server<US>;
  /**
   * The origin URL (`scheme://host:port`) chosen for this debug-server run.
   */
  url: string;
  /**
   * Stops the debug server and releases its watcher/build resources.
   * Safe to call multiple times.
   */
  stop(): Promise<void>;
};

/**
 * Options for the debug server, combining server options with live reload,
 * app configuration, and development hooks.
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
     * In development (`startDebugServer`), plugins are baked into the build
     * context at startup, run before GoatDB's fallback CSS loader, and require
     * a restart to change. Use them to rewrite CSS imports, resolve package
     * CSS, or provide other browser bundle transforms.
     *
     * @remarks GoatDB reserves the plugin names `'adapter-stub'`,
     * `'node-stub'`, and `'goatdb-css-loader'` internally.
     * User-supplied plugins must use a different name.
     */
    esbuildPlugins?: BuildPluginLike[];
    /**
     * Called after the server and database are initialized but before
     * HTTP listening begins. Use this to access the GoatDB instance
     * for server-side application logic (event handlers, background
     * processes, custom endpoints).
     */
    setup?: (server: Server<US>) => void | Promise<void>;
    /**
     * If false, suppresses the automatic browser launch after startup.
     * Defaults to true.
     */
    openBrowser?: boolean;
    /**
     * Called after HTTP listening begins and before the automatic browser
     * launch. Use this for embedded tooling or tests that need the final URL
     * and an explicit shutdown hook.
     */
    onReady?: (
      session: DebugServerSession<US>,
    ) => void | Promise<void>;
  };

/**
 * Starts a local debug server with live reload.
 *
 * The debug server automatically transpiles TypeScript and JSX using ESBuild,
 * watches for file changes to trigger rebuilds, and opens the local URL in a
 * browser unless `openBrowser` is false.
 *
 * @param options Options for running the debug server.
 * @returns Resolves after clean shutdown. Rejects if startup fails or a live
 *   watcher fails after startup.
 * @group Debug Server
 */
export async function startDebugServer<US extends Schema>(
  options: DebugServerOptions<US>,
): Promise<void> {
  const config = getGoatConfig();
  const originalDebug = config.debug;
  const runtime = getEffectiveRuntimeId();
  if (runtime !== 'deno' && runtime !== 'node') {
    throw new Error(
      'startDebugServer() is only supported in Deno or Node.js. ' +
        'Use compile() for production builds targeting other runtimes.',
    );
  }
  const cwd = getEffectiveCWD();

  // Guard against concurrent calls before any async work that would
  // corrupt config.debug save/restore.
  if (_debugServerActive) {
    throw new Error(
      'startDebugServer is already running. Only one instance at a time is supported.',
    );
  }
  _debugServerActive = true;

  let resources: DebugServerResources | undefined;
  try {
    const { buildInfo } = await resolveDebugServerConfig(runtime, cwd, options);
    config.debug = true;

    const server = new Server({
      ...(options as unknown as ServerOptions<US>),
      buildInfo,
    });
    resources = createDebugServerLifecycle(server);

    log({ severity: 'INFO', message: 'Bundling client code...' });
    const bundlingStart = performance.now();
    const { entryPoints, appConfig } = buildDebugServerEntryPoints(options);
    await runDebugServerBuild(
      resources,
      server,
      entryPoints,
      appConfig,
      options,
    );
    log({
      severity: 'INFO',
      message: `Bundling took ${
        ((performance.now() - bundlingStart) / 1000).toFixed(2)
      }sec`,
    });
    await setupDebugServerWatcher(
      resources,
      server,
      entryPoints,
      appConfig,
      options,
    );

    const serverUrl = debugServerOrigin(server, options);

    if (options.onReady) {
      await options.onReady({
        server,
        url: serverUrl,
        stop: resources.cleanup,
      });
    }
    if (options.openBrowser !== false && !resources.shuttingDown) {
      await openBrowser(serverUrl);
    }
    if (resources.shuttingDown) {
      await resources.stopped;
      return;
    }

    if (resources.watcher) {
      await runDebugServerWatcherLoop(resources, cwd, options);
    }

    // No watcher configured: wait until a signal or embedded caller stops us.
    await resources.stopped;
  } catch (err) {
    await resources?.cleanup().catch((cleanupErr) => {
      log({
        severity: 'ERROR',
        error: 'UncaughtServerError',
        message:
          `Debug server cleanup after failure also failed: ${cleanupErr}`,
        trace: cleanupErr instanceof Error ? cleanupErr.stack : undefined,
      });
    });
    throw err;
  } finally {
    resources?.removeSignalHandlers();
    _debugServerActive = false;
    config.debug = originalDebug;
  }
}
