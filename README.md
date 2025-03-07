<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/4975e49c-e73c-435e-8e10-97adc2c0aaeb">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/270caf47-3ed8-49d4-b3b9-74a51bd2d6c0">
    <img alt="GoatDB Logo" src="https://github.com/user-attachments/assets/270caf47-3ed8-49d4-b3b9-74a51bd2d6c0">
  </picture>
</p>

---

# GoatDB: Lightweight NoDB for Deno & React

GoatDB is a real-time, version-controlled database for
**[Deno](https://deno.com/)**, **[React](https://react.dev/)**, and low-friction
deployments. It’s ideal for **prototyping**, **self-hosting**, **single-tenant**
apps, as well as **ultra light multi-tenant** setups without heavy backends or
complex DBs.

- **No Dedicated Infra**: Run the entire DB client-side, with incremental
  queries that remove the need for server-side indexing.

- **Resilience & Offline-First**: If the server goes down, clients keep working
  and can restore server state on reboot.

- **Edge-Native**: Most processing happens in the client, keeping servers light
  and fast.

- **Real-Time Collaboration**: Built-in sync automatically keeps client and
  server state synchronized in real-time.

👉 If you like what we're building, please star ⭐️ our project. We really
appreciate it! 🙏

- [Tutorial](https://goatdb.dev/tutorial)
- [Documentation](https://goatdb.dev)
- [FAQ](https://goatdb.dev/faq)

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

## Benchmarks

To run the benchmarks yourself, use the following command:

```bash
deno task bench
```

**System Information:**

- CPU: Intel(R) Core(TM) i7-8850H CPU @ 2.60GHz
- Runtime: Deno 2.2.1 (x86_64-apple-darwin)

| Benchmark                    | Average  | p75      | p99      | p995     |
| ---------------------------- | -------- | -------- | -------- | -------- |
| Create instance              | 5.0 ms   | 5.3 ms   | 9.2 ms   | 9.2 ms   |
| Open repository (empty)      | 9.5 ms   | 1.7 ms   | 174.1 ms | 174.1 ms |
| Open repository (100k items) | 978.3 ms | 983.0 ms | 1.0 s    | 1.0 s    |
| Create single item           | 3.3 ms   | 3.5 ms   | 4.7 ms   | 4.7 ms   |
| Read item by path            | 2.8 µs   | 3.0 µs   | 3.5 µs   | 3.5 µs   |
| Update item                  | 1.8 ms   | 1.7 ms   | 3.4 ms   | 3.4 ms   |
| Bulk create 100 items        | 80.1 ms  | 76.9 ms  | 132.7 ms | 132.7 ms |
| Bulk read 100 items          | 413.0 µs | 415.0 µs | 517.6 µs | 517.6 µs |
| Simple query                 | 260.3 µs | 274.1 µs | 327.9 µs | 327.9 µs |
| Complex query with sort      | 150.6 µs | 160.7 µs | 264.8 µs | 264.8 µs |
| Repository operations: count | 4.5 µs   | 4.7 µs   | 5.8 µs   | 5.8 µs   |
| Repository operations: keys  | 7.3 µs   | 7.3 µs   | 8.6 µs   | 8.6 µs   |

Both client and server work against a synchronous in-memory snapshot that gets
synchronized in the background several times per second. This architecture
combines the performance benefits of in-memory databases with the reliability of
persistence and replication, allowing these benchmarks to remain consistent
across client and server.

## Security

GoatDB employs a robust security model where each node maintains its own
public-private key pair. The private key never leaves the local machine,
ensuring secure commit signing, while the public key enables other nodes to
verify changes. Every commit is digitally signed by its originating node,
creating an immutable chain of custody. When commits are received, nodes verify
both the authenticity and integrity using the public key, automatically
rejecting any unauthorized or tampered changes.

The system also includes customizable application-level authorization rules that
enforce business policies, such as restricting users to only edit their own
data. This dual-layer approach combines cryptographic verification with flexible
access controls to create a comprehensive security model that protects data
integrity at both the protocol and application levels. Any mutations that
violate either the cryptographic signatures or authorization policies are
rejected, maintaining consistency and security across the network.

## Conflict Resolution

GoatDB resolves conflicts by performing a three-way merge whenever it finds more
than one differing value on the leaves of its commit graph. Internally, it
transforms the base version of the data into a temporary CRDT, applies the
changes from each branch, and then captures the final merged output before
discarding the CRDT. This approach provides the advantages of CRDTs—simple,
automatic resolution of concurrent edits—without forcing every node to maintain
the entire editing history.

To handle indexing conflicts efficiently, GoatDB takes inspiration from Logoot
by assigning continuous identifiers to each element in the data, ensuring
insertions and deletions won’t interfere with each other. When multiple edits
occur at the same location, GoatDB merges them using a globally agreed-upon
order of commits, resolving differences by either choosing one change, combining
both, or merging them (e.g., “cat” + “hat” → “chat”). This ensures predictable
conflict handling at scale, making GoatDB well-suited for hackathon projects and
quick prototypes where ease of collaboration and simplicity are key.

## Tests

GoatDB has a test suite to ensure reliability and performance. While not yet
comprehensive, we're working on expanding them. You can run the tests using:

```bash
deno task test
```

## Contributing

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

## License

GoatDB is licensed under the [Apache 2.0 License](LICENSE).
