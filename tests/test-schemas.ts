/**
 * Shared test schemas and registries used across multiple test files.
 */
import { DataRegistry } from '../cfds/base/data-registry.ts';

/** Minimal schema with string + number fields, used by Trusted-mode tests. */
export const TestSchema = {
  ns: 'test',
  version: 1,
  fields: {
    name: { type: 'string', required: true },
    count: { type: 'number', default: () => 0 },
  },
} as const;

/** Pre-configured registry with TestSchema registered. */
export const kDataRegistry = new DataRegistry();
kDataRegistry.registerSchema(TestSchema);
