// Development server with hot reload
import { Server } from '@goatdb/goatdb/server';
import { registerSchemas } from '../common/schema.ts';

async function main(): Promise<void> {
  registerSchemas();

  // Create minimal build info for development
  const buildInfo = {
    creationDate: new Date().toISOString(),
    createdBy: 'dev',
    builder: {
      ...Deno.build,
      runtime: 'deno' as const,
      env: Deno.build.env ?? null,
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

if (import.meta.main) main().catch(console.error);
