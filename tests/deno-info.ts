/** Normalize graph paths without expanding Windows 8.3 aliases. */
import * as path from '../base/path.ts';
import { assertTrue } from './asserts.ts';

export interface DenoInfo {
  roots: string[];
  modules: Array<{
    specifier: string;
    npmPackage?: string;
    local?: path.PosixPath;
  }>;
  npmPackages: Record<string, { name: string; version: string }>;
}

type NativeDenoInfo = Omit<DenoInfo, 'modules'> & {
  modules: Array<
    Omit<DenoInfo['modules'][number], 'local'> & { local?: string }
  >;
};

/** Deno emits native PathBuf values; parse them once at ingress. */
export function parseDenoInfo(text: string): DenoInfo {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`deno info produced no JSON:\n${text}`);
  }
  const raw = JSON.parse(text.slice(start, end + 1)) as NativeDenoInfo;
  return {
    ...raw,
    modules: raw.modules.map((module) => ({
      ...module,
      local: module.local === undefined
        ? undefined
        : path.parsePath(module.local),
    })),
  };
}

/** Graph roots and locals share cwd spelling; realPath may expand aliases. */
export function denoInfoProjectRoot(
  info: DenoInfo,
  entry: string,
): path.PosixPath {
  const entryPath = path.fromFileUrl(info.roots[0]);
  const suffix = `/${path.parsePath(entry)}`;
  assertTrue(
    entryPath.endsWith(suffix),
    `Graph root ${entryPath} must end with ${suffix}`,
  );
  return path.parsePath(entryPath.slice(0, -suffix.length));
}
