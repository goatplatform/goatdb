---
id: reading-and-writing-data
title: Reading and Writing Data
sidebar_position: 3
slug: /read-write-data
---


# Reading and Writing Data in GoatDB

:::tip

If you're writing UI code, we recommend using the [React Hooks](/docs/react) instead
of working with ManagedItems directly. The hooks provide a more ergonomic
interface for [React](/docs/react) components and handle all the complexity of data
[synchronization](/docs/sync) and updates.

:::

## Overview

[GoatDB](/) provides a flexible and powerful system for managing data in your
application. This guide will walk you through the core concepts and show you how
to effectively [read and write data](/docs/read-write-data).

The data model is built around three key [concepts](/docs/concepts):

1. [**Items**](/docs/concepts#item): The basic building blocks that store your data
2. [**Managed Items**](/docs/concepts/#manageditem): A higher-level interface that
   handles data synchronization
3. [**Repositories**](/docs/concepts#repository): The fundamental unit of data
   organization, managing collections of related items

Think of [Items](/docs/concepts#item) as the raw data containers,
[Managed Items](/docs/concepts#manageditem) as smart wrappers that handle data
[synchronization](/docs/sync) and updates, and [Repositories](/docs/concepts#repository)
as the containers that organize and store collections of related
[Items](/docs/concepts#item) efficiently and [durably](/docs/repositories/#durability).

## The Data Model

### Items: The Foundation

At its core, GoatDB uses [Items](/docs/concepts#item) to represent data. An
[Item](/docs/concepts#item) combines data with its [schema](/docs/schema) definition and
can be either mutable or immutable depending on its lock state. This design
provides flexibility while maintaining data integrity.

:::note

For information about schemas and how to define them, see the
[Schema documentation](/docs/schema).

:::

### Managed Items: The Live Interface

[ManagedItem](/docs/concepts#manageditem) provides a high-level interface for working
with data. It maintains an in-memory, mutable Item and handles
[synchronization](/docs/sync) with both local storage and remote peers.

Here's how you typically work with [Managed Items](/docs/concepts#manageditem):

```typescript
// Get a managed item (creates one if it doesn't exist)
const userProfile = db.item('/users/john/profile');

// Changes are immediately reflected in memory
userProfile.set('name', 'John Smith');

// The changes will be automatically synchronized
// with other parts of your application
```

:::note

[ManagedItem](/docs/concepts#manageditem) maintains an in-memory, mutable
[Item](/docs/concepts#item) that can be modified directly. In the background, it
periodically computes diffs to track changes and [synchronize](/docs/sync) them with
both local storage and remote peers. When remote changes are received, they are
merged back into the in-memory Item. This [design](/docs/architecture) provides
immediate local updates while ensuring eventual consistency across all peers.

:::

## Working with Data

### Reading Data

Reading data is straightforward with [ManagedItem](/docs/concepts#manageditem). Here
are some common patterns:

```typescript
// Get a specific item
const userSettings = db.item('/users/john/settings');

// Get a field value
const theme = userSettings.get('theme');

// Check if a field exists
if (userSettings.has('notifications')) {
  const notifications = userSettings.get('notifications');
}

// Get all available fields
const allSettings = userSettings.keys;

// Example: Reading nested data
const preferences = userSettings.get('preferences');
const language = preferences?.language;
```

### Writing Data

Writing data is equally simple, but there's more happening behind the scenes:

```typescript
const userProfile = db.item('/users/john/profile');

// Single field update
userProfile.set('name', 'John Smith');

// Multiple fields at once
userProfile.setMulti({
  name: 'John Smith',
  age: 31,
  email: 'john.smith@example.com',
});

// Delete a field
userProfile.delete('email');

// Example: Updating nested data
userProfile.set('theme', 'dark');
```

:::note

All writes are processed asynchronously. The system batches changes and writes
them to both local storage and remote servers in parallel for maximum
performance.

:::

### Item Lifecycle: Creation and Deletion

Creating new items is done through the GoatDB API:

```typescript
// Create with initial data
const newTodo = db.create('/todos/work', {
  title: 'Finish documentation',
  completed: false,
  dueDate: '2024-03-15',
});

// Create empty item
const emptyTodo = db.create('/todos/personal');
```

Items can be marked for deletion using the `isDeleted` property:

```typescript
// Mark an item for deletion
todoItem.isDeleted = true;

// Restore a deleted item
todoItem.isDeleted = false;
```

:::note

Deletion in GoatDB is soft-delete by default. [Items](/docs/concepts#item) marked as
deleted are not immediately removed but are instead hidden from
[queries](/docs/query) and prepared for future
[garbage collection](/docs/architecture/#garbage-collection). This design allows for
easy [recovery](/docs/repositories/#durability) of accidentally deleted items and
maintains data history.

:::

### Ensuring Data Durability

While [GoatDB](/) handles writes efficiently in the background, you can force
persistence when needed:

```typescript
// Wait for writes to complete for a specific repository
await db.flush('/todos/personal');

// Or flush all repositories
await db.flushAll();
```

:::tip

The `flush()` operation should be used sparingly as it can impact
[performance](/docs/benchmarks). The system is designed to handle writes efficiently
in the background, and forcing immediate persistence is typically only needed in
specific scenarios like application shutdown or critical data updates.

:::

## Change Notifications

[ManagedItems](/docs/concepts#manageditem) emit change events that you can listen to:

```typescript
const todoItem = db.item('/todos/work/1');

todoItem.on('change', (mutations) => {
  // mutations contain the changes that occurred
  console.log('Todo changed:', mutations);

  // Example: Update UI based on changes
  mutations.forEach(([field, isLocal, oldValue]) => {
    if (field === 'completed') {
      updateCheckbox(oldValue);
    }
  });
});
```

## Mutations: Tracking Changes

[GoatDB](/) uses a mutation system to track changes to items. While you'll
typically use the higher-level [ManagedItem](/docs/concepts#manageditem) API
(`set()`, `delete()`, etc.), understanding mutations can be helpful for advanced
use cases.

A mutation represents a single field change and contains:

- The field name that changed
- Whether the change was made locally or received from a remote peer
- The old value before the change

Here's a practical example of how mutations work:

```typescript
const todoItem = db.item('/todos/work/1');

// When you make a change
todoItem.set('title', 'New Task');

// Behind the scenes, a mutation is created:
const mutation = ['title', true, 'Old Task'];

// You can listen to these changes
todoItem.on('change', (mutations) => {
  mutations.forEach(([field, isLocal, oldValue]) => {
    console.log(`${field} changed from ${oldValue}`);
  });
});
```

:::note

The mutation system is primarily used internally for change tracking and
synchronization. Most applications will use the higher-level
[ManagedItem](/docs/concepts#manageditem) API or [React Hooks](/docs/react) instead of
working with mutations directly.

:::

## Data Validation

[GoatDB](/) automatically validates all data changes to maintain data integrity.
When you try to set invalid data:

```typescript
const userProfile = db.item('/users/john/profile');

// Try to set invalid data
userProfile.set('age', 150); // This will be rejected if age > 120 in the schema

// The invalid value will temporarily appear in memory
console.log(userProfile.get('age')); // Shows 150 temporarily

// But it won't be persisted to storage or synchronized with the network
```

:::note

Validation rules are defined in your [schema](/docs/schema). GoatDB uses these rules
to automatically prevent invalid data from being persisted or
[synchronized](/docs/sync), ensuring your data always meets the defined constraints.

:::
