/** SEA-safe lazy runtime import with an explicit cache lifecycle. */
export interface LazyModule<T> {
  get(): Promise<T>;
  loaded(): T | undefined;
  clear(): void;
}

export function lazyModule<T>(specifier: string): LazyModule<T> {
  let module: T | undefined;
  return {
    async get(): Promise<T> {
      if (!module) {
        const dynamicSpecifier = specifier;
        module = await import(dynamicSpecifier) as T;
      }
      return module;
    },
    loaded: () => module,
    clear: () => module = undefined,
  };
}

export function moduleExport<T>(
  module: Record<string, unknown>,
  name: string,
  packageName: string,
): T {
  const value = module[name] ?? module.default;
  if (!value) {
    throw new Error(
      `${packageName} is missing the expected '${name}' export.`,
    );
  }
  return value as T;
}
