import { Server } from '../net/server/server.ts';
import { staticAssetsFromJS } from '../net/server/static-assets.ts';
import {
  type DebugServerOptions,
  type LiveReloadOptions,
  startDebugServer,
} from './debug-server.ts';

export type { LiveReloadOptions, DebugServerOptions };
export { startDebugServer, Server, staticAssetsFromJS };
