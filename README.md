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
📚 <a href="https://goatdb.dev">Documentation</a> • ⚡ <a href="https://goatdb.dev/docs/benchmarks/">Benchmarks</a> • 💬 <a href="https://github.com/goatplatform/goatdb/discussions">Discussions</a> • 👋 <a href="https://discord.gg/SAt3cbUqxr">Discord</a>
</p>

<p align="center">
<a href="https://github.com/goatplatform/goatdb/actions/workflows/test.yml"><img src="https://github.com/goatplatform/goatdb/actions/workflows/test.yml/badge.svg" alt="Tests" /></a>
<a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
<a href="https://jsr.io/@goatdb/goatdb"><img src="https://jsr.io/badges/@goatdb/goatdb" alt="JSR" /></a>
<a href="https://www.npmjs.com/package/@goatdb/goatdb"><img src="https://img.shields.io/npm/v/@goatdb/goatdb" alt="npm" /></a>
</p>

[GoatDB](https://goatdb.dev/) is an embedded, distributed document database that prioritizes speed and developer experience. Build real-time collaborative apps that work offline.

Inspired by distributed version control systems, GoatDB brings Git-like features to databases: cryptographically signed commits, three-way merges, and automatic conflict resolution. TypeScript-first with React hooks included.

**What makes GoatDB different?**

- **Works offline:** Changes sync automatically when reconnected
- **Instant UI updates:** Local changes are instant, no loading states
- **Smart conflict resolution:** Git-style three-way merge for live data
- **Self-healing:** Clients can restore crashed servers from the commit graph

GoatDB is under active development. Star ⭐️ our project if you like the approach!

> [!WARNING]
> Please keep in mind that GoatDB is still under active development and therefore full backward compatibility is not guaranteed before reaching v1.0.0. For more details, see the <a href="https://goatdb.dev/docs/faq/">FAQ</a>.

## Quick Start

**Deno** (recommended):

```bash
deno add jsr:@goatdb/goatdb
deno run -A jsr:@goatdb/goatdb init   # scaffold a new project
```

**Node.js** (24+):

```bash
npx jsr add @goatdb/goatdb
npx -y @goatdb/goatdb init            # scaffold a new project
```

### Basic Usage

```ts
import { DataRegistry, GoatDB } from '@goatdb/goatdb';

const kSchemaTask = {
  ns: 'task',
  version: 1,
  fields: {
    text: { type: 'string', required: true },
    done: { type: 'boolean', default: () => false },
  },
} as const;
DataRegistry.default.registerSchema(kSchemaTask);

const db = new GoatDB({ path: './data' });
await db.readyPromise();

const item = db.create('/data/todos', kSchemaTask, {
  text: 'Hello, GoatDB!',
});
item.set('done', true);
```

## React Integration

GoatDB includes React hooks for real-time, offline-capable UIs. See the [React documentation](https://goatdb.dev/docs/react/).

See the <a href="https://goatdb.dev/docs/tutorial/">tutorial</a> for more examples.

## Contributing

We welcome contributions! See the [contributing guide](https://goatdb.dev/docs/contributing/) for setup instructions and guidelines.

## License

GoatDB is licensed under the
<a href="https://github.com/goatplatform/goatdb/blob/main/LICENSE">MIT
License</a>.
