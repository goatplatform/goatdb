---
id: architecture
title: Architecture
sidebar_position: 2
slug: /architecture
---

import StackCollapse from '@site/src/components/diagrams/StackCollapse';
import CoreArchitectureV2 from '@site/src/components/diagrams/CoreArchitectureV2';
import ComparisonSplitSimple from '@site/src/components/diagrams/ComparisonSplitSimple';
import RepositoryModel from '@site/src/components/diagrams/RepositoryModel';
import SyncProtocolV2 from '@site/src/components/diagrams/SyncProtocolV2';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# GoatDB Architecture

GoatDB collapses the traditional database-server-client stack into a single
executable. Because every participant embeds the same stack — a human's UI, an
agent's process, a relay server — all of them share one state substrate instead
of passing data across API boundaries. This eliminates operational complexity
while providing stronger consistency guarantees than traditional
[distributed systems](/docs/concepts).

## The Stack Collapse

Traditional web applications create unnecessary complexity by requiring three
separate systems: frontend, backend, and database. Each needs deployment,
monitoring, and coordination between layers.

<StackCollapse />

GoatDB transforms this architecture by running everything together. Your data
lives locally in [repositories](/docs/repositories), loaded-data reads and local writes are synchronous, and [network sync](/docs/sync) happens automatically in the background. This means one deployment instead of three, with reduced configuration and coordination overhead. Opening repositories, sync, and lifecycle operations remain async.

This fundamental shift creates tangible real-world benefits. Operationally, you
deploy one executable; a crashed server recovers its state from an available
authorized replica that retains the relevant commit history. For development,
synchronous local operations eliminate loading states and async complexity. In
distributed environments, applications work offline with
[deterministic structural merge](/docs/conflict-resolution) and collaborative
features without coordination.

The cumulative result is fewer moving parts, faster development cycles, and more
reliable applications that handle network failures gracefully.

## Core Architecture

Building on this collapsed stack approach, GoatDB's architecture consists of six
interconnected layers that work together to replace traditional
database-server-client complexity with a single coherent system.

<CoreArchitectureV2 />

At the top, [React Integration](/docs/react) provides optional hooks that make
data reactive in your UI. When data changes locally, React components
automatically re-render without manual state management or loading states.
Changes that arrive from remote peers trigger the same reactions once they land
through [sync](/docs/sync).

The Database Core serves as the main developer API for creating, reading, and
updating data. [Sessions](/docs/sessions) handle authentication and permissions,
while [items](/docs/read-write-data) provide direct object manipulation. All
operations remain synchronous because data lives in memory rather than requiring
network calls.

Below this, the [Repository System](/docs/repositories) organizes data using
Git-like repositories where every change creates a versioned commit.
[Queries](/docs/query) process changes incrementally, maintaining performance as
data grows. This layer provides the version control foundation that enables
time-travel and collaborative editing capabilities.

The [Conflict Resolution](/docs/conflict-resolution) layer deterministically
merges concurrent changes without locks or retry coordination. Structural
convergence does not guarantee semantic or business correctness; applications
remain responsible for domain invariants.

Supporting these capabilities, the [Networking Layer](/docs/sync) keeps all
peers synchronized. The sync protocol is transport-independent and runs over a
pluggable **carrier** — currently **HTTP**, with WebSocket and WebRTC planned.
Sync is triggered by **polling** with 200ms scheduler checks and per-repository
adaptive 300–1500ms cycles, producing 700–1000ms typical application-perceived
remote latency. An active **shoulder tap** is in progress to replace polling as
the trigger; it is not yet measured to improve latency. Compact signatures
minimize bandwidth usage while handling network failures gracefully. Recovery
after a crash is bounded by the availability of an authorized replica that
retains the relevant commit history.

At the foundation, the Runtime Abstraction makes everything work identically
across Deno, Node.js, and browsers. This layer handles platform differences in
storage and networking so your application code works everywhere without
changes. No native mobile runtime exists yet.

## Architectural Benefits in Practice

These architectural decisions create practical advantages that address common
development pain points. Rather than theoretical benefits, GoatDB's design
eliminates specific complexities that developers face daily.

### Eliminates Frontend Complexity

<ComparisonSplitSimple
  title="Frontend State Management"
  traditional={{
    label: "Traditional Approach",
    items: [
      "Loading states throughout the app for every data operation",
      "Async complexity spread across every component",
      "Manual coordination of network requests and UI state",
      "Optimistic updates and cache invalidation everywhere"
    ],
    complexity: "high"
  }}
  goatdb={{
    label: "GoatDB Approach",
    items: [
      "Single loading state during app initialization",
      "Local writes and loaded-data reads are synchronous",
      "Opened repository data is locally available after startup",
      "Automatic background sync without UI blocking"
    ],
    complexity: "low"
  }}
