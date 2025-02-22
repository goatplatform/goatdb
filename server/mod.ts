/**
 * This module exposes APIs for controlling the GoatDB server. It includes
 * functions for running the interactive debug server and for compiling a
 * standalone server executable.
 *
 * Check out https://goatdb.dev for additional docs.
 *
 * @module GoatDB/Server
 */
import {
  compile,
  type CompileOptions,
  type CPUArch,
  type ExecutableOptions,
  type TargetOS,
} from '../cli/compile.ts';
import type { EmailBuilder, EmailInfo } from '../db/emails.ts';
import { Server } from '../net/server/server.ts';
import { staticAssetsFromJS } from '../system-assets/system-assets.ts';
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
  EmailBuilder,
  EmailInfo,
  ExecutableOptions,
  LiveReloadOptions,
  TargetOS,
};
export { compile, Server, startDebugServer, staticAssetsFromJS };
