# GoatDB AI Development Guide

## Project Overview

GoatDB is an embedded, distributed document database that prioritizes speed and developer experience. It uses concepts from distributed version control systems (like Git) combined with novel algorithms for efficient synchronization and real-time conflict resolution.

**Key Technologies:**
- Language: TypeScript/Deno
- Architecture: Memory-first with append-only persistence
- Sync: Bloom filter-based stateless synchronization
- Conflict Resolution: Three-way merge with ephemeral CRDTs

## Core Concepts

### 1. **Repository**
A self-contained unit of data, similar to a Git repository. Each repository:
- Has its own commit history
- Can be synced independently
- Contains items (documents) organized by paths
- Is stored as a single append-only file on disk

### 2. **Item**
A document in the database with:
- A unique path following the format `/type/repo/item` (e.g., `/data/todos/task-123`)
- A schema that defines its structure
- Its own commit history
- Automatic conflict resolution

### 3. **Schema**
Defines the structure and validation rules for items:
```typescript
const kSchemaTask = {
  ns: 'task',          // Namespace identifier
  version: 1,          // Schema version
  fields: {
    text: {
      type: 'string',
      required: true,
    },
    done: {
      type: 'boolean',
      default: () => false,
    },
    tags: {
      type: 'set',     // Set<CoreValue>
    },
    metadata: {
      type: 'map',     // Dictionary<string, CoreValue>
    },
  },
} as const;
```

### 4. **Query**
First-class objects that:
- Track their own commit history
- Process changes incrementally
- Support real-time updates
- Use JavaScript predicates for filtering

### 5. **Session**
Authentication and authorization context:
- Each session has a unique ID
- Can be anonymous or authenticated
- Determines access permissions

## Common Tasks

### Setting Up a Database
```typescript
import { GoatDB, DataRegistry } from '@goatdb/goatdb';

// Register schemas
DataRegistry.default.registerSchema(kSchemaTask);

// Initialize database
const db = new GoatDB({
  path: './data',
  peers: ['https://sync.example.com'],
  trusted: false,  // Set to true in secure backend environments
});

// Wait for initialization
await db.readyPromise();
```

### Creating and Updating Items
```typescript
// Create a new item - path format: /type/repo/item
const task = await db.load('/data/todos/task-123', kSchemaTask, {
  text: 'Complete the documentation',
  done: false,
});

// Update an item
task.set('done', true);
task.set('tags', new Set(['urgent', 'documentation']));

// Delete an item
task.delete();
```

### Querying Data
```typescript
// Create a reactive query - source is a repository path (/type/repo)
const activeTasks = db.query({
  source: '/data/todos',
  schema: kSchemaTask,
  predicate: (item) => !item.get('done'),
  sort: (a, b) => {
    const aDate = a.get('dateCreated');
    const bDate = b.get('dateCreated');
    return aDate.getTime() - bDate.getTime();
  },
});

// Get results
const results = activeTasks.results();

// Listen for changes
activeTasks.on('Changed', () => {
  console.log('Active tasks updated:', activeTasks.results());
});
```

### Working with React
```typescript
import { useDB, useQuery, useItem } from '@goatdb/goatdb/react';

function TodoList() {
  const tasks = useQuery({
    schema: kSchemaTask,
    source: '/data/todos',
    predicate: (item) => !item.get('done'),
  });

  return (
    <ul>
      {tasks.results().map((task) => (
        <TaskItem key={task.path} path={task.path} />
      ))}
    </ul>
  );
}

function TaskItem({ path }: { path: string }) {
  const task = useItem(path, { keys: ['text', 'done'] });
  
  if (!task) return <li>Loading...</li>;
  
  return (
    <li>
      <input
        type="checkbox"
        checked={task.get('done')}
        onChange={(e) => task.set('done', e.target.checked)}
      />
      {task.get('text')}
    </li>
  );
}
```