/>

The fundamental difference stems from where data lives. Most databases reside on
servers, forcing every UI interaction to become an async network operation.
GoatDB runs in your application, making data access synchronous while
[sync](/docs/sync) happens transparently in the background. See the
[tutorial](/docs/tutorial) for a practical example of this simplified
development experience.

### Eliminates Database Migration Pain

<ComparisonSplitSimple
  title="Schema Evolution"
  traditional={{
    label: "SQL Migrations",
    items: [
      "Database locks block all operations during migrations",
      "Failed migrations require emergency rollbacks with data loss risk",
      "Breaking schema changes force coordinated releases across teams",
      "Production hotfixes blocked by pending migration dependencies"
    ],
    complexity: "high"
  }}
  goatdb={{
    label: "GoatDB Evolution",
    items: [
      "Automatic field-level upgrades during data access",
      "Mixed-version deployments merge changes seamlessly",
      "Schema changes deploy independently without coordination",
      "Safe rollbacks through branch-based version control"
    ],
    complexity: "low"
  }}
/>

GoatDB's [schema evolution](/docs/schema) leverages its Git-like architecture to
eliminate traditional migration pain. Sequential upgrade functions transform
data automatically when accessed, while the
[branch-based model](/docs/repositories) enables safe mixed-version deployments.
New application versions can merge changes from older versions during gradual
rollouts, eliminating coordination overhead. When rollbacks are needed, you
switch branches rather than attempting risky downgrade migrations.

### Eliminates Server State Management

<ComparisonSplitSimple
  title="Server Operations"
  traditional={{
    label: "Traditional Servers",
    items: [
      "Connection pools require constant tuning and monitoring",
      "Server crashes mean complex backup/restore procedures",
      "Cache invalidation cascades break application logic",
      "Database clustering requires coordination and split-brain prevention"
    ],
    complexity: "high"
  }}
  goatdb={{
    label: "GoatDB Servers",
    items: [
      "Stateless synchronization nodes with no local authoritative store",
      "Crashed servers recover from available authorized replicas that retain relevant history",
      "No cache invalidation - clients manage their own state",
      "Add servers without coordination or configuration"
    ],
    complexity: "low"
  }}
/>

GoatDB inverts traditional server architecture by treating servers as stateless
synchronization nodes rather than authoritative data stores. Clients hold the
authoritative data and use cryptographic sessions that work across any server.
When a server crashes, an available authorized replica restores its missing data
during the next sync, provided that replica retains the relevant commit history.
This is bounded by replica availability and retention. Recovery requires at least one authorized replica retaining relevant history; it is not automatic across arbitrary peer failures. This removes the
need for connection pools, cache invalidation, and server clustering
coordination. For use cases that require server-side processing — such as
webhook receivers or third-party API integrations — GoatDB provides an
[endpoint and middleware system](/docs/server-logic) that runs alongside the
synchronization layer.

## Repository System

These architectural benefits are made possible by GoatDB's unique approach to
data organization, which mirrors how desktop applications handle files.

<RepositoryModel />

When data lives locally, a [repository](/docs/repositories) becomes just a file
on disk. Opening a repository works like Word opening a document—the entire file
gets paged into memory for fast access. This fundamentally differs from
traditional databases where every operation requires a network round-trip to a
remote server.

Just as you wouldn't put every document in a single massive file, GoatDB
naturally shards data across multiple repositories. Each repository stays small
enough to load quickly and sync efficiently. You only open the repositories your
application actually needs, just like you only open the files you're working on.

This approach enables natural scaling that mirrors desktop application behavior.
When you need more data capacity, you create more repositories rather than
making existing ones larger. Different users can work with different sets of
repositories based on their needs. The system maintains speed because data
access remains local, while [sync](/docs/sync) happens in the background to keep
everything consistent across the network. See [benchmarks](/docs/benchmarks) for
performance characteristics of this approach.

## System Properties

The repository system creates several fundamental properties that distinguish
GoatDB from traditional database architectures. These properties work together
to deliver the practical benefits outlined above.

### Works Like Desktop Files, Not Remote Servers

