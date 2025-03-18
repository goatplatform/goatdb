import { assert } from '../../base/error.ts';
import {
  kNullSchema,
  type Schema,
  type SchemaDataType,
  SchemaEquals,
} from './schema.ts';
import {
  clone,
  type DataChanges,
  deserialize,
  diff as objectDiff,
  diffKeys,
  equals as dataEqual,
  isValidData,
  normalize as normalizeObject,
  patch as objectPatch,
  serialize,
} from './object.ts';
import {
  type ConstructorDecoderConfig,
  type Decoder,
  isDecoderConfig,
  type ReadonlyDecodedObject,
} from '../../base/core-types/encoding/index.ts';
import {
  JSONCyclicalDecoder,
  JSONCyclicalEncoder,
} from '../../base/core-types/encoding/json.ts';
import {
  type ChecksumEncoderOpts,
  Murmur3Checksum,
} from '../../base/core-types/encoding/checksum.ts';
import type { ReadonlyJSONObject } from '../../base/interfaces.ts';
import type {
  CoreValue,
  Encodable,
  Encoder,
} from '../../base/core-types/index.ts';
import { SchemaGetFieldDef } from './schema.ts';
import type { Readwrite } from '../../base/types.ts';
import { SchemaManager } from './schema-manager.ts';

export interface ReadonlyItem<S extends Schema> {
  readonly isNull: boolean;
  readonly schema: S;
  readonly isValid: boolean;
  readonly checksum: string;
  get<K extends keyof SchemaDataType<S>>(key: K): SchemaDataType<S>[K];
  has(key: keyof SchemaDataType<S>): boolean;
  cloneData(): SchemaDataType<S>;
}

export interface ItemConfig<S extends Schema> {
  schema: S;
  data: Partial<SchemaDataType<S>>;
  normalized?: boolean;
}

export interface EncodedItem {
  s: Decoder;
  data: ReadonlyDecodedObject;
}

const checksumSerOptions: ChecksumEncoderOpts = {
  // For checksum purposes we need to use the flat rep or we won't account
  // for depth changes. Computing the checksum on a DFS run of the tree
  // completely strips out the depth info.
  flatRep: true,
  local: false,
  typeSafe: true,
};

/**
 * An Item instance represents a snapshot of a data item including all of its
 * fields. An item is a map like object that tracks both the data and its
 * schema. Items are the contents of specific versions (commits) in the version
 * graph (history).
 *
 * Typically you never need to create instances of this class directly. Instead,
 * use `GoatDB.item()` in order to get a LiveItem instance that's much easier
 * to work with.
 */
