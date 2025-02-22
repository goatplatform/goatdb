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
   * If true, indicates this is a debug build which turns off optimizations and
   * turns on a debugging aids.
   */
  debugBuild?: boolean;
}

/**
 * Generates build information for the current application.
 *
 * @param denoJsonPath Path to the deno.json configuration file
 * @returns A BuildInfo object containing details about the build
 */
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
  return info as BuildInfo;
}
