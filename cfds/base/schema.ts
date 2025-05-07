/**
 * @module schema
 *
 * This module defines the schema system for GoatDB. Schemas define the
 * structure of documents in the database, including field types, validation
 * rules, and conflict resolution strategies.
 *
 * Schemas in GoatDB are versioned alongside the data they describe, making
 * rolling schema updates via branches a natural mechanism. Each item in GoatDB
 * is defined with its schema, which dictates both the field types and their
 * conflict resolution strategy.
 *
 * The schema system supports various field types including primitive types
 * (string, number, boolean), complex types (sets, maps), and specialized types
 * like RichText. Each field can have default values, validation rules, and
 * specific conflict resolution behaviors.
 *
 * ## Paths and Built-in System Repositories
 *
 * GoatDB organizes data using paths that follow a hierarchical structure.
 * The system includes several built-in repositories under the `/sys/` path
 * prefix:
 *
 * - `/sys/sessions/<session id>`: Manages active user sessions and
 *   authentication tokens. The schema includes fields for session ID, user ID
 *   reference, creation timestamp, expiration timestamp, and device
 *   information.
 *
 * - `/sys/stats/<stat id>`: Contains system statistics and performance
 *   metrics. The schema includes fields for timestamp, operation counts,
 *   query performance metrics, storage usage, and other system health
 *   indicators.
 *
 * - `/sys/users/<user id>`: A conventional path for storing user information.
 *   This is merely a recommended convention; applications are responsible for
 *   placing user items at this path and setting up custom authentication rules
 *   if needed. The schema typically includes fields for email, username,
 *   display name, etc. Each user document has a unique ID that can be
 *   referenced in other collections.
 *
 * These built-in repositories have predefined schemas and special handling
 * within the system. Custom application data typically resides in separate
 * repositories outside the `/sys/` namespace.
 */

import type { Dictionary } from '../../base/collections/dict.ts';
import type {
  CoreValue,
  ReadonlyCoreObject,
} from '../../base/core-types/base.ts';
import type { CoreObject } from '../../base/core-types/index.ts';
import { notReached } from '../../base/error.ts';
import type { RichText } from '../richtext/tree.ts';
import type { ValueType } from './types/index.ts';

/**
 * A mapping between a schema type and its native variable type.
 */
export type FieldValue<T extends ValueType> = T extends 'string' ? string
  : T extends 'number' ? number
  : T extends 'boolean' ? boolean
  : T extends 'date' ? Date
  : T extends 'set' ? Set<CoreValue>
  : T extends 'map' ? Dictionary<string, CoreValue>
  : T extends 'richtext' ? RichText
  : CoreValue;

/**
 * A definition of a single field in a schema.
 */
export type FieldDef<T extends ValueType> = {
  /**
   * The type this field defines.
   */
  type: T;
  /**
   * A default initializer. Used to create a default value when the field is
   * missing.
   *
   * @param data The current value of the document. You must never modify this
   *             object, but you may read it to produce a default value for
   *             this field.
   *
   *             WARNING: Default initializers are called at an arbitrary order.
   *                      Don't depend on values of other default initializer
   *                      to be present in the data object.
   *
   * @returns A default value for this field.
   */
  default?: (data: ReadonlyCoreObject) => FieldValue<T>;
  /**
   * Determines whether this field is required or not. If a required fields is
   * missing, the Document will throw when attempting to serialize it.
   *
   * @default false
   */
  required?: boolean;
  /**
   * A function that validates the field value.
   *
   * @param data The current value of the document.
   * @returns true if the value is valid, false otherwise.
   */
  validate?: (data: ReadonlyCoreObject) => boolean;
};

/**
 * Mapping between field name and its definition.
 */
export type SchemaFieldsDef = Record<string, FieldDef<ValueType>>;

/**
 * A Schema defines the structure of a Document. Schemas are also versioned,
 * allowing for live, gradual migrations of data for some users, while others
 * continue to work with the old version in parallel.
 */
export type Schema = {
  /**
   * The namespace of this schema. The `null` and `session` namespaces are
   * reserved for the GoatDB's use.
   */
  ns: null | string;
  /**
   * The version of this schema. Used to detect when a new version of a schema
   * is available.
   */
  version: number;
  /**
   * A definition of all fields declared by this schema.
   */
  fields: SchemaFieldsDef;
  /**
   * An optional upgrade function, used to migrate documents from an older
   * schema to this schema.
   *
   * When upgrading a document, upgrade functions are run in order until
   * reaching the latest version available. For example, if a document is at
   * schema v1, and needs to be upgraded to v3, then first the upgrade function
   * of v2 will be run, then the result piped through the upgrade function of
   * v3.
   *
   * @param data The current data of the document. You must not modify this
   *             object directly. Instead, return a new one with the upgraded
   *             data.
   *
   * @param schema The schema of the current data.
   *
   * @returns An upgraded data that matches the current schema.
   */
  upgrade?: (data: ReadonlyCoreObject, schema: Schema) => CoreObject;
};

/**
 * A list of built in fields that are automatically injected into all schemas.
 */
const kBuiltinFields: Record<string, FieldDef<ValueType>> = {
  isDeleted: {
    type: 'boolean',
  },
} as const;