export class Item<S extends Schema = Schema>
  implements ReadonlyItem<S>, Encodable {
  readonly schemaManager: SchemaManager;
  private _schema!: S;
  private _data!: SchemaDataType<S>;
  private _checksum: string | undefined;
  private _normalized = false;
  private _locked = false;

  /**
   * Creates a new Item instance.
   *
   * @param config Either an ItemConfig object containing the schema and data,
   *               or a ConstructorDecoderConfig for deserializing an encoded
   *               item
   * @param schemaManager Optional schema manager to use. If not provided, the
   *                      default schema manager will be used
   */
  constructor(
    config: ItemConfig<S> | ConstructorDecoderConfig<EncodedItem>,
    schemaManager?: SchemaManager,
  ) {
    this.schemaManager = schemaManager || SchemaManager.default;
    if (isDecoderConfig(config)) {
      this.deserialize(config.decoder);
    } else {
      this._schema = config.schema;
      this._data = config.data as SchemaDataType<S>;
      this._normalized = config.normalized === true;
    }
  }

  private static _kNullDocuments = new Map<
    SchemaManager,
    Item<typeof kNullSchema>
  >();
  /**
   * @returns An item with the null schema.
   */
  static nullItem<S extends Schema = typeof kNullSchema>(
    schemaManager: SchemaManager,
  ): Item<S> {
    let doc = this._kNullDocuments.get(schemaManager);
    if (!doc) {
      doc = new this({ schema: kNullSchema, data: {} }, schemaManager);
      doc.lock();
      this._kNullDocuments.set(schemaManager, doc);
    }
    return doc as unknown as Item<S>;
  }

  /**
   * Returns whether this item has a null schema or not. The null schema is
   * empty and has no fields and no values.
   */
  get isNull(): boolean {
    return this.schema.ns === null;
  }

  /**
   * The schema of this item.
   */
  get schema(): S {
    return this._schema;
  }

  /**
   * Returns the validation status of this item. Before persisting the item must
   * first be valid or it won't be able to be persisted locally nor sync'ed
   * across the network.
   */
  get isValid(): boolean {
    return isValidData(this.schema, this._data)[0] as boolean;
  }

  /**
   * Indicates whether this item had been deleted or not. Deleted items will
   * eventually be garbage collected, and receive special treatment by the
   * system.
   *
   * NOTE: It's perfectly OK to mark a deleted item as not deleted. Yay for
   * distributed version control. The delete marker goes through conflict
   * resolution the same as any other schema field.
   */
  get isDeleted(): boolean {
    return this.get('isDeleted') === true;
  }

  /**
   * Sets or clears the delete marker from this item. Marking an item as deleted
   * sets it for future garbage collection rather than delete it immediately.
   *
   * A deleted item will not appear in query results, but will still get sync'ed
   * and go through conflict resolution.
   *
   * NOTE: It's perfectly fine to set this flag then clear it at a later time.
   * Clearing the delete marker recovers the item and reverts it back to a
   * regular, not deleted, item.
   */
  set isDeleted(flag: boolean) {
    (this.set as (k: string, v: boolean) => void)('isDeleted', flag);
  }

  /**
   * WARNING: You probably shouldn't use this. Used internally as an
   * optimization to avoid unnecessary copying.
   *
   * @returns The underlying object primitive.
   */
  dataUnsafe(): SchemaDataType<S> {
    return this._data;
  }

  /**
   * Returns a checksum that can be used to efficiently test for equality
   * between two records. It's also used to guard against diff/patch bugs.
   *
   * Any legacy cryptographic hash would probably do here. The current
   * implementation uses MD5 simply because its so common.
   */
  get checksum(): string {
    this.normalize();
    if (this._checksum === undefined) {
      const csEncoder = new Murmur3Checksum();
      serialize(csEncoder, this._schema, this._data, checksumSerOptions);
      this._checksum = csEncoder.getOutput();
    }
    return this._checksum;
  }

  /**
   * Returns the keys currently present in this item.
   */
  get keys(): (keyof SchemaDataType<S>)[] {
    return Object.keys(this._data) as (keyof SchemaDataType<S>)[];
  }

  /**
   * Returns the value for the given field or undefined.
   *
   * If this is a null item (has no schema), returns undefined for all fields.
   * Otherwise, returns the field's value, or undefined if not set.
   *
   * @param key The field's name.
   * @returns   The field's value or undefined.
   * @throws    Throws if attempting to access a field not defined by this
   *            item's schema (unless this is a null item).
   */
  get<T extends keyof SchemaDataType<S>>(
    key: string & T,
  ): SchemaDataType<S>[T] {
    if (this.isNull) {
      return undefined as SchemaDataType<S>[T];
    }
    const fieldDef = SchemaGetFieldDef(this.schema, key);
    assert(
      fieldDef !== undefined,
      `Unknown field name '${key}' for schema '${this.schema.ns}'`,
    );
    if (!Object.hasOwn(this._data, key) && fieldDef.default !== undefined) {
      return fieldDef.default(this._data);
    }
    return this._data[key] as SchemaDataType<S>[T];
  }

  /**
   * Returns whether the given field is present on the current item or not.
   *
   * @param key The field's name.
   * @returns   Whether the field is currently present on this item or not.
   * @throws    Throws if attempting to access a field not defined by this
   *            item's schema.
   */
  has<T extends keyof SchemaDataType<S>>(key: string & T): boolean {
    assert(
      SchemaGetFieldDef(this.schema, key) !== undefined,
      `Unknown field name '${key}' for schema '${this.schema.ns}'`,
    );
    return Object.hasOwn(this._data, key);
  }

  /**
   * Sets the value for the given field.
   *
   * @param key   The field's name.
   * @param value The value to set. Must match the value defined in this item's
   *              schema. If undefined is passed, this is the equivalent of
   *              calling `Item.delete(key)`.
   * @throws      Throws if attempting to set a field not defined by this item's
   *              schema.
   */
  set<T extends keyof SchemaDataType<S>>(
    key: T,
    value: SchemaDataType<S>[T] | undefined,
  ): void {
    assert(!this._locked);
    assert(
      SchemaGetFieldDef(this.schema, key) !== undefined,
      `Unknown field name '${key as string}' for schema '${this.schema.ns}'`,
    );
    if (value === undefined) {
      this.delete(key);
      return;
    }
    this._data[key] = value;
    this.invalidateCaches();
    this.normalize();
  }

  /**
   * A convenience method for setting several fields and values at once.
   * @param data The values to set.
   */
  setMulti(data: Partial<SchemaDataType<S>>): void {
    assert(!this._locked);
    for (const [key, value] of Object.entries(data)) {
      this.set(key, value);
    }
  }

  /**
   * Deletes a given field from this item.
   *
   * @param key The field to delete.
   * @returns   True if the field had been deleted, false if the field didn't
   *            exist and the item wasn't modified.
   * @throws    Throws if attempting to set a field not defined by this item's
   *            schema.
   */
  delete<T extends keyof SchemaDataType<S>>(key: T): boolean {
    assert(!this._locked);
    assert(
      SchemaGetFieldDef(this.schema, key) !== undefined,
      `Unknown field name '${key as string}' for schema '${this.schema.ns}'`,
    );
    if (Object.hasOwn(this._data, key)) {
      delete this._data[key];
      this.invalidateCaches();
      this.normalize();
      return true;
    }
    return false;
  }

  /**
   * Compares this item with another item for equality.
   * Two items are considered equal if they have the same schema and their data
   * is equal after normalization.
   *
   * @param other The item to compare against
   * @returns true if the items are equal, false otherwise
   */
  isEqual(other: Item<S>): boolean {
    if (this === other) {
      return true;
    }
    if (!SchemaEquals(this.schema, other.schema)) {
      return false;
    }
    this.normalize();
    other.normalize();
    if (
      this._checksum &&
      other._checksum &&
      this._checksum !== other._checksum
    ) {
      return false;
    }
    return dataEqual(this.schema, this._data, other._data, {
      local: false,
    });
  }

  /**
   * Clones the current item.
   *
   * This method creates a new Item instance with the same schema and data as
   * the current item. The new item is a deep copy of the current item,
   * including all nested objects and arrays.
   */
  clone(): Item<S> {
    const schema = this._schema;
    const result = new Item({
      schema,
      data: clone(schema, this._data),
      normalized: this._normalized,
    }, this.schemaManager);
    result._checksum = this._checksum;
    return result;
  }

  /**
   * Creates a deep copy of the item's data.
   *
   * @param onlyFields Optional array of field names to copy. If provided, only
   *                   the specified fields will be cloned.
   * @returns A deep copy of the item's data, or a partial copy if onlyFields
   *          is specified.
   */
  cloneData(
    onlyFields?: (keyof SchemaDataType<S>)[],
  ): Readwrite<SchemaDataType<S>> {
    return clone(this._schema, this._data, onlyFields);
  }

  /**
   * Copies data from another item into this one.
   *
   * This method replaces the current item's schema and data with a deep copy
   * of the source item's schema and data. The source item remains unchanged.
   *
   * @param doc The source item to copy from.
   * @throws {AssertionError} If this item is locked.
   */
  copyFrom(doc: ReadonlyItem<S> | Item<S>): void {
    assert(!this._locked);
    this._schema = doc.schema;
    this._data = doc.cloneData();
    this.invalidateCaches();
  }

  /**
   * Computes the differences between this item and another item.
   *
   * This method compares the data of this item with another item of the same schema
   * and returns an object describing the differences between them.
   *
   * @param other The item to compare against
   *
   * @param byCharacter If true, rich text differences will be computed at the
   *                    character level rather than at the paragraph/element
   *                    level.
   *
   * @returns An object describing the differences between the two items
   *
   * @throws {AssertionError} If the other item is not an Item instance
   */
  diff(other: Item<S>, byCharacter?: boolean): DataChanges {
    assert(other instanceof Item);
    this.normalize();
    other.normalize();
    other.assertValidData();
    return objectDiff(other.schema, this._data, other._data, {
      local: false,
      byCharacter,
    });
  }

  /**
   * Applies changes to this item's data.
   *
   * This method takes a DataChanges object (typically produced by the diff()
   * method) and applies those changes to this item's data. The item's data
   * will be modified in place.
   *
   * @param changes The changes to apply to this item's data
   * @throws {AssertionError} If this item is locked
   */
  patch(changes: DataChanges): void {
    assert(!this._locked);
    const schema = this.schema;
    this._data = objectPatch(schema, this._data, changes);
    this.invalidateCaches();
    this.normalize();
  }

  /**
   * Returns an array of field keys that differ between this item and another
   * item.
   *
   * This method compares the data of this item with another item of the same
   * schema and returns an array of field keys where the values differ.
   *
   * This is a much faster check than a full diff computation.
   *
   * @param other The item to compare against
   * @param local If true, compare local fields. If false, ignores local fields
   * @returns Array of field keys that have different values between the items
   * @throws {AssertionError} If the other item is not an Item instance
   */
  diffKeys(other: Item<S>, local: boolean): string[] {
    this.normalize();
    other.normalize();
    return diffKeys(other.schema, this._data, other._data, {
      local,
    });
  }

  /**
   * Upgrades this item's data to a newer schema version.
   *
   * This method takes an optional target schema and attempts to upgrade the
   * item's data to match that schema. If no target schema is provided, it will
   * upgrade to the latest schema version available for this namespace.
   *
   * The upgrade process is performed by applying the upgrade functions defined
   * in each schema version between the current and target versions. The upgrade
   * will fail if any intermediate schema versions are missing.
   *
   * @param newSchema Optional target schema to upgrade to
   * @returns true if the data was upgraded, false if no upgrade was needed
   * @throws {AssertionError} If this item is locked or if the upgrade fails
   */
  upgradeSchema(newSchema?: Schema): boolean {
    assert(!this._locked);
    const res = this.schemaManager.upgrade(this._data, this._schema, newSchema);
    assert(res !== undefined, 'Upgrade failed');
    // Refresh caches if actually changed the data
    if (res[0] !== this._data) {
      [this._data, this._schema] = res as [SchemaDataType<S>, S];
      this.invalidateCaches();
      this.normalize();
      return true;
    }
    return false;
  }

  /**
   * Checks if this item needs a schema upgrade.
   *
   * This method checks if there is a newer schema version available for this
   * item's  namespace. It compares the item's current schema version with the
   * latest schema version registered in the schema manager.
   *
   * @returns true if a newer schema version exists and the item needs an
   *          upgrade, false otherwise
   */
  needsSchemaUpgrade(): boolean {
    if (this.schema.ns === null) {
      return false;
    }
    const latestSchema = this.schemaManager.get(this.schema.ns);
    if (
      latestSchema !== undefined &&
      latestSchema.version > this.schema.version
    ) {
      return true;
    }
    return false;
  }

  /**
   * Normalizes the item's data according to its schema.
   *
   * This method ensures that all fields in the item's data conform to the
   * schema's requirements by applying normalization rules. For example, it may:
   * - Convert field values to their proper types
   * - Apply default values for missing required fields
   * - Remove fields not defined in the schema
   *
   * The normalization is only performed once - subsequent calls will have no
   * effect. Null items (those with a null schema) are always normalized by
   * definition.
   */
  normalize(): void {
    if (this._normalized || this.isNull) {
      return;
    }
    this.invalidateCaches();
    normalizeObject(this.schema, this._data);
    this._normalized = true;
  }

  /**
   * Serializes the item into an encoded format.
   *
   * This method encodes the item's schema, data, normalization status and
   * checksum into a format that can be stored or transmitted. The item is
   * automatically normalized before serialization.
   *
   * @param encoder The encoder to use for serialization
   * @param options Serialization options
   * @param options.local If true, serialization includes local data. If false,
   *                      local data is skipped.
   */
  serialize(
    encoder: Encoder<string, CoreValue>,
    options = { local: false },
  ): void {
    this.normalize();
    encoder.set('s', this.schemaManager.encode(this.schema));
    const dataEncoder = encoder.newEncoder();
    serialize(dataEncoder, this.schema, this._data, {
      local: options.local,
    });
    encoder.set('d', dataEncoder.getOutput());
    encoder.set('n', this._normalized);
    encoder.set('cs', this.checksum);
  }

  /**
   * Deserializes an encoded item into this instance.
   *
   * This method decodes the item's schema, data, normalization status and
   * checksum from an encoded format and updates this instance's state
   * accordingly. The item is automatically normalized after deserialization.
   *
   * @param decoder The decoder containing the encoded item data
   * @throws {AssertionError} If the item is locked or if the schema is unknown
   */
  deserialize(decoder: Decoder): void {
    assert(!this._locked);
    const schema = this.schemaManager.decode(decoder.get<string>('s')!);
    assert(schema !== undefined, 'Unknown schema');
    this._schema = schema as S;
    const dataDecoder = decoder.getDecoder('d');
    this._data = deserialize(dataDecoder, this.schema);
    if (dataDecoder instanceof JSONCyclicalDecoder) {
      dataDecoder.finalize();
    }
    // this.invalidateCaches();
    this._normalized = decoder.get<boolean>('n') || false;
    this.normalize();
    // this.assertValidData();
    // if (decoder.has('cs')) {
    //   assert(decoder.get('cs') === this.checksum, 'Checksum mismatch');
    // }
    this._checksum = decoder.get('cs');
  }

  /**
   * Serializes this item to a JSON-compatible object.
   *
   * @param local If true, serialization includes local data. If false,
   *              local data is skipped.
   * @returns A JSON object representing this item's serialized state.
   */
  toJS(local = false): ReadonlyJSONObject {
    const encoder = new JSONCyclicalEncoder();
    this.serialize(encoder, { local });
    return encoder.getOutput() as ReadonlyJSONObject;
  }

  /**
   * Deserializes a JSON-compatible object into an Item instance.
   *
   * @param obj The JSON object to deserialize
   * @returns An Item instance representing the deserialized data
   */
  static fromJS<S extends Schema>(obj: ReadonlyJSONObject): Item<S> {
    const decoder = JSONCyclicalDecoder.get(obj);
    const record = new this({ decoder });
    decoder.finalize();
    return record as unknown as Item<S>;
  }

  /**
   * Asserts that the item's data is valid according to its schema.
   *
   * This method checks if the item's data conforms to the schema's
   * requirements. If the data is invalid, it throws an assertion error with
   * the corresponding error message.
   *
   * @throws {AssertionError} If the item's data is invalid
   */
  assertValidData(): void {
    const [valid, msg] = isValidData(this.schema, this._data);
    assert(valid as boolean, msg as string);
  }

  /**
   * Invalidates internal caches used by the item.
   *
   * This private method resets the cached checksum and normalization state,
   * forcing them to be recalculated when next accessed. Called internally
   * when the item's data changes.
   */
  private invalidateCaches(): void {
    this._checksum = undefined;
    this._normalized = false;
  }

  /**
   * Returns whether this item is locked or not. Locked items cannot be
   * modified. Items are locked when they represent a specific version in
   * history.
   */
  get isLocked(): boolean {
    return this._locked;
  }

  /**
   * Locks this item, preventing any further modifications.
   *
   * When an item is locked, attempts to modify its data will throw errors.
   * The checksum is calculated and cached before locking to ensure consistency.
   * Items are typically locked when they represent a specific version in
   * history.
   */
  lock(): void {
    this.checksum; // Force calculate our checksum
    this._locked = true;
  }

  /**
   * Unlocks this item, allowing modifications.
   *
   * When an item is unlocked, its data can be modified. This reverses the
   * effect of calling lock().
   *
   * WARNING: Unlocking items is dangerous and should never be needed in normal
   * usage. Unlocking can corrupt historical versions and lead to serious data
   * inconsistencies.
   */
  unlock(): void {
    this._locked = false;
  }
}
