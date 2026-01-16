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

/**
 * Creates a test/benchmark server with standard configuration.
 *
 * @param options Server configuration options
 * @returns A configured Server instance (not started)
 */
export function createTestServer(options: TestServerOptions): Server<Schema> {
  const buildInfo = {
    creationDate: new Date().toISOString(),
    createdBy: options.createdBy,
    builder: isDeno()
      ? Deno.build
      : { arch: process.arch, os: process.platform },
    appVersion: options.appVersion,
    debugBuild: true,
    appName: options.appName,
  };

  const domain = {
    mapToOrg: () => options.orgId,
    resolveDomain: () => 'localhost',
    resolveOrg: (orgId: string) => `https://localhost:${options.port}/${orgId}`,
  };

  return new Server({
    path: options.path,
    port: options.port,
    orgId: options.orgId,
    buildInfo,
    domain,
    staticAssets: options.staticAssets,
    https: { selfSigned: true },
    customConfig: options.customConfig,
  });
}
