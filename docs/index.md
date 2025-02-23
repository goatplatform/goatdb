---
# Feel free to add content and custom Front Matter to this file.
# To modify the layout, see https://jekyllrb.com/docs/themes/#overriding-theme-defaults

layout: home
title: Home
nav_exclude: true
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

- **Edge-Native**: Speed, simplicity, and easy scalability are built in.

👉 Head over to the [Tutorial](/tutorial) page for the full instructions.

If you like what we're building, please star ⭐️ our
[GitHub project](https://github.com/goatplatform/goatdb). We really appreciate
it! 🙏

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

GoatDB makes it easy to set up a cluster of servers by specifying replica
locations in the `peers` field during initialization. Each server will
automatically synchronize with its replicas at the provided URLs, using the same
efficient sync protocol that clients use to stay in sync with servers. This
means you can easily scale out your deployment by adding more replicas without
changing any code or protocols - the servers will seamlessly coordinate using
the built-in sync mechanism.

## Basic Usage

```tsx
import { GoatDB } from '@goatdb/goatdb';

const db = new GoatDB({ path: './server-data' peers: ['http://10.0.0.1'] });
const item = db.create('/todos', { text: 'Hello, GoatDB!', done: false });

// Update in memory; auto-commits in background
item.set('done', true);

console.log(item.get('text'), item.get('done'));
// Output: "Hello, GoatDB!" true
```

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

Here are some benchmark results from running on a 2018 MacBook Pro:

- Writing: ~0.25ms / item
- Reading: < 0.001ms / item
- Querying: ~100ms to filter ~3k items from a set of 100k
- Opening a Repository: < 1.5 sec / 100k commits

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
