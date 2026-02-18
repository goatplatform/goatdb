/**
 * GoatDB Build Tools Module
 *
 * Build-time exports for compiling GoatDB applications.
 * These exports require esbuild and should NOT be imported in runtime code.
 *
 * @module GoatDB/Server/Build
 */

export {
  type DebugServerOptions,
  type LiveReloadOptions,
  startDebugServer,
} from './cli/debug-server.ts';

export {
  compile,
  type CompileOptions,
  type CPUArch,
  type ExecutableOptions,
  type OSArchTarget,
  type SigningOptions,
  type TargetOS,
} from './cli/compile.ts';

export type { AppConfig } from './cli/app-config.ts';
