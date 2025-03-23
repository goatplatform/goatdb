/**
 * Core type definitions for GoatDB
 *
 * These types represent the primitive values supported by GoatDB for diffing
 * and patching operations. They extend beyond standard JSON types to include
 * common runtime JavaScript types such as generators, Sets, custom classes,
 * and more. This allows GoatDB to work with a wider range of data structures
 * than traditional JSON-only databases.
 */

import type { Dictionary } from '../collections/dict.ts';

/**
 * A read-only object with string keys and CoreValue values
 */
export type ReadonlyCoreObject = {
  readonly [key: string]: CoreValue;
};

/**
 * A mutable object with string keys and optional type parameter for values
 */
export interface CoreObject<T extends CoreValue = CoreValue> {
  [key: string]: T;
}

/**
 * A read-only array of CoreValues
 */
export type ReadonlyCoreArray = readonly CoreValue[];

/**
 * A mutable array of CoreValues
 */
export type CoreArray = CoreValue[];

/**
 * A Set containing CoreValues
 */
export type CoreSet = Set<CoreValue>;

/**
 * A string key type for CoreObjects
 */
export type CoreKey = keyof ReadonlyCoreObject & string;

/**
 * A dictionary of CoreKeys to CoreValues
 */
export type CoreDictionary = Dictionary<CoreKey, CoreValue>;

/**
 * Concrete (non-undefined) values supported by GoatDB
 * Includes standard JSON types plus runtime JS types like Date, Set,
 * Dictionary, and custom classes
 */
export type ConcreteCoreValue =
  | string
  | number
  | boolean
  | null
  | Date
  | CoreArray
  | CoreObject
  | Set<ConcreteCoreValue>
  | Dictionary<CoreKey, ConcreteCoreValue>
  | Generator<ConcreteCoreValue>
  | CoreClassObject
  | ReadonlyCoreArray
  | ReadonlyCoreObject;

/**
 * The complete set of values supported by GoatDB, including undefined
 * These types form the foundation for diffing and patching operations
 */
export type CoreValue =
  | undefined
  | ConcreteCoreValue
  | CoreSet
  | CoreDictionary
  | Generator<CoreValue>;

/**
 * Enumeration of all supported value types for type checking and serialization
 */
export enum CoreType {
  String,
  Number,
  Boolean,
  Null,
  Date,
  Array,
  Object,
  Set,
  Dictionary,
  Undefined,
  Generator,
  ClassObject,
}

/**
 * Union type of custom class objects that can be handled by GoatDB
 * Support for custom classes allows for complex data structures with custom behaviors
 */
export type CoreClassObject = Comparable | Clonable | Equatable | Encodable;

/**
 * Function type for filtering object fields during operations
 */
export type ObjFieldsFilterFunc = (
  key: string,
  obj: ReadonlyCoreObject,
) => boolean;

/**
 * Function type for filtering iterable values during operations
 */
export type IterableFilterFunc = (value: CoreValue) => boolean;

/**
 * Options for controlling behavior of core operations
 */
export interface CoreOptions {
  objectFilterFields?: ObjFieldsFilterFunc;
  iterableFilter?: IterableFilterFunc;
}

/**
 * Interface for objects that can be compared for ordering
 * Implementing this interface allows custom classes to define their own comparison logic
 */
export interface Comparable<T = unknown> {
  compare(other: T): number;
}

/**
 * Interface for objects that can determine equality with other objects
 * Allows custom equality logic beyond reference equality
 */
export interface Equatable<T = unknown> {
  isEqual(other: T): boolean;
}

/**
 * Interface for objects that can be cloned
 * Essential for copy operations in diffing and patching workflows
 */
export interface Clonable<T = unknown> {
  clone(opts?: CoreValueCloneOpts): T;
}

/**
 * Options for customizing cloning behavior
 */
export interface CoreValueCloneOpts extends CoreOptions {
  fieldCloneOverride?: (
    obj: ReadonlyCoreObject | CoreDictionary,
    key: string,
    opts?: CoreValueCloneOpts,
  ) => CoreValue;
  objectOverride?: (obj: CoreValue) => [boolean, CoreValue];
  notClonableExt?: <T extends Object>(obj: T) => T | undefined;
}

/**
 * Interface for objects that can encode values
 * Used in serialization processes
 */
export interface Encoder<
  K = CoreKey,
  V = CoreValue,
  T = CoreValue,
  OT = unknown,
> {
  set(key: K, value: V, options?: OT): void;
  getOutput(): T;
  newEncoder(): Encoder<K, V, T, OT>;
}

/**
 * Interface for objects that can be encoded/serialized
 * Allows custom classes to control their serialization behavior
 */
export interface Encodable<
  K = CoreKey,
  V = CoreValue,
  T = CoreValue,
  OT = unknown,
> {
  serialize(encoder: Encoder<K, V, T>, options?: OT): void;
}
