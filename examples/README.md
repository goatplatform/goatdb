# GoatDB Node.js Examples

Quick examples showing how to use GoatDB with Node.js.

## Examples

### [nodejs-basic](./nodejs-basic/)

Essential GoatDB operations in Node.js

- Database setup and schemas
- CRUD operations
- Reactive queries

## Quick Start

```bash
cd nodejs-basic
npm install
npm start
```

## Core patterns

```javascript
import { DataRegistry, GoatDB } from '@goatdb/goatdb';

// 1. Define schema
const schema = {
  ns: 'task',
  version: 1,
  fields: {
    text: { type: 'string', required: true },
    done: { type: 'boolean', default: () => false },
  },
};

// 2. Register schema
DataRegistry.default.registerSchema(schema);

// 3. Initialize database
const db = new GoatDB({ path: './data' });
await db.readyPromise();

// 4. Create items
const task = db.create('/data/todos/task-1', schema, { text: 'Learn GoatDB' });

// 5. Query with predicates
const incompleteTasks = db.query({
  source: '/data/todos',
  schema,
  predicate: ({ item }) => !item.get('done'),
});

// 6. Reactive updates
incompleteTasks.onResultsChanged(() => {
  console.log('Updated!', incompleteTasks.results().length);
});
```

## Path format

GoatDB uses `/type/repo/item` paths:

- `/data/todos/task-1` - A task item
- `/sys/users/user-123` - A user item
- `/events/logs/log-456` - A log item

## Security Mode

GoatDB defaults to secure mode with user authentication. For backend-only
applications in secure environments, you can use `trusted: true` for better
performance.
[Learn more about trusted mode](https://goatdb.dev/sessions#trusted-mode).

## Requirements

- Node.js 16+
- `"type": "module"` in package.json
