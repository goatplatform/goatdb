import path from 'node:path';
import type { JSONObject } from '../base/interfaces.ts';

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
  logWorkerPath: string;
}

export async function generateBuildInfo(
  denoJsonPath: string,
  buildDir: string,
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
  info.logWorkerPath = path.join(buildDir, 'file-worker.ts');
  return info as BuildInfo;
}
