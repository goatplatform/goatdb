import * as path from '@std/path';
import { SimpleTimer } from '../base/timer.ts';
import { tuple4Get, tuple4Set } from '../base/tuple.ts';
import type { VersionNumber } from '../base/version-number.ts';
import { createBuildContext, type ReBuildContext } from '../build.ts';
import { getGoatConfig } from './config.ts';
import { Server, type ServerOptions } from '../net/server/server.ts';
import { buildAssets, type EntryPoint } from './generate-static-assets.ts';
import { notReached } from '../base/error.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { generateBuildInfo } from './build-info.ts';
import type { AppConfig } from '../mod.ts';

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
  if (Deno.build.os !== 'darwin') {
    // TODO: Windows & Linux support
    return Promise.resolve();
  }
  const cmd = new Deno.Command('open', {
    args: [
      '-na',
      'Google Chrome',
      '--args',
      '--incognito',
      url,
    ],
  });
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
};

export type DebugServerOptions =
  & Omit<ServerOptions, 'staticAssets' | 'buildInfo' | 'domain'>
  & Partial<Pick<ServerOptions, 'domain'>>
  & LiveReloadOptions
  & AppConfig;

/**
 * Starts a local debug server. The debug server implements a live reload that
 * automatically transpiles TypeScript and JSX using ESBuild.
 *
 * @param options Options for running the debug server.
 */
export async function startDebugServer(
  options: DebugServerOptions,
): Promise<never> {
  Deno.addSignalListener('SIGTERM', () => {
    ctx.close();
  });
  getGoatConfig().debug = true; // Turn on debug mode globally
  const buildInfo = await generateBuildInfo(
    options.denoJson || path.join(Deno.cwd(), 'deno.json'),
  );
  buildInfo.debugBuild = true;
  if (typeof options.domain === 'undefined') {
    options.domain = {
      resolveOrg: () => 'http://localhost:8080',
      resolveDomain: () => 'localhost',
    };
  }
  const server = new Server({
    ...(options as unknown as ServerOptions),
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
  const ctx = await createBuildContext(entryPoints);
  server.updateStaticAssets(
    await buildAssets(
      ctx,
      entryPoints,
      options,
    ),
  );
  await server.start();
  openBrowser(options.domain.resolveOrg(options.orgId || 'localhost'));
  console.log(
    `Bundling took ${
      ((performance.now() - bundlingStart) / 1000).toFixed(2)
    }sec`,
  );
  if (options.watchDir) {
    const watcher = Deno.watchFs(path.resolve(options.watchDir));
    const rebuildTimer = new SimpleTimer(300, false, async () => {
      console.log('Bundling client code...');
      bundlingStart = performance.now();
      try {
        const config = getGoatConfig();
        const version = incrementBuildNumber(config.version);
        server.updateStaticAssets(
          await buildAssets(
            ctx,
            entryPoints,
            options,
          ),
        );
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
