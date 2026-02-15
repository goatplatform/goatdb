import { isBrowser } from './common.ts';
import { assert } from './error.ts';
import { VCurrent, type VersionNumber } from './version-number.ts';

export interface GoatConfig {
  version: VersionNumber;
  debug: boolean;
  orgId: string;
  clientData?: unknown;
  serverURL?: string;
  serverData?: unknown;
  serverPort?: number;
}

// deno-lint-ignore no-var
// deno-lint-ignore no-unused-vars
var GoatDBConfig: GoatConfig | undefined = undefined;

type GlobalThis = typeof globalThis & {
  GoatDBConfig: GoatConfig | undefined;
};

export function getGoatConfig(): GoatConfig {
  let config = (globalThis as GlobalThis).GoatDBConfig as
    | GoatConfig
    | undefined;
  if (!config) {
    assert(!isBrowser(), 'GoatDBConfig not found');
    config = {
      version: VCurrent,
      debug: false,
      orgId: 'localhost',
    };
    (globalThis as GlobalThis).GoatDBConfig = config;
  }
  return config;
}

export function getClientData<T>(): T | undefined {
  return getGoatConfig().clientData as T;
}

export function setClientData<T>(data: T | undefined): void {
  getGoatConfig().clientData = data;
}
