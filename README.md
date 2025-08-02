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
📚 <a href="https://goatdb.dev">Documentation</a> • ⚡ <a href="https://goatdb.dev/docs/benchmarks/">Benchmarks</a> • 💬 <a href="https://github.com/goatplatform/goatdb/discussions">Discussions</a> • 👋 <a href="https://discord.gg/SAt3cbUqxr">Discord</a> • 🔴 <a href="https://www.reddit.com/r/zbdb/s/jx1jAbEqtj">Reddit</a>
</p>

[GoatDB](https://goatdb.dev/) is an embedded, distributed document database that
prioritizes speed and developer experience. Build real-time collaborative apps
that work offline.

Inspired by distributed version control systems, GoatDB brings Git-like features
to databases: cryptographically signed commits, three-way merges, and automatic
conflict resolution. TypeScript-first with React hooks included.

**What makes GoatDB different?**

- **Works offline:** Changes sync automatically when reconnected
- **Instant UI updates:** Local changes are instant, no loading states
- **Smart conflict resolution:** Git-style three-way merge for live data
- **Self-healing:** Clients can restore crashed servers from the commit graph

GoatDB is under active development. Star ⭐️ our project if you like the
approach!

> [!WARNING]
> Please keep in mind that GoatDB is still under active development and
> therefore full backward compatibility is not guaranteed before reaching
> v1.0.0. For more details, see the
> <a href="https://goatdb.dev/docs/faq/">FAQ</a>.

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

## React Integration

GoatDB includes React hooks for real-time, offline-capable UIs. See the
[React documentation](https://goatdb.dev/docs/react/).

See the <a href="https://goatdb.dev/docs/tutorial/">tutorial</a> for more
examples.

## Contributing

We welcome contributions! Fork, make changes, and submit a PR. For local
development:

```bash
deno run -A jsr:@goatdb/goatdb/link link ./path/to/goatdb
```

## License

GoatDB is licensed under the
<a href="https://github.com/goatplatform/goatdb/blob/main/LICENSE">Apache 2.0
License</a>.
