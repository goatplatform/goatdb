/**
 * Cross-platform path utilities.
 *
 * This module reimplements path functions from @std/path to provide
 * consistent behavior across Deno, Node.js, and Browser environments.
 * The standard library's path module has runtime-specific behavior that
 * doesn't translate well to browser contexts or bundled code.
 *
 * All paths use POSIX-style forward slashes for consistency.
 */

import { isDeno, isNode } from './common.ts';
import { notReached } from './error.ts';

/**
 * Converts backslashes to forward slashes for consistent POSIX-style paths.
 * This enables Windows paths from Deno.cwd()/process.cwd() to work correctly.
 */
function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Normalizes a path by resolving `.` and `..` segments and collapsing
 * multiple slashes.
 *
 * @param p The path to normalize
 * @returns The normalized path
 */
export function normalize(p: string): string {
  if (!p) return '.';
  p = normalizeSlashes(p);

  const isAbs = p[0] === '/';
  const segments = p.split('/').filter(Boolean);
  const result: string[] = [];

  for (const seg of segments) {
    if (seg === '..') {
      if (result.length && result[result.length - 1] !== '..') {
        result.pop();
      } else if (!isAbs) {
        result.push('..');
      }
    } else if (seg !== '.') {
      result.push(seg);
    }
  }

  let normalized = result.join('/');
  if (isAbs) normalized = '/' + normalized;
  return normalized || '.';
}

/**
 * Returns the directory portion of a path.
 *
 * @param p The path
 * @returns The directory portion
 */
export function dirname(p: string): string {
  if (!p) return '.';
  p = normalizeSlashes(p);
  // Remove trailing slash for consistency
  if (p.length > 1 && p[p.length - 1] === '/') {
    p = p.slice(0, -1);
  }
  const lastSlash = p.lastIndexOf('/');
  if (lastSlash === -1) return '.';
  if (lastSlash === 0) return '/';
  return p.slice(0, lastSlash);
}

/**
 * Returns the filename portion of a path.
 *
 * @param p The path
 * @param ext Optional extension to strip
 * @returns The filename portion
 */
export function basename(p: string, ext?: string): string {
  if (!p) return '';
  p = normalizeSlashes(p);
  // Remove trailing slash for consistency
  if (p.length > 1 && p[p.length - 1] === '/') {
    p = p.slice(0, -1);
  }
  let base = p.slice(p.lastIndexOf('/') + 1);
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, -ext.length);
  }
  return base;
}

/**
 * Returns the extension of a path, including the leading dot.
 * Returns an empty string if there is no extension.
 *
 * @param p The path
 * @returns The extension including the leading dot, or empty string
 */
export function extname(p: string): string {
  if (!p) return '';
  p = normalizeSlashes(p);
  // Remove trailing slash for consistency
  if (p.length > 1 && p[p.length - 1] === '/') {
    p = p.slice(0, -1);
  }
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return base.slice(dotIndex);
}

/**
 * Joins path segments into a single normalized path.
 *
 * @param paths The path segments to join
 * @returns The joined path
 */
export function join(...paths: string[]): string {
  return normalize(paths.filter(Boolean).join('/'));
}

/**
 * Checks if a path is absolute.
 *
 * @param p The path to check
 * @returns True if the path is absolute
 */
export function isAbsolute(p: string): boolean {
  if (p.length === 0) return false;
  p = normalizeSlashes(p);
  if (p[0] === '/') return true;
  // Handle Windows drive letters (e.g., "C:/...")
  return /^[a-zA-Z]:\//.test(p);
}

/**
 * Resolves a sequence of paths to an absolute path.
 *
 * @param paths The paths to resolve
 * @returns The resolved absolute path
 */
export function resolve(...paths: string[]): string {
  let resolvedPath = '';

  for (let i = paths.length - 1; i >= 0 && !isAbsolute(resolvedPath); i--) {
    const path = paths[i];
    if (path) {
      resolvedPath = resolvedPath ? path + '/' + resolvedPath : path;
    }
  }

  // If still not absolute, prepend cwd (only in server environments)
  if (!isAbsolute(resolvedPath)) {
    if (isDeno()) {
      resolvedPath = Deno.cwd() + '/' + resolvedPath;
    } else if (isNode()) {
      resolvedPath = process.cwd() + '/' + resolvedPath;
    }
    // Browser: no cwd available, keep path relative
  }

  return normalize(resolvedPath);
}

/**
 * Converts a relative path to an absolute path.
 * Only works in Deno and Node.js environments.
 *
 * @param p The path to convert
 * @returns The absolute path
 */
export function toAbsolutePath(p: string): string {
  if (isAbsolute(p)) {
    return p;
  }
  if (isDeno()) {
    return join(Deno.cwd(), p);
  } else if (isNode()) {
    return join(process.cwd(), p);
  }
  // Browser: treat as relative to root (consistent with resolve())
  return '/' + p;
}

/**
 * Converts a file:// URL to a filesystem path.
 * Only works in Deno and Node.js environments.
 *
 * @param url The file URL to convert
 * @returns The filesystem path
 */
export function fromFileUrl(url: string | URL): string {
  if (!isDeno() && !isNode()) {
    notReached('fromFileUrl is not supported in browser');
  }
  const urlObj = url instanceof URL ? url : new URL(url);
  if (urlObj.protocol !== 'file:') {
    throw new TypeError('Must be a file URL');
  }
  let path = decodeURIComponent(urlObj.pathname);
  // Windows: file:///C:/path -> C:/path
  if (/^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  return path;
}
