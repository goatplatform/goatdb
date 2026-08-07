import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { dictEquals } from '../base/collections/dict.ts';
import { HashMap, HashSet } from '../base/collections/hash-map.ts';

function constantHash(): string {
  return 'constant';
}

function stringsEqual(a: string, b: string): boolean {
  return a === b;
}

function createHashMap(): HashMap<string, number> {
  return new HashMap(constantHash, stringsEqual);
}

export default function setup() {
  TEST('HashMap', 'counts colliding HashSet values through mutations', () => {
    const set = new HashSet(constantHash, stringsEqual);

    assertTrue(set.add('a'));
    assertTrue(set.add('b'));
    assertEquals(set.size, 2);
    assertTrue(!set.add('a'));
    assertEquals(set.size, 2);
    assertTrue(set.delete('a'));
    assertEquals(set.size, 1);
    assertTrue(!set.has('a'));
    assertTrue(set.has('b'));
    assertTrue(!set.delete('missing'));
    assertEquals(set.size, 1);
    assertTrue(set.delete('b'));
    assertEquals(set.size, 0);
    assertTrue(set.add('b'));
    assertEquals(set.size, 1);
    set.clear();
    assertEquals(set.size, 0);
  });

  TEST(
    'HashMap',
    'counts colliding entries through updates and removals',
    () => {
      const map = createHashMap();
      map.set('a', 1);
      map.set('b', 2);
      assertEquals(map.size, 2);
      map.set('b', 3);
      assertEquals(map.size, 2);
      assertEquals(map.get('b'), 3);
      assertTrue(map.delete('a'));
      assertEquals(map.size, 1);
      assertTrue(!map.has('a'));
      assertEquals(map.get('b'), 3);
      assertTrue(map.delete('b'));
      assertEquals(map.size, 0);
      map.set('b', 4);
      assertEquals(map.size, 1);
      assertEquals(map.get('b'), 4);
      map.clear();
      assertEquals(map.size, 0);
    },
  );

  TEST(
    'HashMap',
    'uses colliding entry cardinality for dictionary equality',
    () => {
      const one = createHashMap();
      one.set('a', 1);
      one.set('b', 2);

      const two = createHashMap();
      two.set('b', 2);
      two.set('a', 1);

      const different = createHashMap();
      different.set('a', 1);
      different.set('b', 3);

      const fewer = createHashMap();
      fewer.set('a', 1);

      assertTrue(dictEquals(one, two));
      assertTrue(!dictEquals(one, different));
      assertTrue(!dictEquals(one, fewer));
      assertTrue(!dictEquals(fewer, one));
    },
  );

  TEST('HashMap', 'compares non-colliding maps correctly', () => {
    const one = new HashMap((key: string) => key, stringsEqual);
    one.set('a', 1);

    const two = new HashMap((key: string) => key, stringsEqual);
    two.set('a', 1);

    assertTrue(dictEquals(one, two));
  });
}
