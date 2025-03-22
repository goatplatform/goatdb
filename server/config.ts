import { isBrowser } from '../base/common.ts';
import { assert } from '../base/error.ts';
import { VCurrent, type VersionNumber } from '../base/version-number.ts';

export interface GoatConfig {
  version: VersionNumber;
  debug: boolean;
  orgId: string;
  clientData?: unknown;
  serverURL?: string;
  serverData?: unknown;
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
    assert(!isBrowser() || config !== undefined, 'GoatDBConfig not found');
    config = config || {
      version: VCurrent,
      debug: false,
      orgId: 'localhost',
    };
    GoatDBConfig = config;
  }
  return config;
}

export function getClientData<T>(): T | undefined {
  return getGoatConfig().clientData as T;
}

export function setClientData<T>(data: T | undefined): void {
  getGoatConfig().clientData = data;
}
