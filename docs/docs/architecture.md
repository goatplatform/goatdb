---
id: architecture
title: Architecture
sidebar_position: 2
slug: /architecture
---

import StackArchitectureV2 from '@site/src/components/diagrams/StackArchitectureV2';
import CoreArchitectureV2 from '@site/src/components/diagrams/CoreArchitectureV2';
import ComparisonSplitSimple from '@site/src/components/diagrams/ComparisonSplitSimple';
import RepositoryModel from '@site/src/components/diagrams/RepositoryModel';
import SyncProtocolV2 from '@site/src/components/diagrams/SyncProtocolV2';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# GoatDB Architecture

GoatDB collapses the traditional database-server-client stack into a single executable. This eliminates operational complexity while providing stronger consistency guarantees than traditional [distributed systems](/docs/concepts).

## The Stack Collapse

Traditional web applications create unnecessary complexity by requiring three separate systems: frontend, backend, and database. Each needs deployment, monitoring, and coordination between layers.

<StackArchitectureV2 />

GoatDB transforms this architecture by running everything together. Your data lives locally in [repositories](/docs/repositories), operations are synchronous, and [network sync](/docs/sync) happens automatically in the background. This means one deployment instead of three, with no configuration and no coordination overhead.

This fundamental shift creates tangible real-world benefits. Operationally, you deploy one executable while servers auto-heal from clients with zero configuration. For development, synchronous local operations eliminate loading states and async complexity. In distributed environments, applications work offline with [automatic conflict resolution](/docs/conflict-resolution) and collaborative features without coordination.

The cumulative result is fewer moving parts, faster development cycles, and more reliable applications that handle network failures gracefully.

## Core Architecture

Building on this collapsed stack approach, GoatDB's architecture consists of six interconnected layers that work together to replace traditional database-server-client complexity with a single coherent system.

<CoreArchitectureV2 />

At the top, [React Integration](/docs/react) provides optional hooks that make data reactive in your UI. When data changes anywhere in the distributed system, React components automatically re-render without manual state management or loading states.

The Database Core serves as the main developer API for creating, reading, and updating data. [Sessions](/docs/sessions) handle authentication and permissions, while [items](/docs/read-write-data) provide direct object manipulation. All operations remain synchronous because data lives in memory rather than requiring network calls.

Below this, the [Repository System](/docs/repositories) organizes data using Git-like repositories where every change creates a versioned commit. [Queries](/docs/query) process changes incrementally, maintaining performance as data grows. This layer provides the version control foundation that enables time-travel and collaborative editing capabilities.

The [Conflict Resolution](/docs/conflict-resolution) layer automatically merges concurrent changes without coordination or manual intervention. When multiple users edit the same data simultaneously, proven algorithms ensure everyone converges to the same result without requiring locks or retry logic.

Supporting these capabilities, the [Networking Layer](/docs/sync) keeps all peers synchronized through efficient peer-to-peer communication. Compact signatures minimize bandwidth usage while handling network failures gracefully, allowing any peer to crash and recover without data loss.

At the foundation, the Runtime Abstraction makes everything work identically across browsers, servers, and mobile apps. This layer handles platform differences in storage and networking so your application code works everywhere without changes.

## Architectural Benefits in Practice

These architectural decisions create practical advantages that address common development pain points. Rather than theoretical benefits, GoatDB's design eliminates specific complexities that developers face daily.

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
      "All user interactions are synchronous",
      "Data always instantly available after startup",
      "Automatic background sync without UI blocking"
    ],
    complexity: "low"
  }}
/>

The fundamental difference stems from where data lives. Most databases reside on servers, forcing every UI interaction to become an async network operation. GoatDB runs in your application, making data access synchronous while [sync](/docs/sync) happens transparently in the background. See the [tutorial](/docs/tutorial) for a practical example of this simplified development experience.

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

GoatDB's [schema evolution](/docs/schema) leverages its Git-like architecture to eliminate traditional migration pain. Sequential upgrade functions transform data automatically when accessed, while the [branch-based model](/docs/repositories) enables safe mixed-version deployments. New application versions can merge changes from older versions during gradual rollouts, eliminating coordination overhead. When rollbacks are needed, you switch branches rather than attempting risky downgrade migrations.

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
      "Stateless servers crash without data loss",
      "Clients automatically heal crashed servers",
      "No cache invalidation - clients manage their own state",
      "Add servers without coordination or configuration"
    ],
    complexity: "low"
  }}
