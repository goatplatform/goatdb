---
permalink: /react/
layout: home
title: React
nav_order: 4
---

# GoatDB React Hooks

The hooks are built on top of GoatDB's core functionality, providing a more
ergonomic interface for React components. They handle all the complexity of data
[synchronization](/sync) and updates, making it easy to build reactive UIs that
work seamlessly both online and offline. For a full example, see the
[Tutorial](/tutorial).

## Hooks Overview

### `useDB()`

Initializes and returns the default GoatDB instance, handling storage and server
[synchronization](/sync) automatically. The hook also bootstraps the database by
setting up the storage backend and creating an initial connection to the server.
This ensures that the application is ready to interact with the database without
requiring additional setup steps. For more on storage and repositories, see
[Repositories](/repositories) and [Architecture](/architecture).

- **Behavior:**
  - Uses the native file system for storage (OPFS in browsers)
  - Synchronizes with the server in the background ([Synchronization](/sync))
  - Triggers re-renders when the current user changes
    ([Sessions and Users](/sessions))

- **Returns:** A `GoatDB` instance

**Example:**

```javascript
const db = useDB();
```

{: .note }

> The `useDB` hook maintains a single instance of the database throughout your
> application's lifecycle. All subsequent calls to `useDB` will return the same
> instance, ensuring consistent state management across your components. See
> [Concepts](/concepts) for more on the data model.

### `useDBReady()`

Monitors the database's loading state. Use it to manage your application's
initial loading screen. During this phase, the client loads locally stored data,
establishes a server connection, and initializes an anonymous session if
required. For more on sessions, see [Sessions and Users](/sessions).

- **Returns:**
  - `"loading"`: Database is initializing
  - `"ready"`: Database is fully loaded and synchronized
  - `"error"`: An error occurred during initialization

**Example:**

```javascript
function App() {
  const dbStatus = useDBReady();

  if (dbStatus === 'loading') {
    return <LoadingScreen />;
  } else if (dbStatus === 'error') {
    return <ErrorScreen message='Failed to load database.' />;
  }

  return <MainApp />;
}
```

{: .highlight }

> During the initial session setup, the client may require a network connection
> in order to download the initial copy of the history. Once this setup is
> complete, full offline functionality is supported. See
> [Synchronization](/sync) and [Repositories](/repositories) for more details.

### `useQuery()`

Creates a new query or retrieves an existing one. On first access, GoatDB
automatically loads the source repository either from the local disk or by
fetching it from the server. The hook triggers UI re-rendering whenever the
query results are updated, regardless of whether the changes originate from
local or remote edits. For advanced query usage, see [Querying Data](/query).

When a query is first opened, it performs a linear scan of its source using a
coroutine without blocking the main thread. During and after this initial scan,
the query caches its results to disk, allowing subsequent runs to resume
execution from the cached state. For more on the data model, see
[Concepts](/concepts) and [Reading and Writing Data](/read-write-data).

**Config Options:**

- **`schema`** _(required)_: Specifies the [schema](/schema) for the query
  results
- **`source`** _(required)_: Path to a [repository](/repositories) or another
  query instance
- **`predicate`** _(optional)_: Function to filter results
- **`sortDescriptor`** _(optional)_: Function to sort results
- **`ctx`** _(optional)_: Optional context for predicates and sort descriptors
- **`limit`** _(optional)_: Limits the number of results
- **`showIntermittentResults`** _(optional)_: If `true`, updates UI during
  initial scan

{: .highlight }

> GoatDB re-evaluates the entire query whenever any of its configuration values
> change, including:
>
> - The predicate function
> - The sort descriptor function
> - The context object
> - The source repository
> - The schema
>
> GoatDB internally calls `.toString()` on the passed functions to determine if
> they have changed. While you don't need to explicitly use `useCallback` or
> other memoization techniques, it's crucial that your predicate and sort
> functions are pure functions:
>
> - They should not modify any external state
> - They should not depend on values that can change between calls
> - They should not modify the items they receive
> - Use the `ctx` parameter to pass in any external values needed
>
> For more on query performance and best practices, see
> [Benchmarks](/benchmarks) and [FAQ](/faq).

**Example:**

```javascript
function TaskList() {
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
}
```

### `useItem()`

Monitors changes to a specific item, triggering a re-render whenever the item's
state changes. It returns a mutable `ManagedItem` instance that allows direct
modifications. Any changes to the item are automatically queued for background
commits and synchronized with the server. For more on items and managed items,
see [Reading and Writing Data](/read-write-data) and [Concepts](/concepts).

**Signatures:**

```typescript
useItem<S extends Schema>(...pathComps: string[]): ManagedItem<S> | undefined
useItem<S extends Schema>(path: string | undefined, opts: UseItemOpts): ManagedItem<S> | undefined
useItem<S extends Schema>(item: ManagedItem<S> | undefined, opts: UseItemOpts): ManagedItem<S> | undefined
```

- **Options:**
  - **`keys`** _(optional)_: Array of field names to track. Optimizes rendering
    by ignoring changes to other fields

**Example:**

```javascript
function TaskEditor({ path }) {
  const task = useItem(path, { keys: ['text'] });

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
}
```

{: .note }

> The `useItem` hook will automatically trigger a re-render when:
>
> - The item becomes available after loading
> - Any tracked field changes
> - The [schema](/schema) changes
> - The item is deleted or restored

## Best Practices

### Performance Optimization

1. **Pure Predicates:** Define predicate and sort functions as pure functions
   that:
   - Do not modify any external state
   - Do not depend on values that can change between calls
   - Do not modify the items they receive
   - Use the `ctx` parameter to pass in any external values needed

   ```javascript
   const userPredicate = ({ item, ctx }) =>
     item.get('active') && item.get('role') === ctx.roleFilter;
   ```

2. **Use `keys` with `useItem`:** When you only need to track specific fields,
   use the `keys` option to prevent unnecessary re-renders.

3. **Chain Queries:** For complex data transformations, chain queries together
   rather than performing multiple operations in a single query. See
   [Querying Data](/query).

### Error Handling

1. **Check for Undefined Items:** Always handle the case where `useItem` returns
   undefined, which can happen during initial loading or if the item doesn't
   exist.

2. **Monitor DB Ready State:** Use `useDBReady` to handle loading and error
   states gracefully. See [Sessions and Users](/sessions) and
   [Authorization](/authorization) for more on access control.

### Data Synchronization

1. **Background Writes:** All writes are processed asynchronously. The system
   batches changes and writes them to both local storage and remote servers in
   parallel. See [Synchronization](/sync).

2. **Offline Support:** GoatDB maintains a local copy of the database and
   synchronizes changes when the connection is restored. See
   [Architecture](/architecture) and [Repositories](/repositories).

## Technical Details

The React hooks are implemented using React's `useSyncExternalStore` to manage
subscriptions to database changes. This ensures efficient updates and proper
cleanup when components unmount.

- **Change Detection:** The hooks use GoatDB's mutation system to
  [track changes at the field level](/read-write-data/#mutations-tracking-changes),
  enabling precise updates.

- **Memory Management:** Resources are automatically cleaned up when components
  unmount, preventing memory leaks. See [Architecture](/architecture).

- **Concurrency:** The hooks handle concurrent updates gracefully, ensuring
  consistent state even when multiple components modify the same data. See
  [Commit Graph](/commit-graph).
