import * as path from '@std/path';
import { SimpleTimer } from '../base/timer.ts';
import { tuple4Get, tuple4Set } from '../base/tuple.ts';
import type { VersionNumber } from '../base/version-number.ts';
import { createBuildContext } from '../build.ts';
import { getGoatConfig } from './config.ts';
import { Server } from '../net/server/server.ts';
// import { getRepositoryPath } from '../base/development.ts';
import { buildAssets } from './generate-static-assets.ts';
import { loadAppConfig } from '../cli/config.ts';
import { APP_ENTRY_POINT } from '../net/server/static-assets.ts';
import { SchemaManager } from '../mod.ts';

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
  return true;
}

async function openBrowser(): Promise<void> {
  if (Deno.build.os !== 'darwin') {
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

export async function startDebugServer(appConfigPath: string): Promise<void> {
  appConfigPath = path.resolve(appConfigPath);
  const appConfig = await loadAppConfig(appConfigPath);
  const projectDir = path.dirname(appConfigPath);
  const dataDir = path.join(projectDir, 'server-data');
  await appConfig.schemaSetupTs();
  const mgr = SchemaManager.default;
  debugger;
  const server = new Server(
    {
      dir: dataDir,
      appConfig,
    },
    undefined,
    undefined,
  );
  await server.setup();
  // if (args.benchmark === true) {
  //   console.log(`Benchmark started...`);
  //   const results = await server.runBenchmark();
  //   console.log(prettyJSON(results));
  //   Deno.exit();
  // }
  console.log('Starting web-app bundling...');
  const entryPoints = [
    {
      in: path.resolve(appConfig.js),
      out: APP_ENTRY_POINT,
    },
  ];

  const ctx = await createBuildContext(entryPoints);
  Deno.addSignalListener('SIGTERM', () => {
    ctx.close();
  });
  const watcher = Deno.watchFs(projectDir);
  const orgId = 'localhost';
  (await server.servicesForOrganization(orgId)).staticAssets =
    await buildAssets(
      ctx,
      entryPoints,
      getGoatConfig().version,
      appConfig,
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
          appConfig,
          undefined,
          orgId,
        );
      config.version = version;
      console.log('Static assets updated.');
    } catch (e) {
      console.error('Build failed. Will try again on next save.');
    }
  });
  for await (const event of watcher) {
    for (const p of event.paths) {
      if (shouldRebuildAfterPathChange(p)) {
        rebuildTimer.schedule();
      }
    }
  }
}
