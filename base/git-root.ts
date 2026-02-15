import * as path from './path.ts';
import { pathExists } from './json-log/file-impl.ts';

/** Build-time only. Uses `import.meta.url` (unavailable in browser). */
export async function getRepositoryPath(): Promise<string> {
  const MAX_DEPTH = 100;
  let depth = 0;
  let candidate = path.dirname(path.fromFileUrl(import.meta.url));
  while (!(await pathExists(path.join(candidate, '.git')))) {
    if (++depth > MAX_DEPTH) {
      throw new Error('Could not find repository root (.git directory)');
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error('Could not find repository root (.git directory)');
    }
    candidate = parent;
  }
  return candidate;
}
