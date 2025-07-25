# GoatDB Node.js Basic Example

A simple example showing GoatDB usage in Node.js with CRUD operations, schemas, and reactive queries.

## Installation & Running

```bash
npm install
npm start
```

## What it demonstrates

```javascript
import { GoatDB, DataRegistry } from '@goatdb/goatdb';

// 1. Define and register schema
const taskSchema = {
  ns: 'task',
  version: 1,
  fields: {
    text: { type: 'string', required: true },
    done: { type: 'boolean', default: () => false }
  }
};
DataRegistry.default.registerSchema(taskSchema);

// 2. Initialize database
const db = new GoatDB({ path: './data' });
await db.readyPromise();

// 3. Create items
const task = db.create('/data/todos/task-1', taskSchema, {
  text: 'Learn GoatDB'
});

// 4. Query with predicates
const incompleteTasks = db.query({
  source: '/data/todos',
  schema: taskSchema,
  predicate: ({ item }) => !item.get('done')
});

// 5. Reactive updates
incompleteTasks.onResultsChanged(() => {
  console.log('Tasks updated!');
});

// 6. Update items
task.set('done', true);
```

## Key concepts

- **Path format**: `/type/repo/item` (e.g., `/data/todos/task-1`)
- **Schema registration**: Required before creating items
- **Reactive queries**: Automatically update when data changes
- **Memory-first**: Fast operations with persistent storage
- **Security mode**: Uses default security settings. For backend-only applications in secure environments, see [trusted mode documentation](https://goatdb.dev/sessions#trusted-mode)