Opening a repository resembles opening a document—everything loads into memory
for instant access. Traditional databases require network round-trips for every
query, creating loading states and async complexity throughout applications.
GoatDB eliminates this by making data operations synchronous after initial load.

In practical terms, your [React components](/docs/react) never need loading
states for data that's already loaded. When a user clicks to complete a task,
`task.set('done', true)` executes immediately, just like editing text in a
document. This synchronous behavior transforms user experience by eliminating
the delays and uncertainty that come from remote data access.

### Deterministic Structural Merge Without Coordination

Multiple actors — people and agents alike — can edit concurrently without lock
coordination. GoatDB's
[conflict resolution algorithms](/docs/conflict-resolution) merge changes at the
data-structure level so replicas converge to the same structural result.

This convergence guarantee does not imply semantic or business correctness.
Applications remain responsible for domain invariants and any required review.

### Self-Healing Distribution

Servers function as stateless synchronization nodes rather than authoritative
data stores, so a crash loses no server-local authoritative state. Their data is
restored by an available authorized replica during the next sync, provided that
replica retains the relevant commit history. Recovery requires an available authorized replica retaining relevant history; it is not automatic across arbitrary peer failures. When server-side logic is needed, see
[Server-Side Logic](/docs/server-logic).

This architectural inversion means expensive servers no longer hold all state
while fragile clients coordinate access. Instead, abundant client hardware
performs the computational work while simple servers relay changes. Recovery requires at least one authorized replica retaining relevant history; it is not a substitute for replica availability and retention planning.

### Minimal Operational Overhead

Deployment involves running one binary—no load balancers, database setup, or infrastructure coordination required. The same code runs identically across Deno, Node.js, and browsers. See the [installation guide](/docs/install) for deployment details.

Application-level configuration is still required: [schemas must be registered](/docs/schema) before use, [authorization rules](/docs/authorization) must be configured for secure deployments, and all paths must follow the strict `/type/repo/item` format. Because databases are just files on disk, they can be backed up live with a simple zip command. Learn more about [repository storage](/docs/repositories) and [session management](/docs/sessions).

## Synchronization Protocol

These system properties depend on a
[stateless synchronization protocol](/docs/sync) that handles distributed
coordination automatically.

### Transport-Independent Sync Protocol

GoatDB's sync protocol is a durable, transport-independent reconciliation
mechanism. It separates three concerns:

1. **Trigger** — what tells a peer to begin syncing. Currently **polling**, with
   200ms scheduler checks and per-repository adaptive 300–1500ms cycles. An
   active **shoulder tap** (ephemeral push notification) is in progress to
   replace polling.
2. **Carrier** — the transport layer for sync messages. Currently **HTTP**.
   WebSocket and WebRTC carriers are planned.
3. **Topology** — how peers connect. Currently **server-coordinated**: peers
   sync through relay servers. True direct peer-to-peer sync requires the
   planned WebRTC carrier.

When you edit data on your laptop, those changes propagate to your phone, your
server, and your colleagues' devices through this protocol.

Servers play a dual role in this architecture. By default, they act as relays
for clients to enable quality of service and reliable connectivity. Servers also
enforce permissions by owning cryptographic root keys that validate
[user authentication](/docs/sessions) and control access to system data.

### Current vs Target Network Architecture

| Aspect         | Current (shipping)                                                             | Future status                           |
| -------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| Sync trigger   | Polling: 200ms scheduler checks plus per-repository adaptive 300–1500ms cycles | Active shoulder tap — **in progress**   |
| Carrier        | HTTP                                                                           | WebSocket and WebRTC — **planned**      |
| Topology       | Server-coordinated                                                             | Direct P2P through WebRTC — **planned** |
| Remote latency | 700–1000ms typical                                                             | No claim until implemented and measured |

<SyncProtocolV2 />

### Efficient Data Discovery

Rather than comparing full inventories, devices exchange compact summaries to
identify missing data. This mathematical approach minimizes bandwidth usage
while guaranteeing that all devices eventually converge to the same state.

The sync process happens through four automatic steps: peers discover what each
other has, identify gaps in their data, transfer only missing commits, and
integrate changes into local [queries](/docs/query). Your application code never
needs to coordinate this process—it happens transparently in the background. See
the [detailed sync protocol](/docs/sync) for technical implementation.

### Automatic Failure Recovery

A crashed server restarts with no local authoritative state and is repopulated
from available authorized replicas during subsequent sync cycles, provided those
replicas retain the relevant commit history. Network partitions heal when
connectivity returns and affected replicas sync. Recovery is bounded by the
availability of an authorized replica retaining the relevant history; it is not
a guarantee against all failure modes.