/**
 * Represents a field in a schema, which can be either a custom field defined
 * in the schema or one of the built-in fields that are automatically added to
 * all items.
 *
 * @template T The schema type
 */
export type SchemaField<T extends Schema> =
  | keyof T['fields']
  | keyof typeof kBuiltinFields;

/**
 * Given a schema, extracts the names of all required fields.
 * Note: For practical purposes, fields with a default function are treated
 * as required from the type system.
 */
export type SchemaRequiredFields<
  T extends Schema,
  K extends SchemaField<T> = SchemaField<T>,
> = T['fields'][K]['required'] extends true
  // deno-lint-ignore ban-types
  ? T['fields'][K]['default'] extends Function ? never
  : K
  : never;

/**
 * Given a schema, extracts the names of all optional fields.
 */
export type SchemaOptionalFields<
  T extends Schema,
  K extends SchemaField<T> = SchemaField<T>,
> = T['fields'][K]['required'] extends false | undefined ? K : never;

/**
 * Given a type (FieldValue) and a required + default function, this generates
 * the correct type or union with undefined.
 */
export type SchemaValueWithOptional<
  T,
  R extends boolean,
  D extends boolean,
> = R extends true ? T : D extends true ? T : (undefined | T);

/**
 * Given a schema, extracts the type of its data.
 */
export type SchemaDataType<
  T extends Schema,
  K extends keyof T['fields'] = keyof T['fields'],
> = {
  [k in K]: SchemaValueWithOptional<
    FieldValue<T['fields'][k]['type']>,
    T['fields'][k] extends { required: true } ? true : false,
    T['fields'][k] extends { default: Function } ? true : false
  >;
};

/**
 * The null schema is used to reserve keys for items that they're schema
 * isn't known yet. It's also used to simplify the internal diff/patch logic.
 *
 * Null items can't be persisted, and aren't synchronized across the network.
 */
export const kNullSchema: Schema = {
  ns: null,
  version: 0,
  fields: {},
  upgrade: () => notReached('Attempting to upgrade the null schema'),
} as const;
export type SchemaNullType = typeof kNullSchema;

/**
 * All connections to the DB are represented as Session items, and are used
 * to verify the authenticity of commits.
 */
export const kSchemaSession = {
  ns: 'sessions',
  version: 1,
  fields: {
    id: {
      type: 'string',
      required: true,
    },
    publicKey: {
      type: 'string',
      required: true,
    },
    expiration: {
      type: 'date',
      required: true,
    },
    // The key of the matching user from /sys/users
    // NOTE: Anonymous sessions don't have an owner
    owner: {
      type: 'string',
    },
  },
} as const;
export type SchemaTypeSession = typeof kSchemaSession;

/**
 * Internally collected user statistics.
 */
export const kSchemaUserStats = {
  ns: 'user-stats',
  version: 1,
  fields: {
    firstLoggedIn: {
      type: 'date',
    },
    lastLoggedIn: {
      type: 'date',
    },
  },
} as const;
export type SchemaTypeUserStats = typeof kSchemaUserStats;

const gCachedSchemaFields = new WeakMap<
  Schema,
  [string, FieldDef<ValueType>][]
>();

/**
 * Given a schema, this function returns its field definitions as an iterable.
 * @param s A schema.
 * @returns An iterable of field name and its definition.
 */
export function SchemaGetFields(
  s: Schema,
): readonly [string, FieldDef<ValueType>][] {
  let r = gCachedSchemaFields.get(s);
  if (!r) {
    r = Object.entries(s.fields).concat(Object.entries(kBuiltinFields));
    Object.freeze(r);
    gCachedSchemaFields.set(s, r);
  }
  return r;
}

const gCachedSchemaRequiredFields = new WeakMap<Schema, string[]>();
/**
 * Given a schema, this functions returns an iterable of its required fields.
 * @param s A schema.
 * @returns An iterable of required field names.
 */
export function SchemaGetRequiredFields(s: Schema): readonly string[] {
  let r = gCachedSchemaRequiredFields.get(s);
  if (!r) {
    r = [];
    for (const [fieldName, def] of SchemaGetFields(s)) {
      if (def.required === true) {
        r.push(fieldName);
      }
    }
    Object.freeze(r);
    gCachedSchemaRequiredFields.set(s, r);
  }
  return r;
}

/**
 * Given a schema and a field, returns its
 * @param s
 * @param field
 * @returns
 */
export function SchemaGetFieldDef<
  S extends Schema,
  F extends keyof S['fields'] | keyof typeof kBuiltinFields,
>(s: S, field: F): FieldDef<S['fields'][F]['type']> | undefined {
  const def = s.fields[field as string] || kBuiltinFields[field as string];
  if (!def) {
    return undefined;
  }
  return def;
}

/**
 * Given two schemas, returns whether they're the same one or not.
 * @param s1 First schema.
 * @param s2 Second schema.
 * @returns true if the schemas are the same, false otherwise.
 */
export function SchemaEquals(s1: Schema, s2: Schema): boolean {
  return s1.ns === s2.ns && s1.version === s2.version;
}
