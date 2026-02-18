/**
 * GoatDB Server Module
 *
 * Runtime exports for running GoatDB in server environments (Deno, Node.js).
 * These exports are NOT browser-safe and should only be used in server contexts.
 *
 * For build-time tools (compile, startDebugServer), use '@goatdb/goatdb/server/build'.
 *
 * @module GoatDB/Server
 *
 * @example
 * ```typescript
 * import { Server, staticAssetsFromJS } from '@goatdb/goatdb/server';
 * ```
 */

export { Server } from './net/server/server.ts';
export type {
  AutoCreateUserInfo,
  DomainConfig,
  Endpoint,
  Middleware,
  ServerOptions,
  ServerServices,
} from './net/server/server.ts';

export { createHttpServer } from './net/server/http-compat.ts';
export type {
  GoatHeaders,
  GoatRequest,
  HttpServerInstance,
  HttpServerOptions,
  ServeHandlerInfo,
} from './net/server/http-compat.ts';

export {
  staticAssetsFromJS,
  staticAssetsToJS,
} from './system-assets/system-assets.ts';
export type {
  Asset,
  ContentType,
  StaticAssets,
} from './system-assets/system-assets.ts';

export type { BuildInfo } from './base/build-info.ts';

export { normalizeNodePlatform } from './base/os.ts';
