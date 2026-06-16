import { getSystemInfo } from '../base/system-info.ts';
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { getRuntime } from '../base/runtime/index.ts';
import { withLogCapture } from './test-utils.ts';

function setEnvVar(key: string, value: string | undefined): void {
  if (getRuntime().id === 'deno') {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
    return;
  }
  if (value === undefined) {
    delete globalThis.process.env[key];
  } else {
    globalThis.process.env[key] = value;
  }
}

export default function setupSystemInfoTests(): void {
  TEST(
    'SystemInfo',
    'invalid GOATDB_SYSTEM_HARDWARE JSON logs ValidationError and falls back',
    async () => {
      const key = 'GOATDB_SYSTEM_HARDWARE';
      const prev = getRuntime().id === 'deno'
        ? Deno.env.get(key)
        : globalThis.process.env[key];
      setEnvVar(key, '{bad json');
      try {
        await withLogCapture(async (captured) => {
          const info = await getSystemInfo();
          assertEquals(info.runtime.runtime, getRuntime().id);
          assertTrue(info.hardware.storage.length > 0);
          assertTrue(
            captured.some((entry) =>
              entry.severity === 'WARNING' &&
              entry.error === 'ValidationError' &&
              entry.message ===
                '[GoatDB] Invalid JSON in GOATDB_SYSTEM_HARDWARE, ignoring'
            ),
            'invalid override must emit a ValidationError warning before falling back',
          );
        });
      } finally {
        setEnvVar(key, prev);
      }
    },
  );
}
