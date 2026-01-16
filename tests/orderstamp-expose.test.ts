import { assertTrue } from './asserts.ts';
import { TEST } from './mod.ts';
import * as Orderstamp from '@goatdb/orderstamp';

export default function setup(): void {
  TEST('Orderstamp', 'Orderstamp API is exposed', () => {
    assertTrue(typeof Orderstamp === 'object');
    assertTrue(typeof Orderstamp.start === 'function');
    assertTrue(typeof Orderstamp.end === 'function');
    assertTrue(typeof Orderstamp.from === 'function');
    assertTrue(typeof Orderstamp.between === 'function');
  });

  TEST('Orderstamp', 'Orderstamp basic usage', () => {
    const s = Orderstamp.start();
    const e = Orderstamp.end();
    const f = Orderstamp.from(42);
    const b = Orderstamp.between(s, e);
    assertTrue(typeof s === 'string');
    assertTrue(typeof e === 'string');
    assertTrue(typeof f === 'string');
    assertTrue(typeof b === 'string');
    assertTrue(s < e);
    assertTrue(s < b && b < e);
  });

  TEST('Orderstamp', 'Orderstamp between is monotonic', () => {
    const s = Orderstamp.start();
    const e = Orderstamp.end();
    const b1 = Orderstamp.between(s, e);
    const b2 = Orderstamp.between(s, b1);
    const b3 = Orderstamp.between(b1, e);
    assertTrue(s < b2 && b2 < b1 && b1 < b3 && b3 < e);
  });
}
