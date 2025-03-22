import { isDeno, isNode } from './common.ts';
import { notReached } from './error.ts';

/**
 * Exits the current process with the specified exit code.
 *
 * @param code The exit code (0 for success, non-zero for failure)
 * @returns Never returns
 * @throws Error if on an unsupported platform
 */
export async function exit(code: number): Promise<never> {
  if (isNode()) {
    const { exit } = await import('node:process');
    exit(code);
  } else if (isDeno()) {
    Deno.exit(code);
  }
  notReached('Platform not supported');
}
