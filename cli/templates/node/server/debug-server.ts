// Development server with hot reload
import { Server } from "@goatdb/goatdb/server";
import { registerSchemas } from "../common/schema.js";

async function main(): Promise<void> {
  registerSchemas();

  // Create minimal build info for development
  const buildInfo = {
    creationDate: new Date().toISOString(),
    createdBy: "dev",
    builder: {
      target: `${process.arch}-${process.platform}`,
      arch: process.arch,
      os: process.platform,
      vendor: "unknown",
      env: undefined,
    },
    appVersion: "0.0.1-dev",
    debugBuild: true,
    appName: "GoatDB Development Server",
  };

  // Create development domain config
  const domain = {
    resolveOrg: () => "http://localhost:8080",
    resolveDomain: () => "dev-org",
  };

  // Create development server
  const server = new Server({
    path: "server-data",
    buildInfo,
    domain,
    port: 8080,
    orgId: "dev-org",
    // Configure staticAssets for production (see cli/build-assets.ts)
  });

  console.log('Starting GoatDB development server...');
  await server.start();
  console.log('Development server running at http://localhost:8080');
}

// Node.js ESM main detection
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}
