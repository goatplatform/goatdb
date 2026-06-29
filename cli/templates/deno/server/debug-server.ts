// Development server with hot reload
// See https://goatdb.dev/docs/server-logic for custom endpoints and middleware
import { getRuntime } from '@goatdb/goatdb';
import { Server } from '@goatdb/goatdb/server';
import { registerSchemas } from '../common/schema.ts';

async function main(): Promise<void> {
  registerSchemas();

  const runtime = getRuntime();
  const systemInfo = runtime.getSystemInfo();

  // Development builds should reflect the active runtime adapter, not host globals.
  const buildInfo = {
    creationDate: new Date().toISOString(),
    createdBy: 'dev',
    builder: {
      runtime: 'deno' as const,
      target: systemInfo.target ?? 'unknown',
      arch: systemInfo.arch ?? 'unknown',
      os: systemInfo.os ?? 'unknown',
      vendor: systemInfo.vendor ?? 'unknown',
      env: systemInfo.env ?? null,
    },
    appVersion: '0.0.1-dev',
    debugBuild: true,
    appName: 'GoatDB Development Server',
  };

  // Create development domain config
  const domain = {
    resolveOrg: () => 'http://localhost:8080',
    resolveDomain: () => 'dev-org',
  };

  // Create development server
  const server = new Server({
    path: 'server-data',
    buildInfo,
    domain,
    port: 8080,
    orgId: 'dev-org',
    // Configure staticAssets for production (see cli/build-assets.ts)
  });

  console.log('Starting GoatDB development server...');
  await server.start();
  console.log(`Development server running at http://localhost:${server.port}`);
}

if (getRuntime().isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    getRuntime().exit(1);
  });
}
