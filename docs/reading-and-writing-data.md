---
permalink: /read-write-data/
layout: default
title: Reading and Writing Data
nav_order: 3
---

# Reading and Writing Data in GoatDB

{: .highlight }

If you're writing UI code, we recommend using the [React Hooks](/react) instead
of working with ManagedItems directly. The hooks provide a more ergonomic
interface for React components and handle all the complexity of data
synchronization and updates.

GoatDB's data model is built around three key concepts: Items, Managed Items,
and the GoatDB API. Together, they provide a robust system for working with data
that's both efficient and reliable.

## The Data Model

### Items: The Foundation

At its core, GoatDB uses `Item` objects to represent data. An `Item` combines
data with its schema definition and can be either mutable or immutable depending
on its lock state. This design provides flexibility while maintaining data
integrity.

```typescript
// Create a new mutable item
const item = new Item({
  schema: mySchema,
  data: { name: 'Example', value: 42 },
});

// Items can be locked to make them immutable
item.lock();
```

{: .note }

Items are typically locked when they represent a specific version in history,
ensuring that historical data remains unchanged. Unlocked items can be modified
directly, though this is mostly used internally. Most user code will work with
ManagedItems instead, which provide a more convenient interface for data
manipulation.

### Managed Items: The Live Interface

`ManagedItem` provides a high-level interface for working with data. It
maintains an in-memory, mutable Item and handles synchronization with both local
storage and remote peers.

```typescript
// Get a managed item
const managedItem = db.item('/path/to/item');

// Changes are immediately reflected in memory
managedItem.set('name', 'New Name');
```

{: .note }

ManagedItem maintains an in-memory, mutable Item that can be modified directly.
In the background, it periodically computes diffs to track changes and
synchronize them with both local storage and remote peers. When remote changes
are received, they are merged back into the in-memory Item. This design provides
immediate local updates while ensuring eventual consistency across all peers.

## Working with Data

### Reading Data

Reading data is straightforward with ManagedItem:

```typescript
const item = db.item('/path/to/item');

// Get a field value
const name = item.get('name');

// Check field existence
if (item.has('optionalField')) {
  // Handle optional field
}

// Get all available fields
const fields = item.keys;
```

### Writing Data

Writing data is equally simple, but there's more happening behind the scenes:

```typescript
// Single field update
item.set('name', 'New Name');

// Multiple fields at once
item.setMulti({
  name: 'New Name',
  value: 100,
});

// Delete a field
item.delete('optionalField');
```

{: .note }

All writes are processed asynchronously. The system batches changes and writes
them to both local storage and remote servers in parallel for maximum
performance.

### Item Lifecycle: Creation and Deletion

Creating new items is done through the GoatDB API:

```typescript
// Create with initial data
const newItem = db.create('/path/to/item', schema, {
  name: 'Initial Name',
  data: {
    foo: 'bar',
  },
});

// Create empty item
const emptyItem = db.create('/path/to/item', schema);
```

Items can be marked for deletion using the `isDeleted` property:

```typescript
// Mark an item for deletion
item.isDeleted = true;

// Restore a deleted item
item.isDeleted = false;
```

{: .note }

Deletion in GoatDB is soft-delete by default. Items marked as deleted are not
immediately removed but are instead hidden from queries and prepared for future
garbage collection. This design allows for easy recovery of accidentally deleted
items and maintains data history.

### Ensuring Data Durability

While GoatDB handles writes efficiently in the background, you can force
persistence when needed:

```typescript
// Wait for writes to complete for a specific repository
await db.flush('/path/to/repo');

// Or flush all repositories
await db.flushAll();
```

{: .highlight }

The `flush()` operation should be used sparingly as it can impact performance.
The system is designed to handle writes efficiently in the background, and
forcing immediate persistence is typically only needed in specific scenarios
like application shutdown or critical data updates.

## Change Notifications

ManagedItems emit change events that you can listen to:

```typescript
item.on('change', (mutations) => {
  // mutations contain the changes that occurred
  console.log('Item changed:', mutations);
});
```

## Mutations: The Low-Level Change API

Under the hood, GoatDB uses a mutation system to track changes to items. A
mutation represents a single field change and contains three pieces of
information:

```typescript
type Mutation = [
  field: string, // The field name that changed
  local: boolean, // Whether this is a local or remote change
  oldValue: CoreValue, // The old value before the change
];
```

Mutations are typically used in batches (MutationPack) to represent multiple
changes:

```typescript
// Example mutation pack
const changes = [
  ['name', true, 'New Name'],
  ['value', true, 42],
];
```

{: .highlight }

While you can work with mutations directly, it's generally easier to use the
higher-level ManagedItem API (`set()`, `delete()`, etc.). The mutation system is
primarily used internally for change tracking and synchronization and for
constructing higher level APIs like the [React Hooks](/react).

{: .note }

> The inclusion of the old value in mutations makes it easy to implement
> features like:
>
> - Animating transitions between old and new values
> - Computing diffs for undo/redo operations
> - Tracking change history

## Data Validation

GoatDB provides built-in validation:

```typescript
// Check validity
if (!item.isValid) {
  const [valid, error] = item.validate();
  console.error('Validation failed:', error);
}
```
