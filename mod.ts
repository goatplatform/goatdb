/**
 * GoatDB: An Embedded, Distributed, Document Database
 *
 * GoatDB is a real-time, version-controlled database for Deno, React, and
 * low-friction deployments. It excels at real-time collaboration and
 * embedded caching applications while prioritizing speed and developer
 * experience.
 *
 * Key Features:
 * - No Dedicated Infra: Run the entire DB client-side, with incremental queries
 * - Resilience & Offline-First: Clients keep working if server goes down
 * - Edge-Native: Most processing happens in the client
 * - Real-Time Collaboration: Built-in sync keeps state synchronized
 * - Distributed Version Control: Leverages concepts from DVCS with bloom
 *                                filter-based synchronization
 * - Automatic Conflict Resolution: Uses ephemeral CRDTs for efficient
 *                                  real-time conflict resolution
 * - Application-Level Sharding: Natural scalability for multi-user applications
 *
 * Check out https://goatdb.dev for additional docs.
 *
 * @module GoatDB
 *
 * @example
 * ```typescript
 * import { GoatDB, DataRegistry } from '@goatdb/goatdb';
 *
 * // Define a schema for tasks
 * const taskSchema = {
 *   ns: 'task',
 *   version: 1,
 *   fields: {
 *     text: {
 *       type: 'string',
 *       required: true,
 *     },
 *     done: {
 *       type: 'boolean',
 *       default: () => false,
 *     }
 *   }
 * } as const;
 *
 * // Register the schema
 * DataRegistry.default.registerSchema(taskSchema);
 *
 * // Initialize GoatDB with optional peers for replication
 * const db = new GoatDB({
 *   path: '/home/my-app',
 *   peers: ['http://10.0.0.1']
 * });
 *
 * // Create a new task
 * await db.create('/data/user123', taskSchema, {
 *   text: 'Learn GoatDB'
 * });
 *
 * // Query tasks
 * const query = db.query({
 *   source: '/data/user123',
 *   schema: taskSchema,
 *   // Find incomplete tasks
 *   predicate: ({ item }) => !item.get('done'),
 *   // Sort by text alphabetically
 *   sortBy: ({ left, right }) =>
 *     left.get('text').localeCompare(right.get('text')),
 *   // Optional context passed to predicate and sort functions
 *   ctx: { showCompleted: false }
 * });
 *
 * // Get live results that update automatically
 * const tasks = query.results();
 *
 * // Listen for changes
 * query.onResultsChanged(() => {
 *   console.log('Tasks updated:', query.results());
 * });
 * ```
 */
import { GoatDB } from './db/db.ts';
import { Query } from './repo/query.ts';
import type { AppConfig } from './server/app-config.ts';
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
  itemPathJoin,
  itemPathNormalize,
  itemPathIsValid,
} from './db/path.ts';
import { Repository } from './repo/repo.ts';
import { ManagedItem } from './db/managed-item.ts';
import { Item } from './cfds/base/item.ts';
import { prettyJSON, uniqueId } from './base/common.ts';
import type { BuildInfo } from './server/build-info.ts';
import { ConsoleLogStream } from './logging/console-stream.ts';
import type { LogStream } from './logging/log.ts';
import { JSONLogStream } from './logging/json-log-stream.ts';
import { normalizeEmail } from './base/string.ts';
import { Emitter } from './base/emitter.ts';

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
export type { ReadonlyItem } from './cfds/base/item.ts';
export type { JSONObject, ReadonlyJSONObject } from './base/interfaces.ts';
export {
  ConsoleLogStream,
  DataRegistry,
  Emitter,
  GoatDB,
  Item,
  itemPath,
  itemPathGetPart,
  itemPathGetRepoId,
  itemPathJoin,
  itemPathNormalize,
  itemPathIsValid,
  JSONLogStream,
  ManagedItem,
  normalizeEmail,
  prettyJSON,
  Query,
  Repository,
  uniqueId,
};
