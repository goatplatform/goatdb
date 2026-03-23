import { TEST } from './mod.ts';
import { BloomFilter } from '../base/bloom.ts';
import { assertTrue } from './asserts.ts';

export default function setup() {
  TEST('BloomFilter', 'basic add and has', () => {
    const bf = new BloomFilter({ size: 100, fpr: 0.01 });
    bf.add('hello');
    bf.add('world');
    assertTrue(bf.has('hello'), 'should contain "hello"');
    assertTrue(bf.has('world'), 'should contain "world"');
    assertTrue(!bf.has('missing'), 'should not contain "missing"');
  });
}
