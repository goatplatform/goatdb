/**
 * Reimplements @std/path for consistent Deno, Node, and browser bundles.
 * Path contract: canonical POSIX strings; separators normalize at ingress;
 * Windows roots compare case-insensitively; outputs are branded as
 * {@link PosixPath}; containment uses {@link isWithin} or {@link relative},
 * never string search (`/vendor/goatdb-other` is not inside `/vendor/goatdb`).
 */

import { isDeno, isNode } from './common.ts';

declare const posixPathBrand: unique symbol;

/**
 * A normalized POSIX-style path; use {@link isWithin} for containment.
 */
export type PosixPath = string & { readonly [posixPathBrand]: true };

/** Converts native backslashes to forward slashes at ingress. */
function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Splits a path into its root (`/`, `C:/`, `//host/share`) and remaining body.
 * Drive letters keep the caller's case; comparisons fold case separately.
 */
function splitRoot(p: string): { root: string; rest: string } {
  if (p.startsWith('//')) {
    const parts = p.slice(2).split('/');
    const [host, share] = parts;
    if (host && share) {
      return {
        root: `//${host}/${share}`,
        rest: parts.slice(2).join('/'),
      };
    }
    // Malformed UNC: fall back to a POSIX root so normalization stays total.
    return { root: '/', rest: p.slice(1) };
  }
  if (p[0] === '/') {
    return { root: '/', rest: p.slice(1) };
  }
  const drive = /^([A-Za-z]:)(?:\/|$)/.exec(p);
  if (drive) {
    return { root: `${drive[1]}/`, rest: p.slice(drive[0].length) };
  }
  return { root: '', rest: p };
}

/** True when the root belongs to Windows semantics (drive or UNC). */
function isWindowsRoot(root: string): boolean {
  return root.startsWith('//') || /^[A-Za-z]:\//.test(root);
}

function rootsEqual(a: string, b: string): boolean {
  if (isWindowsRoot(a) || isWindowsRoot(b)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function segments(path: string): string[] {
  return path.split('/').filter((segment) => segment && segment !== '.');
}

/** Joins root and body; UNC roots omit the separator, so plain concat breaks. */
function joinRoot(root: string, body: string): string {
  if (!root) return body;
  if (!body) return root;
  return root.endsWith('/') ? root + body : `${root}/${body}`;
}

/** Parses raw onto the canonical form; call at every ingress boundary. */
export function parsePath(raw: string): PosixPath {
  return normalize(raw);
}

/** Normalizes separators and resolves `.` and `..` segments. */
export function normalize(p: string): PosixPath {
  if (!p) return '.' as PosixPath;
  const { root, rest } = splitRoot(normalizeSlashes(p));
  const result: string[] = [];

  for (const seg of segments(rest)) {
    if (seg === '..') {
      if (result.length && result[result.length - 1] !== '..') {
        result.pop();
      } else if (!root) {
        result.push('..');
      }
    } else {
      result.push(seg);
    }
  }

  const body = result.join('/');
  return (joinRoot(root, body) || '.') as PosixPath;
}

/** Returns the directory portion of a path. */
export function dirname(p: string): PosixPath {
  const normalized = normalize(p);
  const { root, rest } = splitRoot(normalized);
  const lastSlash = rest.lastIndexOf('/');
  if (lastSlash === -1) return (root || '.') as PosixPath;
  return joinRoot(root, rest.slice(0, lastSlash)) as PosixPath;
}

/** Returns the filename portion, optionally stripping `ext`. */
export function basename(p: string, ext?: string): string {
  if (!p) return '';
  const normalized = normalize(p);
  let base = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, -ext.length);
  }
  return base;
}

/** Returns the extension including its dot, or an empty string. */
export function extname(p: string): string {
  if (!p) return '';
  const base = basename(p);
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return base.slice(dotIndex);
}

/** Joins segments into one normalized path. */
export function join(...paths: string[]): PosixPath {
  const [first = '', ...rest] = paths.filter(Boolean).map(normalizeSlashes);
  const { root, rest: body } = splitRoot(first);
  // Later parts are not roots: strip slashes so '/','a','b' is not UNC '//a/b'.
  const tail = rest.map((p) => p.replace(/^\/+/, ''));
  return normalize(joinRoot(root, [body, ...tail].filter(Boolean).join('/')));
}

