import { Item } from '../cfds/base/item.ts';
import { SchemaGetFieldDef } from '../cfds/base/schema.ts';
import { assertEquals, assertThrows, expectToContain } from './asserts.ts';
import { TEST } from './mod.ts';

const kRuntimeKeySchema = {
  ns: 'schema-runtime-keys',
  version: 1,
  fields: {
    title: { type: 'string', required: true },
  },
} as const;

export default function setup(): void {
  TEST(
    'SchemaRuntimeKeys',
    'built-in runtime fields are typed and accessible',
    () => {
      const item = new Item({
        schema: kRuntimeKeySchema,
        data: { title: 'hello' },
      });

      assertEquals(
        SchemaGetFieldDef(kRuntimeKeySchema, 'isDeleted')?.type,
        'boolean',
      );
      assertEquals(item.get('isDeleted'), undefined);
      assertEquals(item.has('isDeleted'), false);
      expectToContain([...item.keys], 'title');

      item.set('isDeleted', true);

      assertEquals(item.get('isDeleted'), true);
      assertEquals(item.has('isDeleted'), true);
      expectToContain([...item.keys], 'isDeleted');
    },
  );

  TEST(
    'SchemaRuntimeKeys',
    'delete removes built-in runtime fields from item state',
    () => {
      const item = new Item({
        schema: kRuntimeKeySchema,
        data: { title: 'hello' },
      });

      // Set isDeleted first
      item.set('isDeleted', true);
      assertEquals(item.get('isDeleted'), true);
      assertEquals(item.has('isDeleted'), true);
      expectToContain([...item.keys], 'isDeleted');

      // Delete isDeleted field
      const deleted = item.delete('isDeleted');
      assertEquals(deleted, true);
      assertEquals(item.get('isDeleted'), undefined);
      assertEquals(item.has('isDeleted'), false);

      // Verify keys array no longer contains isDeleted
      const keys = [...item.keys];
      assertEquals(keys.includes('isDeleted'), false);
      expectToContain(keys, 'title');
    },
  );

  TEST(
    'SchemaRuntimeKeys',
    'delete returns false for non-existent fields',
    () => {
      const item = new Item({
        schema: kRuntimeKeySchema,
        data: { title: 'hello' },
      });

      // isDeleted never set, delete should return false
      const deleted = item.delete('isDeleted');
      assertEquals(deleted, false);
      assertEquals(item.get('isDeleted'), undefined);
    },
  );

  TEST(
    'SchemaRuntimeKeys',
    'delete rejects unknown field names at runtime',
    () => {
      const item = new Item({
        schema: kRuntimeKeySchema,
        data: { title: 'hello' },
      });

      assertThrows(
        () => item.delete('nonexistentField'),
        "Unknown field name 'nonexistentField'",
      );
    },
  );
}
