---
layout: default
title: Ordering Items
nav_order: 8
---

# Ordering Items in [GoatDB](https://goatdb.dev)

[Order stamps](https://github.com/goatplatform/orderstamp-js) provide an
efficient way to maintain ordered lists in [GoatDB](https://goatdb.dev) using
string-based ordering. This guide explains how to use order stamps to manage
ordered collections of items.

## What are Order Stamps?

[Order stamps](https://github.com/goatplatform/orderstamp-js) are string values
that maintain their relative ordering when sorted lexicographically. They solve
the common problem of maintaining ordered lists in databases by:

1. Allowing O(1) insertions, deletions, and moves
2. Supporting concurrent operations
3. Maintaining consistent ordering across distributed systems
4. Working efficiently with standard database indexing

While [order stamps](https://github.com/goatplatform/orderstamp-js) can be used
with any database, they were originally created alongside
[GoatDB](https://goatdb.dev) and are designed to complement its
[architecture](/architecture) and [features](/concepts).

## API Reference

| Function    | Purpose                           | Use Case                                    |
| ----------- | --------------------------------- | ------------------------------------------- |
| `start()`   | Stamp for the start of the list   | Prepend [item](/concepts/#item)             |
| `end()`     | Stamp for the end of the list     | Append [item](/concepts/#item)              |
| `from()`    | Encode a number as an order stamp | Numeric ordering, custom keys               |
| `between()` | Stamp between two existing stamps | Insert between two [items](/concepts/#item) |

- **`start()`**: Returns a
  [stamp](https://github.com/goatplatform/orderstamp-js) for the start of the
  list, ensuring new [items](/concepts/#item) are ordered before existing ones.
- **`end()`**: Returns a [stamp](https://github.com/goatplatform/orderstamp-js)
  for the end of the list, ensuring new [items](/concepts/#item) are ordered
  after existing ones.
- **`from()`**: Encodes a numeric value (and optional key) as an
  [order stamp](https://github.com/goatplatform/orderstamp-js), maintaining
  numeric order in string form.
- **`between()`**: Generates a stamp lexicographically between two existing
  [stamps](https://github.com/goatplatform/orderstamp-js), for inserting between
  [items](/concepts/#item).

## Using Order Stamps in GoatDB

```typescript
import { Orderstamp } from '@goatdb/goatdb';

// Create a stamp at the start of the list
const firstStamp = Orderstamp.start();

// Create a stamp at the end of the list
const lastStamp = Orderstamp.end();

// Create a stamp between two existing stamps
const middleStamp = Orderstamp.between(prevStamp, nextStamp);

// Create a stamp from a numeric value (optional)
const numericStamp = Orderstamp.from(42);
```

When defining a schema for ordered items, add an `orderStamp` field:

```typescript
import { DataRegistry } from '@goatdb/goatdb';

const todoSchema = {
  ns: 'todo',
  version: 1,
  fields: {
    // This field stores an order stamp as a string
    orderStamp: {
      type: 'string',
      default: () => Orderstamp.end(),
    },
    title: {
      type: 'string',
      required: true,
    },
    completed: {
      type: 'boolean',
      default: () => false,
    },
  },
} as const;
```

### Inserting Items

To insert items in a specific order:

```typescript
// Insert at the beginning
db.create('/todos', todoSchema, {
  orderStamp: Orderstamp.start(),
  title: 'First item',
});

// Insert at the end
db.create('/todos', todoSchema, {
  orderStamp: Orderstamp.end(),
  title: 'Last item',
});

// Insert between two items
const firstItem = db.item('/todos/item1');
const lastItem = db.item('/todos/item2');

db.create('/todos', todoSchema, {
  orderStamp: Orderstamp.between(
    firstItem.get('orderStamp'),
    lastItem.get('orderStamp'),
  ),
  title: 'Middle item',
});
```

### Querying Ordered Items

To retrieve items in order:

```typescript
// Get all items in order
const query = db.query({
  source: '/todos',
  schema: todoSchema,
  sortBy: 'orderStamp',
});

// Get live results that update automatically
const todos = query.results();

// Listen for changes
query.onResultsChanged(() => {
  console.log('Todos updated:', query.results());
});
```

### Moving Items

To move an item to a new position:

```typescript
// Move an item between two others
function moveTodo(todoId: string, prevTodoId: string, nextTodoId: string) {
  const prevTodo = db.item(`/todos/${prevTodoId}`);
  const nextTodo = db.item(`/todos/${nextTodoId}`);
  const todo = db.item(`/todos/${todoId}`);
  const newOrderStamp = Orderstamp.between(
    prevTodo.get('orderStamp'),
    nextTodo.get('orderStamp'),
  );
  todo.set('orderStamp', newOrderStamp);
}
```

### Bulk Operations and String Growth

Repeated insertions using `between()` between two stamps can increase stamp
length. To manage this:

- Calling `start()` or `end()` repeatedly is always safe: Each call returns a
  valid boundary stamp, so you can use them as often as needed to prepend or
  append items. There is no risk of stamp growth or collision when using
  `start()` or `end()` multiple times.
- For many insertions **between the same two points** (i.e., using `between()`),
  use bulk allocation:

```typescript
// Inefficient (causes stamp growth):
let s = prev;
for (let i = 0; i < N; i++) {
  s = Orderstamp.between(s, next);
}

// Efficient
for (let i = 0; i < N; i++) {
  const stamp = Orderstamp.between(prev, next, N, i);
}

// Example: Bulk create todos with efficient order stamps (only needed for between())
function addMultipleTodos(titles: string[], prev: string, next: string) {
  for (let i = 0; i < titles.length; i++) {
    db.create('/todos', todoSchema, {
      orderStamp: Orderstamp.between(prev, next, titles.length, i),
      title: titles[i],
    });
  }
}

// Example: Repeatedly calling end() or start() is always safe
// (no risk of stamp growth or collision)
for (const title of ['A', 'B', 'C']) {
  db.create('/todos', todoSchema, {
    orderStamp: Orderstamp.end(), // Always safe to call repeatedly
    title,
  });
}

for (const title of ['X', 'Y', 'Z']) {
  db.create('/todos', todoSchema, {
    orderStamp: Orderstamp.start(), // Always safe to call repeatedly
    title,
  });
}
```

## Advanced Applications and Properties

Order stamps are not limited to single-list ordering—they enable a range of
advanced, composable data modeling patterns in distributed systems:

### Multiple Stamps per Item (Multi-List Ordering)

An item can participate in multiple independent ordered lists by maintaining a
mapping of order stamps, one per list context. For example:

```typescript
const kSchemaItem = {
  ns: 'item',
  version: 1,
  fields: {
    orderStamps: {
      type: 'map',
      default: () => new Map<string, string>(),
    },
    // ... other fields ...
  },
} as const;
```

Each key in the `orderStamps` map represents a list identifier (e.g., a board
column, playlist, or tag), and the corresponding value is the order stamp for
that list. This allows the same item to be independently ordered in any number
of lists. Moving or reordering the item in one list does not affect its position
in others. This pattern supports use cases such as shared tasks across projects,
cards in multiple Kanban columns, or items in several user-defined views.

### Filtering Preserves Relative Order

Order stamps guarantee that any subset of items, when sorted by their order
stamp, will maintain the same relative order as in the full list. This property
holds regardless of how the subset is selected (e.g., by filtering, searching,
or paginating). As a result, filtered or partial views (such as "only incomplete
tasks" or "items due this week") always present items in a consistent, globally
agreed order, without risk of reordering or ambiguity.

Importantly, when working with a filtered view, you can still move items
relative to each other within that filtered subset—such as reordering only the
incomplete tasks. When you do this, the order stamps of the moved items are
updated so that their relative order in the filtered view changes as intended.
However, these changes are reflected in the global, unfiltered list as well: the
moved items will appear in their new positions relative to each other, while
their position relative to items outside the filter (e.g., completed tasks) will
remain consistent with the overall order. This means that the global order
always "makes sense"—filtered items can be freely reordered among themselves,
and the unfiltered list will reflect those changes without breaking the overall
ordering logic.

## Conclusion

Order stamps provide a robust solution for maintaining ordered lists in GoatDB.
They offer excellent performance characteristics and work well in distributed
systems. By following the patterns outlined in this guide, you can implement
efficient ordered collections in your applications.
