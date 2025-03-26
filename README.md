<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/4975e49c-e73c-435e-8e10-97adc2c0aaeb">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/270caf47-3ed8-49d4-b3b9-74a51bd2d6c0">
    <img alt="GoatDB Logo" src="https://github.com/user-attachments/assets/270caf47-3ed8-49d4-b3b9-74a51bd2d6c0">
  </picture>
</p>

---

# GoatDB: An Embedded, Distributed, Document Database

<p align="center">
📦 <a href="/install">Installation</a> •
🚀 <a href="/tutorial">Tutorial</a> • ❓ <a href="/faq">FAQ</a> • <a href="/benchmarks">⚡ Benchmarks</a> • 💬 <a href="https://github.com/goatplatform/goatdb/discussions">Discussions</a> • 👋 <a href="https://discord.gg/SAt3cbUqxr">Discord</a>
</p>

GoatDB is an embedded, distributed, document database that prioritizes
[speed](https://goatdb.dev/benchmarks) and
[developer experience](https://goatdb.dev/tutorial/). It excels at real-time
collaboration and embedded caching applications.

Instead of following traditional database design patterns, GoatDB leverages
concepts refined over decades by distributed version control systems. These are
enhanced with novel algorithms
([bloom filter-based synchronization](https://goatdb.dev/sync/) and
[ephemeral CRDTs](https://goatdb.dev/conflict-resolution)) for efficient
synchronization and automatic real-time conflict resolution.

Currently optimized for JavaScript environments, GoatDB functions as a
first-class citizen in both browsers and servers. It utilizes a document model
with schemas, providing causal eventual consistency to simplify development
while offering built-in optional cryptographic signing for the underlying commit
graph.

GoatDB implements incremental local queries, leveraging its version control
internals to efficiently process only changed documents.

GoatDB employs a memory-first design and a different scaling approach than
traditional databases. Rather than growing a single large database, it uses
application-level sharding with multiple medium-sized repositories that sync
independently. Each user or data group has its own repository, enabling
horizontal scaling and efficient client-server synchronization. This
architecture provides natural scalability for multi-user applications without
complex manual sharding.

Items in GoatDB are defined alongside their schema. Schemas dictate both the
field types and their conflict resolution strategy. Schemas are themselves
versioned, making rolling schema updates via branches a natural mechanism.​​​​​​​​​​​​​​​​

👉 If you like what we're building, please star ⭐️ our project. We really
appreciate it! 🙏

> [!WARNING]
> Please keep in mind that GoatDB is still under active development and
> therefore full backward compatibility is not guaranteed before reaching
> v1.0.0.

## Example Projects

Explore projects built with GoatDB:

- **[Todo](https://github.com/goatplatform/todo)**: A minimalist, modern, todo
  list app specifically designed for self hosting.

- **[EdgeChat](https://github.com/goatplatform/edge-chat)**: A demo of a
  ChatGPT-like interface that runs completely in the browser, no network
  connection needed.

- **[Ovvio](https://ovvio.io)**: A productivity suite that has been powered by
  GoatDB in production since January 2024.

## Installation

GoatDB can be installed in both Deno and Node.js environments. While our
preferred runtime is Deno (which supports compiling to a self-contained
executable), we also provide experimental support for Node.js. See the full
[installation instructions](https://goatdb.dev/install) for all compatible
runtimes.

### Installation

1. **Add GoatDB to your project:**

   ```bash
   deno add jsr:@goatdb/goatdb
   ```

2. **Initialize the React Skaffold:**

   ```bash
   deno run -A jsr:@goatdb/goatdb/init
   ```
   > **Note**: This step is only needed for Single Page Applications (SPAs). The
   > initialization command installs React dependencies and creates a project
   > skaffold that includes both client-side and server-side code structure. If
   > you're not building a SPA or already have your React setup, you can skip
   > this step.

## Basic Usage

```tsx
import { GoatDB } from '@goatdb/goatdb';

const db = new GoatDB({ path: './server-data', peers: ['http://10.0.0.1'] });
const item = db.create('/todos', { text: 'Hello, GoatDB!', done: false });

// Update in memory; auto-commits in background
item.set('done', true);

console.log(item.get('text'), item.get('done'));
// Output: "Hello, GoatDB!" true
```

GoatDB makes it easy to set up a cluster of servers by specifying replica
locations in the `peers` field during initialization. Each server will
automatically synchronize with its replicas at the provided URLs, using the same
efficient sync protocol that clients use to stay in sync with servers. This
means you can easily scale out your deployment by adding more replicas without
changing any code or protocols - the servers will seamlessly coordinate using
the built-in sync mechanism.

## Using React Hooks

GoatDB's React hooks provide a complete state management solution with mutable
state that you can edit synchronously. When you make changes (like
`task.set('done', true)`), they're applied immediately in memory while GoatDB
handles computing diffs, committing to local storage, syncing with the server,
and resolving conflicts automatically in the background. This gives you simple
local state management with automatic cross-client synchronization and server
persistence. Here's how the hooks work in practice:

```tsx
import { useDB, useItem, useQuery } from '@goatdb/goatdb/react';

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

## Running the Interactive Server

```bash
deno task debug
```

Starts an interactive debug server that listens on http://localhost:8080.

## Compiling a Server Binary

```bash
deno task build
```

Builds a self-contained executable that bundles the server, database and client
code together with no external dependencies or containers needed, making it
cloud agnostic and easy to self-host on any server you wish.

That’s it! GoatDB keeps your app running even if the server fails, with clients
seamlessly backing up and restoring data. No complex indexing required, thanks
to incremental queries.

## Contributing

**All contributions to this project are made under the Apache License, Version
2.0. By submitting a Pull Request, you agree that your contributions are
licensed under Apache-2.0.**

To contribute to GoatDB, follow these steps:

1. Fork the repository
2. Create a branch for your changes
3. Submit a pull request

We strive to review all pull requests within a few business days.

To work on GoatDB's code alongside a project that uses it, run:

```bash
deno run -A jsr:@goatdb/goatdb/link link ./path/to/goatdb
```

This will link the local GoatDB repo into your project, allowing you to make
changes to the codebase and have them reflected in your project without having
to reinstall GoatDB.

To unlink GoatDB, run:

```bash
deno run -A jsr:@goatdb/goatdb/link unlink
```

GoatDB has a test suite to ensure reliability and performance. While not yet
comprehensive, we're working on expanding them. You can run the tests using:

```bash
deno task test
```

GoatDB includes benchmarks to measure performance across various operations. To
run the benchmarks:

```bash
deno task bench
```

## License

GoatDB is licensed under the [Apache 2.0 License](LICENSE).
