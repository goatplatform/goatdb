import { TEST } from './mod.ts';
import { BloomFilter } from '../base/bloom.ts';
import { uniqueId } from '../base/common.ts';
import { assertTrue } from './asserts.ts';

export default function setup() {
  TEST('BloomFPR', 'observed FPR within bounds (fpr=0.01)', () => {
    const insertCount = 1000;
    const queryCount = 10000;
    const bf = new BloomFilter({ size: insertCount, fpr: 0.01 });

    const inserted = new Set<string>();
    while (inserted.size < insertCount) {
      inserted.add(uniqueId());
    }
    bf.add(inserted);

    let falsePositives = 0;
    for (let i = 0; i < queryCount; i++) {
      const id = uniqueId() + '-q';
      if (!inserted.has(id) && bf.has(id)) {
        falsePositives++;
      }
    }

    const fpr = falsePositives / queryCount;
    assertTrue(
      fpr >= 0.002 && fpr <= 0.025,
      `FPR ${fpr.toFixed(4)} out of expected range [0.002, 0.025]`,
    );
  });

  TEST('BloomFPR', 'observed FPR within bounds (fpr=0.001)', () => {
    const insertCount = 1000;
    const queryCount = 100000;
    const bf = new BloomFilter({ size: insertCount, fpr: 0.001 });

    const inserted = new Set<string>();
    while (inserted.size < insertCount) {
      inserted.add(uniqueId());
    }
    bf.add(inserted);

    let falsePositives = 0;
    for (let i = 0; i < queryCount; i++) {
      const id = uniqueId() + '-q';
      if (!inserted.has(id) && bf.has(id)) {
        falsePositives++;
      }
    }

    const fpr = falsePositives / queryCount;
    assertTrue(
      fpr >= 0.0001 && fpr <= 0.005,
      `FPR ${fpr.toFixed(5)} out of expected range [0.0001, 0.005]`,
    );
  });

  TEST('BloomFPR', 'zero false negatives', () => {
    const insertCount = 500;
    const bf = new BloomFilter({ size: insertCount, fpr: 0.01 });

    const ids: string[] = [];
    for (let i = 0; i < insertCount; i++) {
      ids.push(uniqueId());
    }
    bf.add(ids);

    for (const id of ids) {
      assertTrue(bf.has(id), `False negative for inserted id: ${id}`);
    }
  });

  TEST('BloomFPR', 'empty filter has no false positives', () => {
    const bf = new BloomFilter({ size: 1000, fpr: 0.01 });

    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      if (bf.has(uniqueId())) {
        hits++;
      }
    }

    assertTrue(hits === 0, `Expected 0 hits on empty filter, got ${hits}`);
  });

  TEST('BloomFPR', 'clear resets completely', () => {
    const insertCount = 200;
    const bf = new BloomFilter({ size: insertCount, fpr: 0.01 });

    const ids: string[] = [];
    for (let i = 0; i < insertCount; i++) {
      ids.push(uniqueId());
    }
    bf.add(ids);

    // Verify items are present before clear
    for (const id of ids) {
      assertTrue(bf.has(id), `Item should be present before clear`);
    }

    bf.clear();

    // After clear, all previously inserted items should return false
    let hits = 0;
    for (const id of ids) {
      if (bf.has(id)) {
        hits++;
      }
    }

    assertTrue(hits === 0, `Expected 0 hits after clear, got ${hits}`);
  });
}