/** True when the path is POSIX- or drive-absolute. */
export function isAbsolute(p: string): boolean {
  if (p.length === 0) return false;
  p = normalizeSlashes(p);
  if (p[0] === '/') return true;
  // Handle Windows drive letters (e.g., "C:/...")
  return /^[a-zA-Z]:\//.test(p);
}

/** True when the path names a filesystem root. */
export function isRoot(p: string): boolean {
  return isAbsolute(p) && !splitRoot(normalize(p)).rest;
}

/** True when the path is absolute and not a filesystem root. */
export function isAbsoluteNonRoot(p: string): boolean {
  return isAbsolute(p) && !isRoot(p);
}

/** The runtime cwd; browsers have none. */
function runtimeCwd(): string {
  return isDeno() ? Deno.cwd() : isNode() ? process.cwd() : '';
}

/** Resolves paths against each other and, on Deno/Node, the cwd. */
export function resolve(...paths: string[]): PosixPath {
  let resolvedPath = '';

  for (let i = paths.length - 1; i >= 0 && !isAbsolute(resolvedPath); i--) {
    const path = paths[i];
    if (path) resolvedPath = joinRoot(path, resolvedPath);
  }

  // Browsers have no cwd; leave the path relative there.
  if (!isAbsolute(resolvedPath)) {
    resolvedPath = joinRoot(runtimeCwd(), resolvedPath);
  }

  return normalize(resolvedPath);
}

/** Makes a path absolute; browsers resolve against their root. */
export function toAbsolutePath(p: string): PosixPath {
  if (isAbsolute(p)) return normalize(p);
  return join(runtimeCwd() || '/', p);
}

/**
 * Computes `to` relative to `from`. Different roots return normalized `to`
 * (Node behavior); an empty string means equality. Windows roots compare
 * case-insensitively.
 */
export function relative(from: string, to: string): PosixPath {
  const fromPath = normalize(from);
  const toPath = normalize(to);
  const fromRoot = splitRoot(fromPath);
  const toRoot = splitRoot(toPath);
  if (!rootsEqual(fromRoot.root, toRoot.root)) return toPath;

  const windows = isWindowsRoot(fromRoot.root);
  const fromSegs = segments(fromRoot.rest);
  const toSegs = segments(toRoot.rest);
  const same = (a: string, b: string) =>
    windows ? a.toLowerCase() === b.toLowerCase() : a === b;

  let common = 0;
  while (
    common < fromSegs.length && common < toSegs.length &&
    same(fromSegs[common], toSegs[common])
  ) {
    common++;
  }

  const result = [
    ...Array(fromSegs.length - common).fill('..'),
    ...toSegs.slice(common),
  ].join('/');
  return result as PosixPath;
}

/**
 * Compares two paths for equality by delegating to {@link relative}, so case
 * folding and root rules stay in one place.
 */
export function equals(a: string, b: string): boolean {
  return relative(a, b) === '';
}

/** Checks whether `child` equals or descends from `parent` by path segment. */
export function isWithin(parent: string, child: string): boolean {
  const root = (p: string) => splitRoot(normalize(p)).root;
  if (!rootsEqual(root(parent), root(child))) return false;
  const rel = relative(parent, child);
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
}

/** Converts an absolute path to a file URL, preserving UNC authorities. */
export function toFileUrl(p: string): string {
  p = normalizeSlashes(p);
  if (!p.startsWith('/') && !/^[A-Za-z]:/.test(p)) {
    throw new TypeError(`toFileUrl requires an absolute path, got: "${p}"`);
  }
  if (p.startsWith('//')) {
    const [host, ...segments] = p.slice(2).split('/');
    return `file://${host}/${fileUrlPath(segments)}`;
  }
  if (!p.startsWith('/')) {
    p = '/' + p;
  }
  return 'file://' + fileUrlPath(p.split('/'));
}

function fileUrlPath(segments: string[]): string {
  return segments.map(encodeURIComponent).join('/').replaceAll('%3A', ':');
}

/** Parses file URLs on all runtimes without filesystem access; preserves UNC. */
export function fromFileUrl(url: string | URL): PosixPath {
  const urlObj = url instanceof URL ? url : new URL(url);
  if (urlObj.protocol !== 'file:') {
    throw new TypeError('Must be a file URL');
  }
  let path = decodeURIComponent(urlObj.pathname);
  if (urlObj.host) {
    path = `//${urlObj.host}${path}`;
  } else if (/^\/[A-Za-z]:/.test(path)) {
    // Windows: file:///C:/path -> C:/path
    path = path.slice(1);
  }
  return parsePath(path);
}