This approach reduces traditional operational overhead. Durable commit-graph
reconciliation can repopulate a server, but resilience still depends on keeping
at least one authorized replica with the required retained history.

### Background Integration

User interactions remain synchronous while sync happens invisibly in the
background. When new commits arrive from other devices, [queries](/docs/query)
recompute incrementally and [React components](/docs/react) update automatically
without loading states or cache invalidation logic.

Traditional realtime systems require WebSockets, message queues, and complex
state management to coordinate changes across clients. GoatDB's
[sync layer](/docs/sync) works transparently—your application code doesn't need
to handle network coordination or realtime updates explicitly.

## When This Architecture Fits

Understanding when GoatDB's architecture provides the most value helps determine
if it matches your application's needs and constraints.

### Shared Human-Agent State

Applications where AI agents and humans work on the same data typically stitch
together request/response APIs, polling loops, and a separate audit log. GoatDB
instead gives every actor — human or agent — a local replica of the same
repositories with live push subscriptions, so an agent process reacts to state
changes as they happen rather than polling for them. Concurrent edits from both
sides converge through
[deterministic structural merge](/docs/conflict-resolution), and in secure mode
every commit carries signed provenance: you can verify which session wrote what,
while your application maps those sessions to the humans, agents, and tools
behind them (see [Sessions](/docs/sessions)).

This fits supervisor/executor workflows, agent-assisted editors, and any system
where work must survive restarts, offline gaps, and handoffs between actors. See
the [tutorial](/docs/tutorial) for a working agent participant.

### Collaborative and Offline-First Applications

Building applications where users work together traditionally requires WebSocket
infrastructure, complex state synchronization, and manual conflict resolution.
GoatDB provides deterministic structural merge with offline capability built
directly into the architecture. Local edits are reflected immediately, and
changes from other peers become visible after they arrive through
[sync](/docs/sync) (typical 700–1000ms application-perceived remote latency over
the current HTTP polling carrier).

This approach works particularly well for document editors, project management
tools, design platforms, and team dashboards where multiple users edit the same
data and expect local responsiveness without the complexity of traditional
realtime systems. See the [tutorial](/docs/tutorial) for a practical
collaborative application example.

### Distributed Systems Without Operational Overhead

Applications requiring multi-region deployments or backend services typically
struggle with replication logic, disaster recovery planning, and
environment-specific configuration. GoatDB's
[single-binary deployment](/docs/install) works identically everywhere with
mathematical [sync guarantees](/docs/sync).

This architecture excels for SaaS platforms serving global users, microservices
sharing data across regions, and applications requiring ultra-cheap
single-tenant deployments for enterprise customers or compliance requirements.

### Mobile and Offline-First Applications

Creating applications that work seamlessly offline and online traditionally
involves complex synchronization logic, loading states, and poor offline
experiences. GoatDB provides desktop-class responsiveness with
[background sync](/docs/sync) that requires no additional application logic.

This approach works exceptionally well for productivity apps, note-taking tools,
field service applications, and IoT device fleets where connectivity is
intermittent and local-first operation is essential for user experience.

### Rapid Development and Testing

Teams wanting to focus on application logic without database infrastructure
overhead can benefit from GoatDB's eliminated setup complexity. Traditional
full-stack development requires database setup, migration management, and
deployment coordination that slows iteration cycles. Start with the
[installation guide](/docs/install) and follow the [tutorial](/docs/tutorial)
for rapid development.

This architecture works best with human-scale datasets per instance,
applications where eventual consistency is acceptable, and teams that value
development velocity and operational simplicity over infinite horizontal scale.
See the [FAQ](/docs/faq) for common questions about when GoatDB fits.

## Design Philosophy

This architecture emerges from recognizing that modern hardware has
fundamentally inverted traditional database assumptions. Client devices now
contain the majority of available computing power, while servers have become the
expensive, constrained resource.

By moving data to where compute is abundant and treating servers as simple
coordination nodes, GoatDB achieves both superior performance and dramatically
reduced complexity. This architectural shift enables a new class of
applications: truly offline-first collaborative tools, human-agent systems where
both sides read and write the same live state as peers, mobile apps with
desktop-class responsiveness, and distributed systems that deploy as easily as
desktop applications.

The result represents a fundamental shift from complex coordinated systems to
simple mathematical guarantees, from operational overhead to single-binary
deployment, and from eventual consistency as a compromise to eventual
consistency as an architectural strength.
