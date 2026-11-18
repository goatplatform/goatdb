import { writeTextFile } from '../base/json-log/file-impl.ts';
import type { DBState, GoatDB } from '../db/db.ts';

export async function blockedDBPath(
  dir: string,
  name: string,
): Promise<string> {
  const dbPath = `${dir}/${name}`;
  if (!await writeTextFile(dbPath, 'x')) {
    throw new Error('Blocker write failed');
  }
  return dbPath;
}

export function waitForState(db: GoatDB, state: DBState): Promise<void> {
  if (db.state === state) return Promise.resolve();
  return new Promise((resolve) => {
    const detach = db.attach('LifecycleChanged', (next: DBState) => {
      if (next !== state) return;
      detach();
      resolve();
    });
  });
}

type Proc = {
  on(event: string, listener: (reason: unknown) => void): void;
  off(event: string, listener: (reason: unknown) => void): void;
};

/** Deno and Node expose the process rejection hook. */
export function trackUnhandledRejections() {
  const reasons: unknown[] = [];
  const listener = (reason: unknown) => reasons.push(reason);
  const proc = (globalThis as { process: Proc }).process;
  proc.on('unhandledRejection', listener);
  return { reasons, restore: () => proc.off('unhandledRejection', listener) };
}
