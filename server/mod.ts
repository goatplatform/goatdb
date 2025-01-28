import { jsonLogWorkerMain } from '../base/json-log/json-log-worker.ts';
import {
  compile,
  type CompileOptions,
  type CPUArch,
  type ExecutableOptions,
  type TargetOS,
} from '../cli/compile.ts';
import { Server } from '../net/server/server.ts';
import { staticAssetsFromJS } from '../net/server/static-assets.ts';
import type { AppConfig } from './app-config.ts';
import {
  type DebugServerOptions,
  type LiveReloadOptions,
  startDebugServer,
} from './debug-server.ts';

export type {
  AppConfig,
  CompileOptions,
  CPUArch,
  DebugServerOptions,
  ExecutableOptions,
  LiveReloadOptions,
  TargetOS,
};
export {
  compile,
  jsonLogWorkerMain,
  Server,
  startDebugServer,
  staticAssetsFromJS,
};
