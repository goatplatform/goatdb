/**
 * Embedded, distributed document database with real-time sync and automatic
 * conflict resolution. Provides the core GoatDB class, schema definitions,
 * queries, and item management.
 *
 * See https://goatdb.dev for guides and tutorials.
 *
 * @module GoatDB
 */
import { GoatDB } from './db/db.ts';
import { Query } from './repo/query.ts';
import type { AppConfig } from './cli/app-config.ts';
import {
  type AuthConfig,
  type AuthOp,
  type AuthRule,
  type AuthRuleInfo,
  DataRegistry,
} from './cfds/base/data-registry.ts';
import {
  itemPath,
  itemPathGetPart,
  itemPathGetRepoId,
  itemPathIsValid,
  itemPathJoin,
  itemPathNormalize,
} from './db/path.ts';
import { Repository } from './repo/repo.ts';
import { ManagedItem } from './db/managed-item.ts';
import { Item } from './cfds/base/item.ts';
import { prettyJSON, uniqueId } from './base/common.ts';
import { ConsoleLogStream } from './logging/console-stream.ts';
import type { LogStream } from './logging/log.ts';
import { JSONLogStream } from './logging/json-log-stream.ts';
import { getEnvVar } from './base/os.ts';
import { normalizeEmail } from './base/string.ts';
import { Emitter } from './base/emitter.ts';
import { TrustPool } from './db/session.ts';
import type { BuildInfo } from './base/build-info.ts';

export * from './cfds/base/schema.ts';
export * from './base/core-types/base.ts';

export * as Orderstamp from '@goatdb/orderstamp';

export type {
  AppConfig,
  AuthConfig,
  AuthOp,
  AuthRule,
  AuthRuleInfo,
  BuildInfo,
  LogStream,
};
export type { DBInstanceConfig } from './db/db.ts';
export type { QueryConfig } from './repo/query.ts';
export type { ReadonlyItem } from './cfds/base/item.ts';
export type { JSONObject, ReadonlyJSONObject } from './base/interfaces.ts';
export {
  ConsoleLogStream,
  DataRegistry,
  Emitter,
  getEnvVar,
  GoatDB,
  Item,
  itemPath,
  itemPathGetPart,
  itemPathGetRepoId,
  itemPathIsValid,
  itemPathJoin,
  itemPathNormalize,
  JSONLogStream,
  ManagedItem,
  normalizeEmail,
  prettyJSON,
  Query,
  Repository,
  TrustPool,
  uniqueId,
};
