import { SchemaManager } from '../../cfds/base/schema.ts';

export const kSchemaTask = {
  ns: 'task',
  version: 1,
  fields: {
    text: {
      type: 'string',
      default: () => '',
    },
    done: {
      type: 'boolean',
      default: () => false,
    },
  },
} as const;
export type SchemaTypeTask = typeof kSchemaTask;

export default function setup(): void {
  SchemaManager.default.register(kSchemaTask);
}