/>

GoatDB inverts traditional server architecture by treating servers as stateless synchronization nodes rather than authoritative data stores. Clients hold the authoritative data and use cryptographic sessions that work across any server. When servers crash, the peer-to-peer network automatically restores missing data from connected clients, eliminating backup/restore complexity. This removes the need for connection pools, cache invalidation, and server clustering coordination.

## Repository System

These architectural benefits are made possible by GoatDB's unique approach to data organization, which mirrors how desktop applications handle files.

<RepositoryModel />

When data lives locally, a [repository](/docs/repositories) becomes just a file on disk. Opening a repository works like Word opening a document—the entire file gets paged into memory for fast access. This fundamentally differs from traditional databases where every operation requires a network round-trip to a remote server.

Just as you wouldn't put every document in a single massive file, GoatDB naturally shards data across multiple repositories. Each repository stays small enough to load quickly and sync efficiently. You only open the repositories your application actually needs, just like you only open the files you're working on.

This approach enables natural scaling that mirrors desktop application behavior. When you need more data capacity, you create more repositories rather than making existing ones larger. Different users can work with different sets of repositories based on their needs. The system maintains speed because data access remains local, while [sync](/docs/sync) happens in the background to keep everything consistent across the network. See [benchmarks](/docs/benchmarks) for performance characteristics of this approach.

## System Properties

The repository system creates several fundamental properties that distinguish GoatDB from traditional database architectures. These properties work together to deliver the practical benefits outlined above.

### Works Like Desktop Files, Not Remote Servers

Opening a repository resembles opening a document—everything loads into memory for instant access. Traditional databases require network round-trips for every query, creating loading states and async complexity throughout applications. GoatDB eliminates this by making data operations synchronous after initial load.

In practical terms, your [React components](/docs/react) never need loading states for data that's already loaded. When a user clicks to complete a task, `task.set('done', true)` executes immediately, just like editing text in a document. This synchronous behavior transforms user experience by eliminating the delays and uncertainty that come from remote data access.

### Automatic Conflict Resolution Without Coordination

Multiple people can edit simultaneously without complex coordination protocols. When users edit the same todo item across different devices, [conflict resolution algorithms](/docs/conflict-resolution) automatically merge changes at the data level—everyone ends up with the same result without manual intervention.

Traditional databases require lock coordination, retry logic, or manual conflict resolution. GoatDB combines 3-way merges with proven conflict-free algorithms that guarantee convergence without any coordination overhead. This means collaborative features work naturally without the complexity typically associated with real-time editing.

### Self-Healing Distribution

Servers crash without consequence because they function as stateless synchronization nodes rather than authoritative data stores. Clients automatically restore missing data to crashed servers, eliminating the backup/restore complexity that burdens traditional systems.

This architectural inversion means expensive servers no longer hold all state while fragile clients coordinate access. Instead, abundant client hardware performs the computational work while simple servers relay changes. The stateless nature of the synchronization protocol ensures reliability without operational intervention.

### Zero Configuration Operations

Deployment involves running one binary—everything works without load balancers, database setup, or infrastructure coordination. The same code runs identically across browsers, servers, and mobile environments. See the [installation guide](/docs/install) for deployment details.

Because databases are just files on disk, traditional operational complexity disappears entirely. GoatDB eliminates many DevOps overheads by treating databases as simple files that can be backed up live with a simple zip command and deployed anywhere without configuration. Learn more about [repository storage](/docs/repositories) and [session management](/docs/sessions).

## Synchronization Protocol

These system properties depend on a [stateless synchronization protocol](/docs/sync) that handles distributed coordination automatically.

### Stateless Peer-to-Peer Coordination

Every device in the network can sync with any other device without requiring centralized coordination. When you edit data on your laptop, those changes propagate to your phone, your server, and your colleagues' devices through peer communication.

Servers play a dual role in this architecture. By default, they act as relays for clients to enable quality of service and reliable connectivity. However, clients may optionally choose to sync directly with each other, moving data truly end-to-end so the server never sees it. Servers also enforce permissions by owning cryptographic root keys that validate [user authentication](/docs/sessions) and control access to system data.

