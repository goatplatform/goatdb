---
permalink: /react/
layout: home
title: React
nav_order: 4
---

# GoatDB React Hooks

- [GoatDB React Hooks](#goatdb-react-hooks)
  - [Hook Overview](#hook-overview)
    - [`useDB()`](#usedb)
    - [`useDBReady()`](#usedbready)
    - [`useQuery()`](#usequery)
    - [`useItem()`](#useitem)

GoatDB React hooks provide a streamlined way to integrate the database into your
applications by abstracting state management, synchronization, and persistence.
These hooks manage real-time updates and offline capabilities, enabling you to
focus on application logic without worrying about network complexities.

GoatDB computes diffs in the background based on the in-memory state, allowing
you to work directly with native, mutable, JavaScript objects. This approach
keeps the API simple and intuitive, especially if you're already familiar with
common state management tools.

The fundamental unit of data in GoatDB is an `Item`, which represents a snapshot
of a specific data point at a given time. This snapshot is encapsulated by a
`ManagedItem` instance, providing a mutable in-memory representation of the
item's state. Any modifications made to this in-memory state automatically
trigger the creation of a background commit, which is then stored on the local
disk and synchronized with the server. This state management system seamlessly
handles local and remote edits, synchronization, and data persistence without
requiring additional configuration.

## Hook Overview

### `useDB()`

Initializes and returns the default GoatDB instance, handling storage and server
synchronization automatically. The hook also bootstraps the database by setting
up the storage backend and creating an initial connection to the server. This
ensures that the application is ready to interact with the database without
requiring additional setup steps.

- **Behavior:**

  - Uses the Origin Private File System (OPFS) for storage.
  - Synchronizes with the server in the background.

- **Returns:** A `GoatDB` instance.

**Example:**

```javascript
const db = useDB();
```

### `useDBReady()`

Monitors the database's loading state. Use it to manage your application's
initial loading screen. During this phase, the client loads locally stored data,
establishes a server connection, and initializes an anonymous session if
required.

NOTE: During the initial session setup, the client requires a network
connection. Once this setup is complete, full offline functionality is
supported.

- **Returns:**
  - `"loading"`: Database is initializing.
  - `"ready"`: Database is fully loaded and synchronized.
  - `"error"`: An error occurred during initialization.

**Example:**

```javascript
// Monitor database loading status
const dbStatus = useDBReady();

if (dbStatus === 'loading') {
  return <LoadingScreen />;
} else if (dbStatus === 'error') {
  return <ErrorScreen message='Failed to load database.' />;
}

return <MainApp />;
```

### `useQuery()`

Creates a new query or retrieves an existing one. On first access, GoatDB
automatically loads the source repository either from the local disk or by
fetching it from the server. The hook triggers UI re-rendering whenever the
query results are updated, regardless of whether the changes originate from
local or remote edits.

When a query is first opened, it performs a linear scan of its source without
blocking the main UI thread. This operation uses a coroutine that runs on the
main thread. During and after this initial scan, the query caches its results to
disk, allowing subsequent runs to resume execution from the cached state. For
additional details, refer to the query mechanism documentation.

**Signature:**

```javascript
useQuery(config) => Query
```

- **Config Options:**
  - **`schema`** _(required)_: Specifies the schema(s) for the query results.
  - **`source`** _(required)_: Path to a repository or another query instance.
    Queries can be chained for lightweight indexing.
  - **`predicate`** _(optional)_: Function to filter results. Receives each item
    and returns `true` or `false`.
  - **`sortDescriptor`** _(optional)_: Function to sort results. Receives two
    items and returns a comparison value.
  - **`ctx`** _(optional)_: Optional context for predicates and sort
    descriptors. Changes in context re-trigger the query.
  - **`limit`** _(optional)_: Limits the number of results. Enables query
    optimizations.
  - **`showIntermittentResults`** _(optional)_: If `true`, updates UI during the
    initial scan. If `false`, waits until scanning is complete.

**Example:**

```javascript
// Query tasks from the database
const tasksQuery = useQuery({
  schema: taskSchema,
  source: '/data/tasks',
  sortDescriptor: (a, b) => a.get('text').localeCompare(b.get('text')),
  predicate: (item) => !item.get('done'),
  showIntermittentResults: true,
});

return (
  <ul className='task-list'>
    {tasksQuery.results().map((task) => (
      <li key={task.path}>{task.get('text')}</li>
    ))}
  </ul>
);
```

### `useItem()`

The `useItem` hook is available in three convenience forms and monitors changes
to a specific item, triggering a re-render whenever the item's state changes. It
returns a mutable `ManagedItem` instance that allows direct modifications. Any
changes to the item are automatically queued for background commits and
synchronized with the server. Similar to the `useQuery` hook, `useItem` reacts
to both local and remote updates.

**Signatures:**

```javascript
useItem(pathComponents...) => ManagedItem | undefined
useItem(fullPath, opts) => ManagedItem | undefined
useItem(opts, pathComponents...) => ManagedItem | undefined
```

- **Options:**

  - **`keys`** _(optional)_: Array of field names to track. Optimizes rendering
    by ignoring changes to other fields.

- **Returns:** A mutable `ManagedItem` instance. Changes to the item
  automatically schedule commits and synchronization in the background. Returns
  undefined if the item hadn't been created or loaded yet.

**Example:**

```javascript
// Access and manage a specific task
const task = useItem('/data/tasks/123', { keys: ['text'] });

if (!task) {
  return <div>Loading task...</div>;
}

return (
  <div className='task-editor'>
    <label htmlFor='task-text'>Task:</label>
    <input
      id='task-text'
      type='text'
      value={task.get('text')}
      onChange={(e) => task.set('text', e.target.value)}
    />
  </div>
);
```
