---
id: query
title: Querying Data
sidebar_position: 4
slug: /query
---


# Querying Data in GoatDB

:::tip

If you're building a [React](/docs/react) UI, we recommend using the
[React Hooks](/docs/react) instead of working with [queries](/docs/query) directly. The
[hooks](/docs/react) provide a more ergonomic interface for [React](/docs/react)
components and handle all the complexity of data [synchronization](/docs/sync) and
updates.

:::

GoatDB's query system provides real-time, efficient access to your data with
automatic updates as the underlying data changes. Queries can be chained
together, sorted, and used as lightweight ad-hoc indexes for fast lookups.

## Basic Query Usage

### Creating a Query

The simplest way to create a query is through the database's `query()` method:

```typescript
// Find all users with admin role
const adminUsers = db.query({
  source: '/sys/users',
  schema: kSchemaUser,
  predicate: ({ item }) => item.get('role') === 'admin',
});

// Wait for initial results
await adminUsers.loadingFinished();

// Get the results
const results = adminUsers.results();
```

:::tip

Predicate and sort functions must be
[pure functions](https://en.wikipedia.org/wiki/Pure_function):

- They should not modify any external state
- They should not depend on values that can change between calls
- They should not modify the items they receive (items are locked)
- Use the `ctx` parameter to pass in any external values needed

:::

### Query Instance Reuse

When you create a query using `db.query()`, GoatDB
[maintains a cache](#technical-details) of open queries. If you create another
query with the same configuration (same source, predicate, sort, etc.), you'll
get back the same query instance:

```typescript
// First query
const query1 = db.query({
  source: '/sys/users',
  schema: kSchemaUser,
  predicate: ({ item }) => item.get('role') === 'admin',
});

// Second query with same config - returns same instance
const query2 = db.query({
  source: '/sys/users',
  schema: kSchemaUser,
  predicate: ({ item }) => item.get('role') === 'admin',
});

console.log(query1 === query2); // true
```

This instance reuse is efficient because:

- It prevents duplicate work when multiple parts of your app need the same query
- It ensures all consumers see the same results
- It maintains a single source of truth for the query's state

### Closing Queries

Queries remain open and track updates until explicitly closed. When you're done
with a query, you should close it to free up resources:

```typescript
const query = db.query({
  source: '/sys/users',
  schema: kSchemaUser,
});

// Use the query...

// When done, close it
query.close();
```

:::tip

Always close queries when you're done with them to prevent memory leaks and
unnecessary resource usage.

:::

### Filtering Data

Queries use predicate functions to filter data. The predicate receives an item
and returns true if the item should be included in the results. Predicates must
be pure functions - they should not modify any external state or depend on
values that can change between calls. Instead, use the `ctx` parameter to pass
in any external values needed for the predicate:

```typescript
// Find overdue tasks using the current date from context
const overdueTasks = db.query({
  source: '/data/tasks',
  schema: kSchemaTask,
  ctx: { now: new Date() }, // Pass current date in context
  predicate: ({ item, ctx }) => {
    const dueDate = item.get('dueDate');
    return dueDate < ctx.now && !item.get('completed');
  },
});
```

### Sorting Results

Queries can be sorted by a field name or using a custom sort function. Sort
functions must be
[pure functions](https://en.wikipedia.org/wiki/Pure_function) - they should not
modify any external state or depend on values that can change between calls.
Instead, use the `ctx` parameter to pass in any external values needed:

```typescript
// Sort by field name
const usersByEmail = db.query({
  source: '/sys/users',
  schema: kSchemaUser,
  sortBy: 'email', // Sort by email field values
});

// Custom sort function
const usersByLastFirst = db.query({
  source: '/sys/users',
  schema: kSchemaUser,
  sortBy: ({ left, right }) => {
    const lastNameCompare = left.get('lastName').localeCompare(
      right.get('lastName'),
    );
    if (lastNameCompare !== 0) return lastNameCompare;
    return left.get('firstName').localeCompare(right.get('firstName'));
  },
});
```

### Using Queries as Indexes

When sorted by a field, queries act as efficient indexes enabling O(log n)
lookups:

```typescript
// Create an index over user emails
const usersByEmail = db.query({
  source: '/sys/users',
  schema: kSchemaUser,
  sortBy: 'email',
});

// O(log n) lookup by email after index is built
await usersByEmail.loadingFinished();
const user = usersByEmail.find('email', 'user@example.com');
```

### Chaining Queries

Queries can be chained together, where one query's results become the input for
another. This enables building complex data transformations through composition:

```typescript
// Find important todos
const importantTodos = db.query({
  source: '/data/todos',
  predicate: ({ item }) => item.get('important'),
});

// Then find recent important todos
const recentImportant = db.query({
  source: importantTodos,
  predicate: ({ item }) => isRecent(item.get('date')),
});
```

Chained queries are efficient because:

- Each query only processes the results of the previous query
- Updates only affect the necessary parts of the chain
- Memory usage is optimized by processing data in stages

Here's a more complex example showing how chained queries can optimize data
processing:

```typescript
// First, get all active users (small subset of total users)
const activeUsers = db.query({
  source: '/sys/users',
  predicate: ({ item }) => item.get('active'),
});

// Then, get their recent activities (only for active users)
const recentActivities = db.query({
  source: activeUsers,
  predicate: ({ item }) => {
    const activities = item.get('activities');
    return activities.some((activity) => isRecent(activity.date));
  },
});

// Finally, sort by most recent activity
const sortedActivities = db.query({
  source: recentActivities,
  sortBy: ({ left, right }) => {
    const leftRecent = getMostRecentActivity(left);
    const rightRecent = getMostRecentActivity(right);
    return rightRecent.date - leftRecent.date;
  },
});
```

In this example, each query in the chain:

- Processes only the relevant subset of data
- Maintains its own efficient cache
- Updates independently when the underlying data changes
- Can be reused independently for other purposes

## Real-Time Updates

Queries automatically update their results when the underlying data changes.
This makes them perfect for building reactive UIs and backend services that need
to respond to data changes in real-time:

```typescript
// Create a query
const activeUsers = db.query({
  source: '/sys/users',
  predicate: ({ item }) => item.get('active'),
});

// Listen for changes
activeUsers.onResultsChanged(() => {
  console.log('Active users changed:', activeUsers.results());
});
```

## Technical Details

GoatDB's query system is designed for responsiveness and efficiency while being
super easy to use without explicit indexing. The [architecture](/docs/architecture)
prioritizes developer experience without sacrificing [performance](/docs/benchmarks):

- **No Manual Indexing**: Unlike traditional databases, GoatDB doesn't require
  developers to define and maintain explicit indexes
- **Lazy Evaluation**: Queries only compute what's needed when it's needed
- **Transparent Caching**: Results are cached transparently without developer
  intervention

<div style={{textAlign: 'center'}}>
  <img src="/img/local-copy.svg" alt="Local Copy & Offline Availability" />
</div>

Each peer maintains a complete local copy of the database, enabling offline
operation and low-latency access. The local copy is [synchronized](/docs/sync) with
the network when online, ensuring consistency across all peers.

<div style={{textAlign: 'center'}}>
  <img src="/img/commit-storage.svg" alt="Commit Storage & Age Assignment" />
</div>

As commits are stored in the database, each peer assigns its own monotonically
increasing age number that reflect the order in which commits were received
locally. These age numbers are local to each peer and are never synchronized
across the network.

<div style={{textAlign: 'center'}}>
  <img src="/img/query-cache.svg" alt="Query Cache & Age Tracking" />
</div>

When persisting query results, we store both the results and the age of the
latest commit included in those results. This allows us to efficiently track
which commits have already been processed.

<div style={{textAlign: 'center'}}>
  <img src="/img/incremental-updates.svg" alt="Incremental Query Updates" />
</div>

When new commits arrive, queries can efficiently resume execution from their
last known age, only processing the new commits. This incremental update process
ensures optimal performance and resource usage.
