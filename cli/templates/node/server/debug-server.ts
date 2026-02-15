// Development server with hot reload
import { normalizeNodePlatform, Server } from '@goatdb/goatdb/server';
import { registerSchemas } from '../common/schema.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  registerSchemas();

  // Create minimal build info for development
  const buildInfo = {
    creationDate: new Date().toISOString(),
    createdBy: 'dev',
    builder: {
      runtime: 'node' as const,
      target: `${process.arch}-${process.platform}`,
      arch: process.arch,
      os: normalizeNodePlatform(process.platform),
      vendor: 'unknown',
      env: null,
    },
    appVersion: '0.0.1-dev',
    debugBuild: true,
    appName: 'GoatDB Development Server',
  };

  const PORT = 8080;

  // Create development domain config
  const domain = {
    resolveOrg: () => `http://localhost:${PORT}`,
    resolveDomain: () => 'dev-org',
  };

  // Create development server
  const server = new Server({
    path: 'server-data',
    buildInfo,
    domain,
    port: PORT,
    orgId: 'dev-org',
    // Configure staticAssets for production (see cli/build-assets.ts)
  });

  console.log('Starting GoatDB development server...');
  await server.start();
  console.log(`Development server running at http://localhost:${server.port}`);
}

// Node.js ESM main detection (cross-platform)
if (
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch(console.error);
}
