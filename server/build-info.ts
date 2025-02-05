import * as path from '@std/path';
import type { JSONObject } from '../base/interfaces.ts';
import { notReached } from '../base/error.ts';

/**
 * This interface encodes details about the build process used when compiling
 * the app bundle. Used for internal configuration and later inspection.
 */
export interface BuildInfo extends JSONObject {
  /**
   * When was the binary created.
   */
  creationDate: string;
  /**
   * The username that created the binary.
   */
  createdBy: string;
  /**
   * Info about the builder runtime.
   */
  builder: typeof Deno.build;
  /**
   * Application version, if available. Taken from the "version" field of the
   * project's deno.json.
   */
  appVersion?: string;
  /**
   * Application name. Extracted from the "name" field of the project's
   * deno.json.
   */
  appName?: string;
  /**
   * Tells the server where the json-log-worker file was embedded.
   */
  jsonLogWorkerPath: string;
  /**
   * If true, indicates this is a debug build which turns off optimizations and
   * turns on a debugging aids.
   */
  debugBuild?: boolean;
}

export async function generateBuildInfo(
  denoJsonPath: string,
): Promise<BuildInfo> {
  const info: Partial<BuildInfo> = {};
  // Creation date
  info.creationDate = new Date().toISOString();
  // Created by
  if (Deno.build.os === 'windows') {
    // TODO: Windows support
    info.createdBy = 'unknown';
  } else {
    info.createdBy = new TextDecoder()
      .decode(
        new Deno.Command('whoami', {
          stdout: 'piped',
        }).outputSync().stdout,
      )
      .trim();
  }
  // Builder
  info.builder = Deno.build;
  // App version
  const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath));
  if (typeof denoJson.version === 'string') {
    info.appVersion = denoJson.version;
  }
  if (typeof denoJson.name === 'string') {
    info.appName = denoJson.name;
  } else {
    info.appName = path.basename(path.dirname(denoJsonPath));
  }
  // Worker path
  info.jsonLogWorkerPath = await getDependencyURL(denoJsonPath) +
    'base/json-log/json-log-worker-entry.ts';
  return info as BuildInfo;
}

export type DenoInfoModule = {
  kind: string;
  local: string;
  size: number;
  mediaType: string;
  specifier: string;
};

export type DenoInfoOutput = {
  version: number;
  roots: string[];
  modules: DenoInfoModule[];
};

export async function getDependencyURL(denoJson?: string): Promise<string> {
  const compileArgs = [
    'info',
    '--json',
    'jsr:@goatdb/goatdb',
  ];
  if (denoJson) {
    compileArgs.push(`--config=${denoJson}`);
  }
  const compileLocalCmd = new Deno.Command(Deno.execPath(), {
    args: compileArgs,
  });
  const output = await compileLocalCmd.output();
  const info: DenoInfoOutput = JSON.parse(
    new TextDecoder().decode(output.stdout),
  );
  const prefix = 'https://jsr.io/@goatdb/goatdb/';
  for (const module of info.modules) {
    if (module.specifier.startsWith(prefix)) {
      const suffix = module.specifier.substring(prefix.length);
      const nextComp = suffix.indexOf('/');
      if (nextComp > 0) {
        return module.specifier.substring(0, prefix.length + nextComp + 1);
      }
    }
  }
  notReached('jsr:@goatdb/goatdb not found');
}
