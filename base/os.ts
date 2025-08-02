import { isBrowser, isDeno, isNode } from './common.ts';
import { notReached } from './error.ts';

/**
 * Represents the possible operating systems that can be detected.
 * Used by the `getOS()` function to identify the current platform.
 */
export type OperatingSystem =
  | 'darwin'
  | 'linux'
  | 'android'
  | 'windows'
  | 'freebsd'
  | 'netbsd'
  | 'aix'
  | 'solaris'
  | 'illumos';

/**
 * Returns the current operating system.
 *
 * Detects the OS in both Deno and Node.js environments.
 *
 * @returns The detected operating system
 * @throws If called in an unsupported runtime
 */
export function getOS(): OperatingSystem {
  if (isDeno()) {
    return Deno.build.os;
  } else if (isNode()) {
    const os = require('node:os');
    return os.platform();
  }
  notReached('Platform not supported');
}

/**
 * Checks if the current operating system is macOS.
 *
 * @returns true if macOS, false otherwise
 */
export function isMac(): boolean {
  return getOS() === 'darwin';
}

/**
 * Checks if the current operating system is Linux.
 *
 * @returns true if Linux, false otherwise
 */
export function isLinux(): boolean {
  return getOS() === 'linux';
}

/**
 * Checks if the current operating system is Windows.
 *
 * @returns true if Windows, false otherwise
 */
export function isWindows(): boolean {
  return getOS() === 'windows';
}

/**
 * Retrieves the value of an environment variable in a cross-platform way.
 *
 * @param key The environment variable name (e.g., "GOATDB_SUITE")
 * @returns The value of the environment variable, or undefined if not found.
 */
export function getEnvVar(key: string): string | undefined {
  if (isDeno()) {
    // Deno: Use Deno.env.get if available
    return Deno.env.get?.(key);
  } else if (isNode()) {
    // Node.js: Use process.env
    return globalThis.process.env?.[key];
  } else if (isBrowser()) {
    // Browser: Look for GoatDBConfig global object
    const config = (globalThis as any).GoatDBConfig;
    // Remove "GOATDB_" prefix and lowercase the key for browser config
    return config?.[key.toLowerCase().replace('goatdb_', '')];
  }
  notReached('Platform not supported');
}