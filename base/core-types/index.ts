export type {
  Clonable,
  Comparable,
  ConcreteCoreValue,
  CoreArray,
  CoreClassObject,
  CoreDictionary,
  CoreKey,
  CoreObject,
  CoreOptions,
  CoreSet,
  CoreValue,
  CoreValueCloneOpts,
  Encodable,
  Encoder,
  Equatable,
  ReadonlyCoreArray,
  ReadonlyCoreObject,
} from './base.ts';

export { CoreType } from './base.ts';

export {
  getCoreType,
  getCoreTypeOrUndef,
  isReadonlyCoreObject,
} from './utils.ts';

export { coreValueClone } from './clone.ts';

export { coreValueCompare } from './comparable.ts';

export { coreValueEquals } from './equals.ts';
