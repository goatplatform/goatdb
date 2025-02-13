<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/4975e49c-e73c-435e-8e10-97adc2c0aaeb">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/270caf47-3ed8-49d4-b3b9-74a51bd2d6c0">
    <img alt="GoatDB Logo" src="https://github.com/user-attachments/assets/270caf47-3ed8-49d4-b3b9-74a51bd2d6c0">
  </picture>
</p>

---

# The Edge-Native Database

GoatDB empowers you to build and deploy complex, scalable, and secure
applications in under 20 minutes—without requiring backend expertise. It's the
fastest and easiest way to create modern apps, tailored for today's developer
needs.

GoatDB is a real-time, distributed Version Control Database (VCDB). By running
tasks like reading and writing on the client side, it ensures fast performance
and offline functionality. With causal consistency and an edge-native design,
GoatDB simplifies development and supports scalable, modern workloads.

👉 If you like what we're building, please star ⭐️ our project. We really
appreciate it! 🙏

- [Getting Started](https://goatdb.dev/getting-started)
- [Documentation](https://goatdb.dev)
- [FAQ](https://goatdb.dev/faq)

## Installation

1. **Navigate to your project directory:**

   ```bash
   cd /path/to/project
   ```

2. **Add GoatDB to your project:**

   ```bash
   deno add jsr:@goatdb/goatdb
   ```

3. **Initialize GoatDB:**

   ```bash
   deno run -A jsr:@goatdb/goatdb/init
   ```

These steps install GoatDB and set up the underlying a project skaffold for your
application.

## Quick Start

### Using React Hooks (Recommended)

```tsx
import { useDB, useItem, useQuery } from '@goatdb/goatdb/react';

// Define your schema
const kSchemaTask = {
  ns: 'task',
  version: 1,
  fields: {
    text: { type: 'string', required: true },
    done: { type: 'boolean', default: () => false },
  },
} as const;

// Use hooks in your components
function TaskList() {
  const db = useDB();

  // Query tasks sorted by text
  const query = useQuery({
    schema: kSchemaTask,
    source: `/data/${db.currentUser!.key}`,
    sortDescriptor: ({ left, right }) =>
      left.get('text').localeCompare(right.get('text')),
  });

  return (
    <div>
      {query.results().map(({ path }) => <TaskItem key={path} path={path} />)}
    </div>
  );
}

function TaskItem({ path }) {
  // Subscribe to changes for a specific task
  const task = useItem(path);

  return (
    <div>
      <input
        type='checkbox'
        checked={task.get('done')}
        onChange={(e) => task.set('done', e.target.checked)}
      />
      <input
        type='text'
        value={task.get('text')}
        onChange={(e) => task.set('text', e.target.value)}
      />
    </div>
  );
}
```

### Using Lower Level DB API

```typescript
import { GoatDB } from '@goatdb/goatdb';

// Initialize DB
const db = new GoatDB({
  path: '/data/db',
  peers: 'https://api.example.com',
});

// Create a new task
const task = db.create('/data/user123', kSchemaTask, {
  text: 'Buy groceries',
  done: false,
});

// Update task
task.set('done', true);

// Query tasks
const query = db.query({
  schema: kSchemaTask,
  source: '/data/user123',
  predicate: ({ item }) => !item.get('done'),
});

// Subscribe to query updates
query.on('ResultsChanged', () => {
  console.log('Active tasks:', query.results());
});
```

## Runtime Support

GoatDB currently runs on Deno and we're actively working on supporting
additional JavaScript runtimes including:

- Node.js
- Bun
- Cloudflare Workers
- Other edge runtimes

Stay tuned for updates as we expand runtime compatibility!

## UI Framework Support

GoatDB currently provides first-class support for React through our React hooks
API. We're actively working on supporting additional UI frameworks to make
GoatDB accessible to more developers.

## GoatDB Use Cases

GoatDB is designed to address a variety of scenarios, making it a versatile
solution for modern applications. Below are the primary use cases:

### 1. **Data Synchronization** 🔄

Synchronize data across multiple devices in real-time, ensuring consistency and
seamless user experience.

### 2. **Multi-Agent Communication** 🤖

Enable reliable communication and state synchronization between autonomous
agents in multi-agent systems, with built-in conflict resolution and eventual
consistency guarantees.

### 3. **Hallucination-Safe Enclaves** 🔒

Create secure data sandboxes to validate LLM outputs and prevent hallucinations,
allowing safe experimentation with AI models without compromising the main
dataset.

### 4. **Vector Search** 🔍 (Coming Soon)

Support for vector embeddings and similarity search is in development
([tracking issue](https://github.com/goatplatform/goatdb/issues/15)), enabling
semantic search and AI-powered features.

### 5. **ETL Pipeline** 🔄

Serve as a lightweight, self-contained ETL (Extract, Transform, Load) pipeline,
leveraging GoatDB's schema validation and distributed processing capabilities to
efficiently transform and migrate data between systems.

### 6. **Database Migration** 🔄

Facilitate smooth transitions between different database systems by using GoatDB
as an intermediary layer, allowing gradual migration of data and functionality
while maintaining application stability.

### 7. **Offline Operation** 🛠️

Enable continuous functionality even during server downtime, ensuring your
application remains reliable and responsive.

### 8. **Privacy-First Backup** 🔐

Move data end-to-end between clients, ensuring that sensitive information is
never exposed to the central server.

### 9. **Collaborative Editing** 👥

Allow multiple users to collaboratively edit and share the same data, perfect
for teamwork and shared workflows.

### 10. **Rapid Prototyping** ⚡

Support fast product iteration cycles with flexible compatibility for frequent
schema or structural changes.

### 11. **Data Integrity Auditing** 📈

Protect against fraudulent data manipulation and maintain trust by preventing
unauthorized modifications.

### 12. **Read-Heavy Optimization** 📊

Optimize for cost and performance in read-intensive workloads, making your
application more efficient.
