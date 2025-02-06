import { Repository } from '../repo/repo.ts';

/**
 * The type of a repository creates an internal hierarchy within the repository.
 * It enables grouping of related repositories for easier management.
 * Common repository types: "sys", "user", "data", "events".
 */
export type RepoType = string;

/**
 * The different components that make up a DB path.
 */
export const kItemPathParts = ['type', 'repo', 'item', 'embed'] as const;

/**
 * A specific component within a DB path.
 */
export type ItemPathPart = (typeof kItemPathParts)[number];

/**
 * Given the path parts, composes them into a GoatDB path.
 * @param type Type of the repository, e.g "sys" / "user" / "data".
 * @param repo The id of the repository.
 * @param item The key of the item within the repository.
 * @param embed An optional embedded item within the main item.
 * @returns A full GoatDB path.
 */
export function itemPath<T extends RepoType>(
  type: T,
  repo: string,
  item: string,
  embed?: string,
): string {
  return `/${type}/${repo}/${item}${embed ? '/' + embed : ''}`;
}

export function itemPathGetPart<T extends string>(
  path: string,
  part: ItemPathPart,
): T;

export function itemPathGetPart<T extends string>(
  path: undefined,
  part: ItemPathPart,
): undefined;

export function itemPathGetPart<T extends string>(
  path: string | undefined,
  part: ItemPathPart,
): T | undefined;

/**
 * Given a DB path and a path component, this function returns the relevant
 * portion of the path.
 *
 * @param path The full DB path.
 * @param part The desired part to extract.
 * @returns The requested part or undefined if it doesn't exist in the given
 *          path.
 */
export function itemPathGetPart<T extends string>(
  path: string | undefined,
  part: ItemPathPart,
): T | undefined {
  if (!path) {
    return undefined;
  }
  let start = 0;
  if (path[start] === '/') {
    ++start;
  }
  for (let i = 0; i < kItemPathParts.indexOf(part); ++i) {
    while (start < path.length && path[start] !== '/') {
      ++start;
    }
    // Component not found, path is too short
    if (start >= path.length) {
      return undefined;
    }
    if (path[start] === '/') {
      ++start;
    }
  }
  if (path[start] === '/') {
    ++start;
  }
  let end = start + 1;
  while (end < path.length && path[end] !== '/') {
    ++end;
  }
  return path.substring(start, end) as T;
}

/**
 * Given a DB path, return just the repository prefix of it.
 *
 * @param path The full DB path.
 * @returns Path to the repository of the given path.
 */
export function itemPathGetRepoId(path: string): string {
  return Repository.path(
    itemPathGetPart(path, 'type'),
    itemPathGetPart(path, 'repo'),
  );
}

/**
 * Normalizes the given path ensuring it has the correct number of parts
 * and no trailing separator.
 * @param path The path to normalize.
 * @returns A normalized path.
 */
export function itemPathNormalize(path: string): string {
  let valid = true;
  if (path[0] === '/' && path[path.length - 1] !== '/') {
    let prevSep = -1;
    for (let i = 0; i < path.length; ++i) {
      if (path[i] === '/') {
        if (i - prevSep <= 0) {
          valid = false;
          break;
        }
        prevSep = i;
      }
    }
  }
  if (valid) {
    return path;
  }
  return itemPath(
    itemPathGetPart(path, 'type'),
    itemPathGetPart(path, 'repo'),
    itemPathGetPart(path, 'item'),
    itemPathGetPart(path, 'embed'),
  );
}

/**
 * Joins the given prefix and suffix into a single path.
 * @param prefix Path prefix.
 * @param suffix Path suffix.
 * @returns A single path.
 */
export function itemPathJoin(prefix: string, suffix: string): string {
  if (prefix.endsWith('/')) {
    prefix = prefix.substring(0, prefix.length - 1);
  }
  if (suffix[0] === '/') {
    suffix = suffix.substring(1);
  }
  return `${prefix}/${suffix}`;
}
