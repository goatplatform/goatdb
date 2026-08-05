---
id: faq
title: FAQ
sidebar_position: 12
slug: /faq
---

# GoatDB FAQ

## What is GoatDB?

GoatDB is an embedded, distributed document database that provides verifiable
local-first state continuity for human-agent systems. It combines deterministic
structural merge, authorization, bounded recovery through retained replicas, and
Ed25519 signed provenance in secure mode (default). The current network topology
is server-coordinated HTTP; shoulder tap is in progress, while WebSocket and
WebRTC are planned.

## Is GoatDB agent memory?

No. Agent memory services remember _for_ an agent: they store and retrieve an
agent's recollections behind a cloud API, separate from your application's
state. GoatDB is the opposite category: a realtime state layer that shares live
state _between_ humans, agents, and tools. Every participant — human or agent —
works against a full local replica through the same API, and
[structural merge](/docs/conflict-resolution) converges concurrent edits. If you
need an agent to remember things, pair a memory service with your app; if you
need an agent to collaborate on your app's state, that's GoatDB.

## How do agents learn about state changes?

Through reactive subscriptions — push, not polling. A GoatDB
[query](/docs/query) updates its results automatically when the underlying data
changes, and `onResultsChanged` notifies subscribers in-process. An agent
subscribes to the state it cares about and reacts when a human (or another
agent) writes, instead of issuing repeated request/response calls the way
MCP-style tool interfaces work.

Changes from other devices arrive through [sync](/docs/sync): over the current
HTTP carrier with a polling trigger (700–1000ms typical application-perceived
remote latency), they appear in the local replica and fire the same
subscriptions. An active shoulder tap is in progress to replace polling as the
trigger.

## How do I audit what an agent did?

In secure mode (default), every commit in the append-only
[commit graph](/docs/commit-graph) carries an Ed25519 session signature. The
graph is the audit trail: you can verify exactly which session key produced
every change, and replay commit sequences to inspect how state evolved.

One honest limit: a signature proves which _session_ signed a commit, not
whether the actor behind it was a human, an agent, or a tool. Mapping session
keys to actors is the application's responsibility. See
[Sessions](/docs/sessions) for details.

## Won't This Architecture Overload the Client?

Generally no for typical application-scale repositories. Modern client devices are significantly more powerful than the fraction of a server's resources allocated to serve them. However, loading very large repositories into memory can strain client resources; design your data model to keep individual repositories small. See [benchmarks](/docs/benchmarks) for performance characteristics.

## Won't it expose sensitive data to clients?

