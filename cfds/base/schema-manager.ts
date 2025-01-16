import type { CoreObject } from '../../base/core-types/base.ts';
import { coreValueClone } from '../../base/core-types/clone.ts';
import { assert } from '../../base/error.ts';
import {
  type Schema,
  kSchemaSession,
  kSchemaUser,
  kNullSchema,
} from './schema.ts';

/**
 * The schemaManager acts as a registry of known schemas for a given GoatDB
 * instance. It's initialized when the app starts and stays fixed during its
 * execution.
 *
 * Typically, apps use the `schemaManager.default` instance, but are free to
 * create multiple managers each with different schemas registered.
 */
export class SchemaManager {
  private readonly _schemas: Map<string, Schema[]>;

  /**
   * The default manager. Unless explicitly specified, GoatDB will default to
   * this manager.
   */
  static readonly default: SchemaManager = new this();

  /**
   * Initialize a new schemaManager.
   * @param schemas An optional list of schemas to register.
   */
  constructor(schemas?: Iterable<Schema>) {
    this._schemas = new Map();
    this.register(kSchemaSession);
    this.register(kSchemaUser);
    if (schemas) {
      for (const s of schemas) {
        this.register(s);
      }
    }
  }

  /**
   * Registers a schema with this manager. This is a NOP if the schema had
   * already been registered.
   *
   * @param schema The schema to register.
   */
  register(schema: Schema): void {
    assert(schema.ns !== null);
    let arr = this._schemas.get(schema.ns);
    if (!arr) {
      arr = [];
      this._schemas.set(schema.ns, arr);
    }
    if (arr.find((s) => s.version === schema.version) === undefined) {
      arr.push(schema);
      arr.sort((s1, s2) => s2.version - s1.version);
    }
  }

  /**
   * Find a schema that's been registered with this manager.
   *
   * @param ns      The namespace for the schema.
   * @param version If provided, searches for the specific version. Otherwise
   *                this method will return the latest version for the passed
   *                namespace.
   *
   * @returns A schema or undefined if not found.
   */
  get(ns: string, version?: number): Schema | undefined {
    const arr = this._schemas.get(ns);
    if (!arr) {
      return undefined;
    }
    return version ? arr.find((s) => s.version === version) : arr[0];
  }

  /**
   * Given a data object and its schema, this method performs the upgrade
   * procedure to the target schema.
   *
   * This method will refuse to upgrade to the target schema if a single version
   * is missing. For example, if attempting to upgrade from v1 to v3, but the
   * v2 schema is missing, then the upgrade will be refused.
   *
   * NOTE: You shouldn't use this method directly under normal circumstances.
   * The upgrade procedure will be performed automatically for you when needed.
   *
   * @param data         The data to upgrade.
   * @param dataSchema   The schema of the passed data.
   * @param targetSchema The target schema. If not provided, the latest schema
   *                     for the namespace will be used.
   *
   * @returns An array in the form of [data, schema] with the result. Returns
   *          undefined if the upgrade failed.
   */
  upgrade(
    data: CoreObject,
    dataSchema: Schema,
    targetSchema?: Schema,
  ): [CoreObject, Schema] | undefined {
    if (
      (targetSchema === undefined || targetSchema.ns === null) &&
      dataSchema.ns === null
    ) {
      return [data, kNullSchema];
    }
    assert(
      dataSchema.ns !== null ||
        (targetSchema !== undefined && targetSchema.ns !== null),
    );
    const ns = targetSchema?.ns || dataSchema.ns!;
    const latest = this.get(ns, targetSchema?.version);
    if (!latest || latest.version === dataSchema.version) {
      return [data, dataSchema];
    }

    let currentSchema = dataSchema;
    let upgradedData = coreValueClone(data);
    for (let i = dataSchema.version + 1; i <= latest.version; ++i) {
      const schema = this.get(ns, i);
      if (!schema) {
        return undefined;
      }
      if (schema.upgrade) {
        upgradedData = schema.upgrade(upgradedData, currentSchema);
      }
      currentSchema = schema;
    }
    return [upgradedData, currentSchema];
  }

  /**
   * Encoded a schema to a marker string for storage.
   * @param schema The schema to encode.
   * @returns A string marker for this schema.
   */
  encode(schema: Schema): string {
    if (schema.ns === null) {
      return 'null';
    }
    return `${schema.ns}/${schema.version}`;
  }

  /**
   * Decodes a schema marker to an actual schema.
   * @param str The schema marker produced by a previous call to
   *            `schemaManager.encode`.
   *
   * @returns The registered schema or undefined if no such schema is found.
   */
  decode(str: string /*| Decoder*/): Schema | undefined {
    if (str === 'null') {
      return kNullSchema;
    }
    if (typeof str === 'string') {
      const [ns, ver] = str.split('/');
      return this.get(ns, parseInt(ver));
    }
    // if (str.has('ns') && str.has('version')) {
    //   const ns = str.get<string>('ns')!;
    //   const ver = str.get<number>('version')!;
    //   return this.get(ns, ver);
    // }
    return undefined;
  }
}
