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
 * Retrieves the value of an environment variable in a cross-runtime way.
 *
 * **Deno / Node.js**: reads directly from the process environment.
 *
 * **Browser**: browsers have no native environment variables. GoatDB proxies
 * `GOATDB_*` variables through the `GoatDBConfig` global that the server
 * injects into the JS bundle. The `GOATDB_` prefix is stripped and the
 * remainder is lowercased to form the lookup key
 * (e.g. `GOATDB_SUITE` → `GoatDBConfig.suite`).
 * Keys that do not start with `GOATDB_` always return `undefined` in the
 * browser — call this function from server-side code (Deno or Node.js) for
 * non-`GOATDB_*` keys.
 *
 * @param key The environment variable name (e.g., `"GOATDB_SUITE"`).
 * @returns The value of the variable, or `undefined` if not set.
 * @group OS
 */
export function getEnvVar(key: string): string | undefined {
  if (isDeno()) {
    return Deno.env.get(key);
  } else if (isNode()) {
    return globalThis.process.env?.[key];
  } else if (isBrowser()) {
    // Browsers have no environment variables. GOATDB_* vars are proxied
    // through the GoatDBConfig global injected by the server (prefix stripped).
    if (!key.startsWith('GOATDB_')) return undefined;
    const config = (globalThis as any).GoatDBConfig;
    return config?.[key.slice(7).toLowerCase()];
  }
  notReached('Platform not supported');
}
