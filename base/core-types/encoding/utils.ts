import type { ConstructorDecoderConfig } from './types.ts';

export function isDecoderConfig<T extends ConstructorDecoderConfig<unknown>>(
  v: unknown,
): v is T {
  return v !== undefined && v !== null && Object.hasOwn(v, 'decoder');
}
