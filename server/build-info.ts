import type { JSONObject } from '../base/interfaces.ts';
import { isDeno, isNode } from '../base/common.ts';
import { cli } from '../base/development.ts';
import { readTextFile } from '../base/json-log/file-impl.ts';
import { isWindows } from '../base/os.ts';

/**
 * Information about the runtime environment where the build was performed.
 */
export type BuilderInfo = {
  /** The JavaScript runtime used for building ('deno', 'node', or 'unknown') */
  runtime: 'deno' | 'node' | 'unknown';
  /** The operating system platform (e.g. 'darwin', 'linux', 'win32') */
  platform: string | null;
  /** The CPU architecture (e.g. 'x64', 'arm64') */
  arch: string | null;
  /** The OS release/version string */
  release: string | null;
  /** Node.js version if running in Node.js environment */
  nodeVersion: string | null;
  /** Deno version if running in Deno environment */
  denoVersion: string | null;
  /** V8 JavaScript engine version */
  v8Version: string | null;
  /** TypeScript version used for compilation */
  tsVersion: string | null;
  /** Additional version information as key-value pairs */
  versions: Record<string, string> | null;
};

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
  builder: BuilderInfo;
  /**
   * Application version, if available. Taken from the "version" field of the
   * project's deno.json.
   */
  appVersion?: string;
  /**
   * If true, indicates this is a debug build which turns off optimizations and
   * turns on a debugging aids.
   */
  debugBuild?: boolean;
}

function getBuilderInfo(): BuilderInfo {
  if (isDeno()) {
    return {
      runtime: 'deno',
      platform: Deno.build.os,
      arch: Deno.build.arch,
      release: Deno.build.vendor,
      nodeVersion: null,
      denoVersion: Deno.version.deno,
      v8Version: Deno.version.v8,
      tsVersion: Deno.version.typescript,
      versions: null,
    };
  } else if (isNode()) {
    const os = require('node:os');
    const process = require('node:process');
    return {
      runtime: 'node',
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      nodeVersion: process.version,
      denoVersion: null,
      v8Version: process.versions.v8 || null,
      tsVersion: process.versions.typescript || null,
      versions: { ...process.versions },
    };
  }
  return {
    runtime: 'unknown',
    platform: null,
    arch: null,
    release: null,
    nodeVersion: null,
    denoVersion: null,
    v8Version: null,
    tsVersion: null,
    versions: null,
  };
}

async function getCurrentUsername(): Promise<string> {
  if (isDeno()) {
    if (isWindows()) {
      const username = Deno.env.get('USERNAME');
      if (username) return username;
    } else {
      const username = Deno.env.get('USER') || Deno.env.get('LOGNAME');
      if (username) return username;
    }
    const { result, exitCode } = await cli('whoami');
    return exitCode === 0 ? result.trim() : 'unknown';
  } else if (isNode()) {
    try {
      const os = require('node:os');
      const username = os.userInfo().username;
      if (username) return username;
    } catch {
      // ignore and try env vars
    }
    const process = require('node:process');
    if (isWindows()) {
      const username = process.env.USERNAME;
      if (username) return username;
    } else {
      const username = process.env.USER || process.env.LOGNAME;
      if (username) return username;
    }
    const { result, exitCode } = await cli('whoami');
    return exitCode === 0 ? result.trim() : 'unknown';
  }
  return 'unknown';
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
  info.createdBy = await getCurrentUsername();
  // Builder
  info.builder = getBuilderInfo();
  // App version
  const denoJson = JSON.parse((await readTextFile(denoJsonPath)) || '{}');
  if (typeof denoJson.version === 'string') {
    info.appVersion = denoJson.version;
  }
  return info as BuildInfo;
}
