---
# Feel free to add content and custom Front Matter to this file.
# To modify the layout, see https://jekyllrb.com/docs/themes/#overriding-theme-defaults

layout: home
title: Home
nav_exclude: true
---

# GoatDB: An Embedded, Distributed, Document Database

<p align="center">
📦 <a href="/install">Installation</a> •
🚀 <a href="/tutorial">Tutorial</a> • ❓ <a href="/faq">FAQ</a> • <a href="/benchmarks">⚡ Benchmarks</a> • 💬 <a href="https://github.com/goatplatform/goatdb/discussions">Discussions</a> • 👋 <a href="https://discord.gg/SAt3cbUqxr">Discord</a>
</p>

GoatDB is an embedded, distributed, document database that prioritizes
[speed](/benchmarks) and [developer experience](/tutorial/). It excels at
real-time collaboration and embedded caching applications.

Instead of following traditional database design patterns, GoatDB leverages
concepts refined over decades by distributed version control systems. These are
enhanced with novel algorithms ([bloom filter-based synchronization](/sync/) and
[ephemeral CRDTs](/conflict-resolution)) for efficient synchronization and
automatic real-time conflict resolution.

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
versioned, making rolling schema updates via branches a natural mechanism.

If you like what we're building, please star ⭐️ our
[GitHub project](https://github.com/goatplatform/goatdb). We really appreciate
it! 🙏

## Getting Started

- [Installation Instructions](/install) - How to add GoatDB to your project
- [Tutorial](/tutorial) - Build your first application with GoatDB
- [FAQ](/faq) - Common questions about GoatDB
- [Benchmarks](/benchmarks) - Performance metrics

## Example Projects

Explore projects built with GoatDB:

- **[Todo](https://github.com/goatplatform/todo)**: A minimalist, modern, todo
  list app specifically designed for self hosting.

- **[EdgeChat](https://github.com/goatplatform/edge-chat)**: A demo of a
  ChatGPT-like interface that runs completely in the browser, no network
  connection needed.

- **[Ovvio](https://ovvio.io)**: A productivity suite that has been powered by
  GoatDB in production since January 2024.

## License

GoatDB is licensed under the [Apache 2.0 License](LICENSE).
