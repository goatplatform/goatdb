/**
 * GoatDB Build Tools Module
 *
 * Build-time exports for compiling GoatDB applications.
 * These exports require esbuild and should NOT be imported in runtime code.
 *
 * @module GoatDB/Server/Build
 */

// Debug server (development)
export {
  type DebugServerOptions,
  type LiveReloadOptions,
  startDebugServer,
} from './cli/debug-server.ts';

// Build/compile tools
export {
  compile,
  type CompileOptions,
  type CPUArch,
  type ExecutableOptions,
  type OSArchTarget,
  type SigningOptions,
  type TargetOS,
} from './cli/compile.ts';

// App configuration
export type { AppConfig } from './cli/app-config.ts';
