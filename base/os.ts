import { isBrowser, isDeno, isNode } from './common.ts';
import { notReached } from './error.ts';
import { getRuntime } from './runtime/index.ts';

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
  | 'openbsd'
  | 'aix'
  | 'solaris'
  | 'illumos'
  | 'unknown';

/**
 * Normalizes a Node.js `os.platform()` string to a GoatDB OperatingSystem.
 * @group OS
 */
export function normalizeNodePlatform(platform: string): OperatingSystem {
  if (platform === 'win32') return 'windows';
  if (platform === 'sunos') return 'solaris';
  const known: OperatingSystem[] = [
    'darwin',
    'linux',
    'android',
    'freebsd',
    'netbsd',
    'openbsd',
    'aix',
    'illumos',
  ];
  return known.includes(platform as OperatingSystem)
    ? (platform as OperatingSystem)
    : 'unknown';
}

export function getOS(): OperatingSystem {
  return getRuntime().getOS();
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
