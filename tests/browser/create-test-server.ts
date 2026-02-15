/**
 * Shared helper for creating test/benchmark debug servers.
 * Reduces duplication between test and benchmark server entries.
 *
 * @module GoatDB/TestServer
 */
import { Server } from '../../net/server/server.ts';
import type { StaticAssets } from '../../system-assets/system-assets.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import { isDeno } from '../../base/common.ts';
import { normalizeNodePlatform } from '../../base/os.ts';

/**
 * Options for creating a test server.
 */
export interface TestServerOptions {
  /** Path to the data directory */
  path: string;
  /** Server port */
  port: number;
  /** Organization ID */
  orgId: string;
  /** Pre-built static assets */
  staticAssets: StaticAssets;
  /** Custom configuration passed to the server */
  customConfig?: Record<string, unknown>;
  /** Creator name for build info (e.g., 'test', 'benchmark') */
  createdBy: string;
  /** App version string */
  appVersion: string;
  /** App name for display */
  appName: string;
}

export interface TestServerResult {
  server: Server<Schema>;
  /** Update the port used by resolveOrg after server.start() resolves the actual port. */
  setPort: (port: number) => void;
}

/**
 * Creates a test/benchmark server with standard configuration.
 *
 * @param options Server configuration options
 * @returns A configured Server instance (not started) and a port setter
 */
export function createTestServer(options: TestServerOptions): TestServerResult {
  const buildInfo = {
    creationDate: new Date().toISOString(),
    createdBy: options.createdBy,
    builder: isDeno()
      ? { ...Deno.build, runtime: 'deno' as const, env: Deno.build.env ?? null }
      : {
        runtime: 'node' as const,
        target: `${process.arch}-${process.platform}`,
        arch: process.arch,
        os: normalizeNodePlatform(process.platform),
        vendor: 'unknown',
        env: null,
      },
    appVersion: options.appVersion,
    debugBuild: true,
    appName: options.appName,
  };

  let actualPort = options.port;
  const domain = {
    resolveDomain: () => options.orgId,
    resolveOrg: (orgId: string) => `https://localhost:${actualPort}/${orgId}`,
  };

  const server = new Server({
    path: options.path,
    port: options.port,
    orgId: options.orgId,
    buildInfo,
    domain,
    staticAssets: options.staticAssets,
    https: { selfSigned: true },
    customConfig: options.customConfig,
  });

  return {
    server,
    setPort: (p: number) => {
      actualPort = p;
    },
  };
}
