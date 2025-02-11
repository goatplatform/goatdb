/**
 * GoatDB: The Edge-Native Database
 *
 * GoatDB is a real-time, distributed Version Control Database (VCDB) that runs
 * seamlessly on the client-side (edge). It combines the principles of
 * distributed version control with real-time data synchronization, offering:
 *
 * - Real-time data synchronization across devices
 * - Offline-first functionality
 * - Built-in conflict resolution
 * - Privacy-focused data handling
 * - Schema-based data organization
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
 * // Initialize GoatDB
 * const db = new GoatDB({
 *   path: '/home/my-app',
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

export type { AppConfig, BuildInfo, Schema, SchemaDataType };
export {
  GoatDB,
  Item,
  itemPath,
  itemPathGetPart,
  itemPathGetRepoId,
  itemPathJoin,
  itemPathNormalize,
  ManagedItem,
  prettyJSON,
  Query,
  Repository,
  SchemaManager,
};
