// Schema definitions - https://goatdb.dev/docs/schema
import { DataRegistry } from '@goatdb/goatdb';

/**
 * A schema defines the structure of items that can be stored in the DB.
 * Adding a new schema involves these 3 steps:
 *
 * 1. Define a new const schema definition.
 *    Tip: Remember the as const in the end.
 *
 *    export const kSchemaMyItem = {
 *      ns: 'MyItem',
 *      version: 1,
 *      fields: {
 *        title: {
 *          type: 'string',
 *          default: () => 'Untitled',
 *        },
 *        value: {
 *          type: 'number',
 *          required: true,
 *        },
 *      },
 *    } as const;
 *
 * 2. Define a utility type for this const.
 *
 *    export type SchemaMyItem = typeof kSchemaMyItem;
 *
 * 3. Edit the registerSchemas() function at the bottom of this file and
 *    include a call to manager.register().
 *
 *    manager.register(kSchemaMyItem);
 */
export const kSchemaMyItem = {
  ns: 'MyItem',
  version: 1,
  fields: {
    title: {
      type: 'string',
      default: () => 'Untitled',
    },
    value: {
      type: 'number',
      required: true,
    },
  },
} as const;
export type SchemaMyItem = typeof kSchemaMyItem;

// ====== Add new schemas here ====== //

/**
 * This is the main registration function for all schemas in this project.
 * It gets called from both the client and the server code so they agree on the
 * same schemas.
 *
 * @param registry The registry to register with.
 *                 Uses {@link DataRegistry.default} if not provided.
 */
export function registerSchemas(
  registry: DataRegistry = DataRegistry.default,
): void {
  // TODO: Register all your schemas here
  registry.registerSchema(kSchemaMyItem);
}