### Authentication
```typescript
// Login with email
await db.loginWithEmail('user@example.com');

// Check login status
if (db.loggedIn) {
  const user = db.currentUser;
  console.log('Logged in as:', user?.get('email'));
}

// Logout
await db.logout();
```

## File Structure

```
goatdb/
├── base/          # Core utilities and data structures
├── cfds/          # Conflict-free data structures
├── db/            # Database core (main entry point: db.ts)
├── repo/          # Repository implementation
├── net/           # Networking and synchronization
├── react/         # React hooks
├── server/        # Server implementation
├── tests/         # Test suite
├── docs/          # Documentation
└── mod.ts         # Main module export
```

## Important Patterns

### 1. **Path Format: /type/repo/item**
```typescript
// ✅ Correct path format
const item = db.item('/data/todos/task-123');
const user = db.item('/sys/users/user-456');
const event = db.item('/events/analytics/page-view-789');

// ❌ Incorrect formats
const item = db.item('/todos/task-123');        // Missing type
const item = db.item('data/todos/task-123');    // Not absolute
const item = db.item('/data/todos/task-123/');  // Trailing slash
```

### 2. **Wait for Database Ready**
```typescript
// Always wait before operations
await db.readyPromise();

// Or check ready flag
if (db.ready) {
  // Perform operations
}
```

### 3. **Schema Registration**
```typescript
// Register before using
DataRegistry.default.registerSchema(kSchemaTask);

// Then use in database
const item = await db.load('/data/todos/task-123', kSchemaTask, data);
```

### 4. **Error Handling**
```typescript
try {
  const item = await db.load('/data/todos/task-123', schema, data);
} catch (error) {
  if (error.code === 'VALIDATION_ERROR') {
    // Handle validation errors
  } else if (error.code === 'PERMISSION_DENIED') {
    // Handle authorization errors
  }
}
```

## Development Commands

```bash
# Run tests
deno run -A tests/run.ts

# Run specific test
deno test -A tests/db-trusted.test.ts

# Run benchmarks
deno bench -A --no-check

# Build system assets (required after modifying bloom filter)
deno run -A system-assets/build-sys-assets.ts

# Format code
deno fmt

# Type check
deno check mod.ts
```

## Performance Considerations

1. **Memory Usage**: All active repository data is kept in memory
2. **Initial Load**: Loading a repository requires reading its full commit history
3. **Query Performance**: Queries process incrementally, only new changes
4. **Sync Efficiency**: Bloom filters minimize data transfer during sync

## Common Pitfalls

1. **Forgetting Schema Registration**: Always register schemas before use
2. **Incorrect Path Format**: Paths must follow `/type/repo/item` format
3. **Using Relative Paths**: All paths must be absolute (start with `/`)
4. **Not Waiting for Ready**: Database operations before `readyPromise()` will fail
5. **Modifying Frozen Objects**: Use `set()` methods, don't modify objects directly
6. **Missing Field Types**: Schemas must specify types for all fields

## Testing Patterns

```typescript
// Use test utilities
import { assertEquals } from '@std/expect';
import { createTestDB } from './tests/mod.ts';

// Create isolated test database
const db = await createTestDB();

// Clean up after tests
await db.close();
```

## Debugging Tips

1. **Enable Debug Mode**: `new GoatDB({ debug: true })`
2. **Check Commit History**: `repo.getCommitHistory()`
3. **Inspect Sync State**: `db._syncSchedulers` (internal API)
4. **Query Debugging**: `query.on('Debug', console.log)`

## Architecture Notes

- **Storage**: Single append-only JSON log file per repository
- **Indexes**: In-memory, rebuilt on load
- **Sync Protocol**: Stateless, using iterative Bloom filter exchanges
- **Conflict Resolution**: Automatic three-way merge at field level
- **Garbage Collection**: Time-based, preserves recent commit history

## Related Resources

- Main Documentation: https://goatdb.dev
- GitHub: https://github.com/goatplatform/goatdb
- Example Apps:
  - Todo App: https://github.com/goatplatform/todo
  - Edge Chat: https://github.com/goatplatform/edge-chat