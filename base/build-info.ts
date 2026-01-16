import { isDeno, isNode } from './common.ts';
import { cli } from './development.ts';
import { readTextFile } from './json-log/file-impl.ts';
import { isWindows } from './os.ts';
import type { JSONObject } from './interfaces.ts';

/**
 * Builder runtime information with discriminator field.
 * Provides consistent structure across Deno, Node.js, and Browser environments.
 */
export interface BuilderInfo extends JSONObject {
  /** Runtime that built the bundle: 'deno', 'node', or 'browser' */
  runtime: 'deno' | 'node' | 'browser';
  target: string;
  arch: string;
  os: string;
  vendor: string;
  env: string | null;
}

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
  /**
   * Application name, if available.
   */
  appName?: string;
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
      const os = await import('node:os');
      const username = os.userInfo().username;
      if (username) return username;
    } catch {
      // ignore and try env vars
    }
    const process = await import('node:process');
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
  // Builder info from current environment
  if (isDeno()) {
    info.builder = {
      runtime: 'deno',
      target: Deno.build.target,
      arch: Deno.build.arch,
      os: Deno.build.os,
      vendor: Deno.build.vendor,
      env: Deno.build.env ?? null,
    };
  } else if (isNode()) {
    info.builder = {
      runtime: 'node',
      target: `${process.platform}-${process.arch}`,
      arch: process.arch,
      os: process.platform,
      vendor: 'node',
      env: null,
    };
  } else {
    // Browser fallback
    info.builder = {
      runtime: 'browser',
      target: 'browser',
      arch: 'unknown',
      os: 'browser',
      vendor: 'browser',
      env: null,
    };
  }
  // App version
  const denoJson = JSON.parse((await readTextFile(denoJsonPath)) || '{}');
  if (typeof denoJson.version === 'string') {
    info.appVersion = denoJson.version;
  }
  return info as BuildInfo;
}