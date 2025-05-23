<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/4975e49c-e73c-435e-8e10-97adc2c0aaeb">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/270caf47-3ed8-49d4-b3b9-74a51bd2d6c0">
    <img alt="GoatDB Logo" src="https://github.com/user-attachments/assets/270caf47-3ed8-49d4-b3b9-74a51bd2d6c0">
  </picture>
</p>

---

# GoatDB: Embedded, Distributed, Document Database

<p align="center">
📚 <a href="https://goatdb.dev">Documentation</a> • ⚡ <a href="https://goatdb.dev/benchmarks/">Benchmarks</a> • 💬 <a href="https://github.com/goatplatform/goatdb/discussions">Discussions</a> • 👋 <a href="https://discord.gg/SAt3cbUqxr">Discord</a>
</p>

[GoatDB](https://goatdb.dev/) is an embedded,
[distributed](https://goatdb.dev/architecture), document database that
prioritizes [speed](https://goatdb.dev/benchmarks) and
[developer experience](https://goatdb.dev/tutorial/). It excels at real-time
collaboration and embedded caching applications.

Instead of following traditional database design patterns, GoatDB leverages
[concepts](https://goatdb.dev/concepts) refined over decades by distributed
version control systems. These are enhanced with novel algorithms for efficient
[synchronization](https://goatdb.dev/sync) and automatic real-time conflict
resolution.

Currently optimized for TypeScript environments, GoatDB functions as a
first-class citizen in both browsers and servers. It utilizes a
[document model](https://goatdb.dev/concepts) with
[schemas](https://goatdb.dev/schema), providing
[causal eventual consistency](https://en.wikipedia.org/wiki/Causal_consistency)
to simplify development while offering built-in optional
[cryptographic signing](https://goatdb.dev/sessions) for the underlying
[commit graph](https://goatdb.dev/commit-graph).

**What makes GoatDB different?**

- **<a href="https://goatdb.dev/repositories/">Repository-centric</a>:** Each
  repository is a self-contained unit, enabling natural sharding, isolation, and
  fine-grained <a href="https://goatdb.dev/authorization-rules/">access
  control</a>.
- **<a href="https://goatdb.dev/sync/">Stateless, probabilistic sync</a>:**
  Synchronization uses iterative Bloom filter exchanges for efficient,
  low-latency, and transport-agnostic convergence—no persistent sync state
  required.
- **<a href="https://goatdb.dev/query/">Deterministic, incremental
  queries</a>:** Queries are first-class, track their own
  <a href="https://goatdb.dev/commit-graph/">commit history</a>, and process
  only new changes—enabling real-time, reactive data flows without full
  recomputation.
- **<a href="https://goatdb.dev/conflict-resolution/">Ephemeral CRDT-based
  conflict resolution</a>:** Conflicts are resolved automatically and
  efficiently using a three-way merge with short-lived CRDTs, tailored for
  scalable, distributed collaboration.
- **<a href="https://goatdb.dev/architecture/">Memory-first, append-only
  storage</a>:** All active data is in memory for speed; the on-disk format is a
  simple, append-only log for reliability and easy backup.

GoatDB is under active development. If you're interested in a new approach to
distributed data, we invite you to explore further and contribute. And please,
star ⭐️ our project. We really appreciate it! 🙏

> [!WARNING]
> Please keep in mind that GoatDB is still under active development and
> therefore full backward compatibility is not guaranteed before reaching
> v1.0.0. For more details, see the <a href="https://goatdb.dev/faq/">FAQ</a>.

## Quick Start

Install in Deno (recommended):

```bash
deno add jsr:@goatdb/goatdb
```

### Basic Usage

```ts
import { GoatDB } from '@goatdb/goatdb';
const db = new GoatDB({ path: './data', peers: ['http://10.0.0.1'] });
const item = db.create('/todos', { text: 'Hello, GoatDB!', done: false });
item.set('done', true);
```

## React Hooks

GoatDB provides a set of ergonomic React hooks for building real-time,
offline-capable UIs with minimal boilerplate. These hooks offer a complete state
management solution for React apps—handling database initialization, loading
state, live queries, and item updates—all with automatic synchronization and
efficient reactivity. Hooks like [`useDB`](https://goatdb.dev/react/#usedb),
[`useDBReady`](https://goatdb.dev/react/#usedbready),
[`useQuery`](https://goatdb.dev/react/#usequery), and
[`useItem`](https://goatdb.dev/react/#useitem) make it easy to manage your
application's data layer. See the [Concepts](https://goatdb.dev/concepts/) and
[Reading and Writing Data](https://goatdb.dev/read-write-data/) docs for more
background.

**Example:**

```jsx
function TaskList() {
  const tasks = useQuery({
    schema: taskSchema, // see https://goatdb.dev/schema/
    source: '/tasks',
    predicate: (item) => !item.get('done'), // see https://goatdb.dev/query/
  });
  return (
    <ul>
      {tasks.results().map((task) => (
        <li key={task.path}>
          <TaskEditor path={task.path} />
        </li>
      ))}
    </ul>
  );
}

function TaskEditor({ path }) {
  const task = useItem(path, { keys: ['text', 'done'] }); // see https://goatdb.dev/read-write-data/
  if (!task) return <span>Loading...</span>;
  return (
    <input
      value={task.get('text')}
      onChange={(e) => task.set('text', e.target.value)}
    />
  );
}
```

For details and examples, see the
[React documentation](https://goatdb.dev/react/).

For full installation and usage details, see the
<a href="https://goatdb.dev/install/">installation guide</a> and
<a href="https://goatdb.dev/tutorial/">tutorial</a>.

## Contributing

GoatDB is open source under the Apache 2.0 license. We welcome issues,
discussions, and pull requests. To get started:

1. Fork the repository
2. Create a branch for your changes
3. Submit a pull request

For local development, you can link GoatDB into your project:

```bash
deno run -A jsr:@goatdb/goatdb/link link ./path/to/goatdb
```

To unlink GoatDB, run:

```bash
deno run -A jsr:@goatdb/goatdb/link unlink
```

For more on contributing, see the
<a href="https://goatdb.dev/">documentation</a>.

## License

GoatDB is licensed under the
<a href="https://github.com/goatplatform/goatdb/blob/main/LICENSE">Apache 2.0
License</a>.

---

If GoatDB sounds interesting, please star the project or join the discussion. We
appreciate your feedback and contributions as we work towards a stable v1.0.0.
