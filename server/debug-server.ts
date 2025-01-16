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
import type { AppConfig } from './app-config.ts';

function incrementBuildNumber(version: VersionNumber): VersionNumber {
  return tuple4Set(version, 0, tuple4Get(version, 0) + 1);
}

function shouldRebuildAfterPathChange(p: string): boolean {
  const name = path.basename(p);
  if (name.startsWith('.') || p.startsWith('.')) {
    return false;
  }
  if (p.startsWith('node_modules/')) {
    return false;
  }
  if (p.includes('.git/')) {
    return false;
  }
  if (p.startsWith('server-data/')) {
    return false;
  }
  if (p.startsWith('build/')) {
    return false;
  }
  return true;
}

async function openBrowser(): Promise<void> {
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
      'http://localhost:8080',
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
   * - .git/*
   * - node_modules/*
   * - server-data/*
   * - build/*
   *
   * @param path The changed path.
   * @returns `true` for a rebuild to happen, `false` otherwise.
   */
  watchIgnore?: (path: string) => boolean;
};

export type DebugServerOptions = Omit<ServerOptions, 'staticAssets'> &
  LiveReloadOptions &
  AppConfig;

/**
 * Starts a local debug server. The debug server implements a live reload that
 * automatically transpiles TypeScript and JSX using ESBuild.
 *
 * @param options Options for running the debug server.
 */
export async function startDebugServer(
  options: DebugServerOptions,
): Promise<never> {
  const server = new Server(options);
  console.log('Starting web-app bundling...');
  const entryPoints = [
    {
      in: path.resolve(options.jsPath),
      out: APP_ENTRY_POINT,
    },
  ];

  const ctx = await createBuildContext(entryPoints);
  Deno.addSignalListener('SIGTERM', () => {
    ctx.close();
  });
  if (options.watchDir) {
    const watcher = Deno.watchFs(path.resolve(options.watchDir));
    const orgId = 'localhost';
    (await server.servicesForOrganization(orgId)).staticAssets =
      await buildAssets(
        ctx,
        entryPoints,
        getGoatConfig().version,
        options,
        undefined,
        orgId,
      );
    await server.start();
    openBrowser();
    const rebuildTimer = new SimpleTimer(300, false, async () => {
      console.log('Changes detected. Rebuilding static assets...');
      try {
        const config = getGoatConfig();
        const version = incrementBuildNumber(config.version);
        (await server.servicesForOrganization(orgId)).staticAssets =
          await buildAssets(
            ctx,
            entryPoints,
            version,
            options,
            undefined,
            orgId,
          );
        config.version = version;
        console.log('Static assets updated.');
      } catch (err: unknown) {
        console.error('Build failed. Will try again on next save.');
        console.error(err);
      }
    });
    const filterFunc = options.watchIgnore || shouldRebuildAfterPathChange;
    for await (const event of watcher) {
      for (const p of event.paths) {
        if (filterFunc(p)) {
          rebuildTimer.schedule();
        }
      }
    }
  }
  notReached();
}
