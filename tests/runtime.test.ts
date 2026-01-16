import { TEST } from './mod.ts';
import { assertTrue, assertEquals } from './asserts.ts';
import {
  getRuntime,
  getRegisteredAdapters,
  clearRuntimeCache,
} from '../base/runtime/index.ts';

export default function setupRuntimeTests(): void {
  // I-001: Runtime Detection Caching
  TEST('Runtime', 'getRuntime returns cached instance (I-001)', () => {
    clearRuntimeCache();
    const first = getRuntime();
    const second = getRuntime();
    const third = getRuntime();
    assertTrue(
      first === second,
      'Second call should return same object reference',
    );
    assertTrue(
      second === third,
      'Third call should return same object reference',
    );
  });

  // I-002: TestConfig Always Present
  TEST('Runtime', 'testConfig is always present (I-002)', () => {
    const adapter = getRuntime();
    assertTrue(
      adapter.testConfig !== undefined,
      'testConfig should be defined',
    );
    assertTrue(
      typeof adapter.testConfig.cleanupDelayMs === 'number',
      'cleanupDelayMs should be a number',
    );
    assertTrue(
      adapter.testConfig.cleanupDelayMs >= 0,
      'cleanupDelayMs should be >= 0',
    );
    assertTrue(
      typeof adapter.testConfig.supportsHttpServer === 'boolean',
      'supportsHttpServer should be a boolean',
    );
    assertTrue(
      typeof adapter.testConfig.dbDefaults === 'object' &&
        adapter.testConfig.dbDefaults !== null,
      'dbDefaults should be an object',
    );
  });

  // C-001: Registration Order
  TEST('Runtime', 'adapters registered in correct order (C-001)', () => {
    const adapters = getRegisteredAdapters();
    assertTrue(adapters.length >= 3, 'Should have at least 3 adapters');
    assertEquals(adapters[0].id, 'deno', 'First adapter should be Deno');
    assertEquals(adapters[1].id, 'browser', 'Second adapter should be Browser');
    assertEquals(adapters[2].id, 'node', 'Third adapter should be Node');
  });

  // I-003: testConfig is frozen
  TEST('Runtime', 'testConfig is frozen (I-003)', () => {
    const adapter = getRuntime();
    assertTrue(
      Object.isFrozen(adapter.testConfig),
      'testConfig should be frozen',
    );
  });
}
