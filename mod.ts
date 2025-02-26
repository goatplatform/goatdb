/**
 * GoatDB: Lightweight NoDB for Deno & React
 *
 * GoatDB is a real-time, version-controlled database for Deno, React, and
 * low-friction deployments. It's ideal for prototyping, self-hosting,
 * single-tenant apps, as well as ultra light multi-tenant setups without
 * heavy backends or complex DBs.
 *
 * Key Features:
 * - No Dedicated Infra: Run the entire DB client-side, with incremental queries
 * - Resilience & Offline-First: Clients keep working if server goes down
 * - Edge-Native: Most processing happens in the client
 * - Real-Time Collaboration: Built-in sync keeps state synchronized
 *
 * Check out https://goatdb.dev for additional docs.
 *
 * @module GoatDB
 *
 * @example
 * ```typescript
 * import { GoatDB, SchemaManager } from '@goatdb/goatdb';
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
 * SchemaManager.default.register(taskSchema);
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
 *   sortDescriptor: ({ left, right }) =>
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
import type { Schema, SchemaDataType } from './cfds/base/schema.ts';
import { Query } from './repo/query.ts';
import type { AppConfig } from './server/app-config.ts';
import { SchemaManager } from './cfds/base/schema-manager.ts';
import {
  itemPath,
  itemPathGetPart,
  itemPathGetRepoId,
  itemPathJoin,
  itemPathNormalize,
} from './db/path.ts';
import { Repository } from './repo/repo.ts';
import { ManagedItem } from './db/managed-item.ts';
import { Item } from './cfds/base/item.ts';
import { prettyJSON } from './base/common.ts';
import type { BuildInfo } from './server/build-info.ts';
import { ConsoleLogStream } from './logging/console-stream.ts';
import type { LogStream } from './logging/log.ts';
import { JSONLogStream } from './logging/json-log-stream.ts';

export type { AppConfig, BuildInfo, LogStream, Schema, SchemaDataType };
export {
  ConsoleLogStream,
  GoatDB,
  Item,
  itemPath,
  itemPathGetPart,
  itemPathGetRepoId,
  itemPathJoin,
  itemPathNormalize,
  JSONLogStream,
  ManagedItem,
  prettyJSON,
  Query,
  Repository,
  SchemaManager,
};