<SyncProtocolV2 />

### Efficient Data Discovery

Rather than comparing full inventories, devices exchange compact summaries to identify missing data. This mathematical approach minimizes bandwidth usage while guaranteeing that all devices eventually converge to the same state.

The sync process happens through four automatic steps: peers discover what each other has, identify gaps in their data, transfer only missing commits, and integrate changes into local [queries](/docs/query). Your application code never needs to coordinate this process—it happens transparently in the background. See the [detailed sync protocol](/docs/sync) for technical implementation.

### Automatic Failure Recovery  

Crashed servers restart without data loss because clients automatically restore missing commits during the next sync cycle. Network partitions heal seamlessly when connectivity returns. The stateless nature of the protocol means each sync cycle can recover from any previous failures without manual intervention.

This approach eliminates traditional operational overhead. There are no backup procedures, no manual intervention during outages, and no environment-specific configuration. Mathematical guarantees replace operational complexity, making the system self-managing in most failure scenarios.

### Background Integration

User interactions remain synchronous while sync happens invisibly in the background. When new commits arrive from other devices, [queries](/docs/query) recompute incrementally and [React components](/docs/react) update automatically without loading states or cache invalidation logic.

Traditional real-time systems require WebSockets, message queues, and complex state management to coordinate changes across clients. GoatDB's [sync layer](/docs/sync) works transparently—your application code doesn't need to handle network coordination or real-time updates explicitly.

## When This Architecture Fits

Understanding when GoatDB's architecture provides the most value helps determine if it matches your application's needs and constraints.

### Collaborative and Real-Time Applications

Building applications where users work together or need instant updates traditionally requires WebSocket infrastructure, complex state synchronization, and manual conflict resolution. GoatDB provides [automatic real-time collaboration](/docs/conflict-resolution) with offline capability built directly into the architecture.

This approach works particularly well for document editors, project management tools, design platforms, and team dashboards where multiple users edit simultaneously and expect immediate responsiveness without the complexity of traditional real-time systems. See the [tutorial](/docs/tutorial) for a practical collaborative application example.

### Distributed Systems Without Operational Overhead

Applications requiring multi-region deployments or backend services typically struggle with replication logic, disaster recovery planning, and environment-specific configuration. GoatDB's [single-binary deployment](/docs/install) works identically everywhere with mathematical [sync guarantees](/docs/sync).

This architecture excels for SaaS platforms serving global users, microservices sharing data across regions, and applications requiring ultra-cheap single-tenant deployments for enterprise customers or compliance requirements.

### Mobile and Offline-First Applications

Creating applications that work seamlessly offline and online traditionally involves complex synchronization logic, loading states, and poor offline experiences. GoatDB provides desktop-class responsiveness with [background sync](/docs/sync) that requires no additional application logic.

This approach works exceptionally well for productivity apps, note-taking tools, field service applications, and IoT device fleets where connectivity is intermittent and local-first operation is essential for user experience.

### Rapid Development and Testing

Teams wanting to focus on application logic without database infrastructure overhead can benefit from GoatDB's eliminated setup complexity. Traditional full-stack development requires database setup, migration management, and deployment coordination that slows iteration cycles. Start with the [installation guide](/docs/install) and follow the [tutorial](/docs/tutorial) for rapid development.

This architecture works best with human-scale datasets per instance, applications where eventual consistency is acceptable, and teams that value development velocity and operational simplicity over infinite horizontal scale. See the [FAQ](/docs/faq) for common questions about when GoatDB fits.

## Design Philosophy

This architecture emerges from recognizing that modern hardware has fundamentally inverted traditional database assumptions. Client devices now contain the majority of available computing power, while servers have become the expensive, constrained resource.

By moving data to where compute is abundant and treating servers as simple coordination nodes, GoatDB achieves both superior performance and dramatically reduced complexity. This architectural shift enables a new class of applications: truly offline-first collaborative tools, mobile apps with desktop-class responsiveness, and distributed systems that deploy as easily as desktop applications.

The result represents a fundamental shift from complex coordinated systems to simple mathematical guarantees, from operational overhead to single-binary deployment, and from eventual consistency as a compromise to eventual consistency as an architectural strength.
