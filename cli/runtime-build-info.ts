import * as path from '../base/path.ts';
import { type BuildInfo, generateBuildInfo } from '../base/build-info.ts';
import { pathExists } from '../base/json-log/file-impl.ts';

export type RuntimeConfigFileOptions = {
  denoJson?: string;
  packageJson?: string;
};

function runtimeConfigPath(
  runtime: 'deno' | 'node',
  cwd: string,
  options: RuntimeConfigFileOptions,
): string {
  return runtime === 'node'
    ? (options.packageJson || path.join(cwd, 'package.json'))
    : (options.denoJson || path.join(cwd, 'deno.json'));
}

export async function resolveRuntimeBuildInfo(
  runtime: 'deno' | 'node',
  cwd: string,
  options: RuntimeConfigFileOptions,
): Promise<BuildInfo> {
  const configPath = runtimeConfigPath(runtime, cwd, options);
  if (!await pathExists(configPath)) {
    throw new Error(
      `Config file not found at "${configPath}". Provide ${
        runtime === 'node' ? 'packageJson' : 'denoJson'
      } or run from a directory containing one.`,
    );
  }
  return await generateBuildInfo(configPath);
}
