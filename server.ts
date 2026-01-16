/**
 * GoatDB Server Module
 *
 * Server-side exports for running GoatDB in server environments (Deno, Node.js).
 * These exports are NOT browser-safe and should only be used in server contexts.
 *
 * @module GoatDB/Server
 *
 * @example
 * ```typescript
 * import { Server, compile, startDebugServer } from '@goatdb/goatdb/server';
 * ```
 */

// Server class and types
export { Server } from './net/server/server.ts';
export type {
  ServerOptions,
  ServerServices,
  Endpoint,
  Middleware,
  DomainConfig,
  AutoCreateUserInfo,
} from './net/server/server.ts';

// HTTP compatibility layer
export { createHttpServer } from './net/server/http-compat.ts';
export type {
  GoatRequest,
  GoatHeaders,
  ServeHandlerInfo,
  HttpServerInstance,
  HttpServerOptions,
} from './net/server/http-compat.ts';

// Debug server (development)
export {
  startDebugServer,
  type DebugServerOptions,
  type LiveReloadOptions,
} from './cli/debug-server.ts';

// Build/compile tools
export {
  compile,
  type CompileOptions,
  type ExecutableOptions,
  type TargetOS,
  type CPUArch,
  type OSArchTarget,
} from './cli/compile.ts';

// Static assets
export {
  staticAssetsFromJS,
  staticAssetsToJS,
} from './system-assets/system-assets.ts';
export type {
  StaticAssets,
  Asset,
  ContentType,
} from './system-assets/system-assets.ts';

// App configuration
export type { AppConfig } from './cli/app-config.ts';

// Build info
export type { BuildInfo } from './base/build-info.ts';
