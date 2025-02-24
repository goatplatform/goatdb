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

export function getGoatConfig(): GoatConfig {
  let config = (self as any).GoatConfig as GoatConfig | undefined;
  if (!config) {
    assert(!isBrowser() || config !== undefined, 'GoatConfig not found');
    config = config || {
      version: VCurrent,
      debug: false,
      orgId: 'localhost',
    };
    (self as any).GoatConfig = config;
  }
  return config;
}

export function getClientData<T>(): T | undefined {
  return getGoatConfig().clientData as T;
}

export function setClientData<T>(data: T | undefined): void {
  getGoatConfig().clientData = data;
}
