import * as path from 'std/path';

export function toAbsolutePath(p: string): string {
  if (path.isAbsolute(p)) {
    return p;
  }
  return path.join(Deno.cwd(), p);
}
