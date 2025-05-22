import { isDeno, isNode } from './common.ts';
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