Not when properly configured. GoatDB establishes a private network, unlike public approaches such as Bitcoin or IPFS. Clients only access repositories they have been authorized to sync, and [authorization rules](/docs/authorization) control which sessions can read or write. However, secure deployment requires correctly configuring these rules; misconfigured authorization can expose data. In [trusted mode](/docs/sessions#trusted-mode), all authorization checks are disabled.

## What workload is GoatDB optimized for?

GoatDB is optimized for read-heavy workloads, where reads significantly
outnumber writes — including human-agent collaboration, where humans and AI
agents share live state and both read far more often than they write. For the
occasional writes, GoatDB supports concurrent operations with distributed,
lockless [concurrency control](/docs/architecture). It is ideal for use cases
that naturally segment into logical data repositories.

## Can you delete data from GoatDB?

Yes. Although the underlying structure is an
[append-only commit graph](/docs/commit-graph), GoatDB employs garbage
collection. Data deletion involves marking items as deleted, with garbage
collection handling eventual removal. Note that the garbage collection feature
is still a work in progress and will be fully implemented in upcoming releases.

## How does synchronization work in GoatDB?

GoatDB packages changes into commits appended to an append-only graph. In secure
mode (default), those commits carry Ed25519 session signatures. The
[sync protocol](/docs/sync) uses Bloom filters to discover and reconcile missing
commits.

The durable reconciliation mechanism is carrier-independent. GoatDB currently
uses HTTP with 200ms scheduler checks plus per-repository adaptive 300–1500ms
polling cycles. Active shoulder tap is in progress. WebSocket and WebRTC
carriers are planned, and direct peer-to-peer sync requires WebRTC.

## What sync latency should I expect?

Typical remote synchronization latency is **700–1000ms** in current deployments.
This is application-perceived latency—when data becomes available through the
API—not pure network transmission time.

GoatDB prioritizes consistency and offline-first operation over minimal latency.
No lower-latency result is claimed for shoulder tap, WebSocket, or WebRTC until
it is implemented and measured.

## What is the session key? Does it identify the actor?

In **secure mode** (default), every GoatDB commit is signed with an Ed25519
session key. The signature proves **which session key produced the commit**; it
does not identify whether the actor is a human, agent, or tool. That mapping is
the application's responsibility.

In **trusted mode**, signing, verification, authorization, and provenance are
disabled. The application does not supply signing keys; it opts out of
secure-mode guarantees.

See [Sessions](/docs/sessions) for details.

## Can GoatDB operate offline?

Yes. Every client holds a full local replica of each repository it has opened or been authorized to sync, not of the entire database. When the server is unavailable, peers can continue working with those repositories. Offline updates synchronize through the server after connectivity returns.

Direct peer-to-peer synchronization through WebRTC is planned but not yet
available. WebSocket is also planned. The current topology remains
server-coordinated.

## How does GoatDB handle data conflicts?

GoatDB provides **deterministic structural merge**: Git-style three-way merge at
the field level of document schemas. Concurrent edits converge to a consistent
structural result, and edits to different fields can both survive.

Structural convergence does not guarantee semantic or business correctness, nor
generic conflict markers. Field strategies may select one value, preserve
multiple values, merge a structure, or use last-writer-wins behavior.
Applications must enforce their own domain rules.

Detailed strategies for structural merge are outlined in the
[Conflict Resolution documentation](/docs/conflict-resolution).

## How does GoatDB simplify development?

GoatDB abstracts network and synchronization complexities, providing developers
with a synchronous, in-memory data representation. This design reduces the need
for traditional REST APIs and streamlines application development. Debugging and
deploying GoatDB as a single executable is simpler compared to managing multiple
microservices. A single executable consolidates the application stack, reducing
inter-service communication issues and deployment overhead. For React
applications, GoatDB offers a state management package that integrates with
React hooks, supporting immediate local updates and remote updates after sync.

## What is the deployment process for GoatDB?

Deployment is simplified through a unified artifact that combines the database,
application code, and static assets into a single executable. This approach
ensures compatibility with standard servers and on-premises environments while
reducing operational complexity. Additionally, an upcoming managed service will
make deployment and rolling updates a one-click process, further streamlining
operations for developers and reducing the need for manual interventions.

## How does GoatDB ensure data reliability?

- **Active Replication:** Each peer has a full local replica of every repository
  it opens. After server data loss, an available authorized replica retaining
  relevant history can replay that repository's commit graph.
- **Backup and Restore:** Peers store the repositories they open rather than the
  entire database. Backing up the data is as simple as zipping the live data
  directory.

Recovery depends on at least one authorized replica being available with the
relevant commit history, subject to garbage-collection and retention policies.

## Does GoatDB support schema migrations?

Yes. GoatDB employs version control principles for schema management. Sequential upgrade functions transform data automatically when accessed. Rolling updates are supported without disrupting workflows.

## Can GoatDB integrate with data warehouses?

Yes. GoatDB's schema-based data organization supports straightforward
integration with data warehouses. Its structured approach aligns well with
analytical workflows.

## What debugging tools does GoatDB provide?

GoatDB stores a full commit history per item, enabling inspection of how state evolved over time. Standard tooling can inspect commit graphs and verify session signatures. Additional debugging features are planned.

## How does GoatDB ensure compliance and auditability?

In secure mode (default), commits in the append-only
[commit graph](/docs/commit-graph) carry Ed25519 session signatures, providing a
built-in audit log. This proves session-key provenance rather than actor
identity. See [Sessions](/docs/sessions) for the trusted-mode exception.

## What is the performance impact of GoatDB on client devices?

GoatDB is optimized for lightweight operations on client devices. The
append-only storage model and delta-compressed synchronization reduce
computational overhead while maintaining responsive local interactions. For
detailed performance metrics and benchmarks, see our
[benchmarks page](/docs/benchmarks).

## How does distributed local querying differ from centralized queries?

In GoatDB, each peer performs local querying on its own data subset, eliminating
the need to query a centralized data repository. This approach offers several
benefits:

- **Latency Reduction:** Queries are executed directly on the local peer,
  reducing the round-trip time to a central server.
- **Scalability:** Each peer handles its own query load, allowing the system to
  scale horizontally as more peers are added.
- **Resilience:** Local querying ensures continued functionality even if the
  central server becomes unavailable, supporting offline operations.
- **Focused Query Scope:** By segmenting data logically across peers, queries
  are inherently limited to relevant subsets, improving performance and
  efficiency.

In contrast, centralized queries require all data to be processed in a single
location, often resulting in bottlenecks, increased latency, and reduced fault
tolerance.

## Does GoatDB support Node.js?

Yes. Node.js is a fully supported, first-class runtime alongside Deno. GoatDB
provides a complete Node.js adapter including HTTP server
(`node:http`/`node:https`), file I/O, crypto, workers, and Single Executable
Application (SEA) compilation. Node.js 24+ is required. See the
[installation guide](/docs/install) for setup instructions and the
[examples](https://github.com/goatplatform/goatdb/tree/main/examples) for
working Node.js projects.

## What licensing options does GoatDB offer?

GoatDB is released under the MIT License, a permissive open-source license that
provides:

- Freedom to use the software for any purpose
- Freedom to modify and distribute the software
- No requirement to release your source code when making changes

The MIT license is maximally business-friendly and widely understood, making
GoatDB suitable for both commercial and open-source projects without imposing
any restrictive conditions on users.
