---
id: overview
title: Documentation Overview
sidebar_position: 0
---

# GoatDB Documentation

Welcome to the GoatDB documentation. Here you'll find everything you need to build real-time, collaborative applications with GoatDB.

[GoatDB](https://goatdb.dev/) is an embedded, [distributed](/docs/architecture),
document database that prioritizes [speed](/docs/benchmarks) and
[developer experience](/docs/tutorial/). It excels at real-time collaboration and
embedded caching applications.

Instead of following traditional database design patterns, GoatDB leverages
[concepts](/docs/concepts) refined over decades by distributed version control
systems. These are enhanced with novel algorithms
([bloom filter-based synchronization](/docs/sync/) and
[ephemeral CRDTs](/docs/conflict-resolution)) for efficient [synchronization](/docs/sync)
and automatic real-time conflict resolution.

Currently optimized for TypeScript environments, GoatDB functions as a
first-class citizen in both browsers and servers. It utilizes a
[document model](/docs/concepts) with [schemas](/docs/schema), providing
[causal eventual consistency](https://en.wikipedia.org/wiki/Causal_consistency)
to simplify development while offering built-in optional
[cryptographic signing](/docs/sessions) for the underlying
[commit graph](/docs/commit-graph).

GoatDB implements [incremental local queries](/docs/query), leveraging its version
control internals to efficiently process only changed documents.

GoatDB employs a [memory-first design](/docs/repositories) and a different
[scaling approach](/docs/repositories) than traditional databases. Rather than
growing a single large database, it uses application-level sharding with
multiple medium-sized [repositories](/docs/repositories) that [sync](/docs/sync)
independently. Each user or data group has its own [repository](/docs/repositories),
enabling horizontal scaling and efficient client-server
[synchronization](/docs/sync). This [architecture](/docs/architecture) provides natural
scalability for multi-user applications without complex manual sharding.

Items in [GoatDB](https://goatdb.dev/) are defined alongside their
[schema](/docs/schema). Schemas dictate both the field types and their
[conflict resolution](/docs/conflict-resolution) strategy. [Schemas](/docs/schema) are
themselves versioned, making rolling schema updates via branches a natural
mechanism.

:::tip

Please keep in mind that [GoatDB](https://goatdb.dev/) is still under active
development and therefore full backward compatibility is not guaranteed before
reaching v1.0.0.

:::

If you like what we're building, please star ⭐️ our
[GitHub project](https://github.com/goatplatform/goatdb). We really appreciate
it! 🙏

## License

GoatDB is licensed under the [Apache 2.0 License](https://github.com/goatplatform/goatdb/blob/main/LICENSE).
