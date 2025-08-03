---
id: architecture
title: Architecture
sidebar_position: 2
slug: /architecture
---

import RepositoryModel from '@site/src/components/diagrams/RepositoryModel';
import MemoryManagement from '@site/src/components/diagrams/MemoryManagement';
import QueryProcessing from '@site/src/components/diagrams/QueryProcessing';
import SyncProtocol from '@site/src/components/diagrams/SyncProtocol';
import GarbageCollection from '@site/src/components/diagrams/GarbageCollection';

# GoatDB Architecture

[GoatDB](/) is a distributed, [schema-based](/docs/schema) database that implements
novel approaches to data [synchronization](/docs/sync) and
[conflict resolution](/docs/conflict-resolution), drawing inspiration from
distributed version control systems (DVCS). This document explores the technical
foundations and design decisions that shape GoatDB's architecture.

## Repository-Centric Design

<RepositoryModel />

The [repository model](/docs/repositories) in [GoatDB](/) takes inspiration from DVCS
systems but adapts it for database operations. Each [repository](/docs/repositories)
functions as an independent unit of data [synchronization](/docs/sync) and
[access control](/docs/authorization), providing natural boundaries for data
isolation. This design enables independent [synchronization](/docs/sync) operations
and gives applications fine-grained control over which data sets are loaded into
memory.

At the core of this model is the concept of item-level
[commit graphs](/docs/commit-graph). Each [item](/docs/concepts#item), identified by its
key, maintains its own independent [commit graph](/docs/commit-graph). This approach
enables parallel evolution of items and efficient concurrent operations.
[Access control](/docs/authorization) is implemented at the [item](/docs/concepts#item)
level through repository-level
[authorization rules](/docs/authorization/#creating-authorization-rules), striking a
balance between granularity and [performance](/docs/benchmarks).

The [repository model](/docs/repositories) presents several technical challenges that
require careful consideration. Managing repository
[commit histories](/docs/commit-graph) efficiently is crucial, as is coordinating
cross-repository [queries](/docs/query). The
[repository lifecycle](/docs/repositories/#opening-a-repository) must be carefully
managed, and [authorization rules](/docs/authorization/#creating-authorization-rules)
need to be designed with performance in mind.

## Memory Management

<MemoryManagement />

GoatDB's memory management approach prioritizes explicit control over automatic
optimization. This design decision reflects several technical tradeoffs. While
only active [repositories](/docs/repositories) consume memory, loading a
[repository](/docs/repositories) requires its full [commit history](/docs/commit-graph).
This explicit repository management enables
[predictable performance](/docs/benchmarks) characteristics and allows applications
to implement custom caching and loading strategies.

Looking ahead, several technical improvements are under consideration. Lazy
loading of [commit history](/docs/commit-graph) could reduce initial memory
requirements, while zero-copy operations
([see GitHub issue #36](https://github.com/goatplatform/goatdb/issues/36)) could
minimize memory overhead. Automatic
[repository lifecycle](/docs/repositories/#opening-a-repository) management
([see GitHub issue #34](https://github.com/goatplatform/goatdb/issues/34)) with
configurable policies might provide a balance between control and convenience.

## Local Query Processing

<QueryProcessing />

The [query system](/docs/query) in GoatDB implements a deterministic, real-time query
engine that processes data locally while maintaining consistency across
distributed peers. At its core, the system treats queries as first-class
citizens with their own lifecycle and state management.

Each query maintains its own commit history tracking, allowing it to efficiently
process incremental updates without full recomputation. When new commits arrive,
queries resume execution from their last known state, only processing the new
changes. This approach enables real-time updates while maintaining predictable
performance characteristics.

Queries use plain JavaScript functions for filtering and sorting, making them
easy to write and understand. To prevent blocking during large dataset scans,
these functions run in a coroutine that yields control back to the event loop.
On the client, this ensures smooth UI responsiveness. On the server, it allows
other requests to be processed while long-running queries execute.

Queries can be composed by chaining them together, where one query's results
become the input for another. This composition model enables complex data
transformations while maintaining efficiency - each query in the chain only
processes the results of the previous query, and updates only affect the
necessary parts of the chain.

## Storage Model

GoatDB's storage model emphasizes simplicity and reliability. Each repository is
stored as a single file, with the entire database residing in a single
directory. This design choice enables atomic operations through file-based
storage, simplifies backup and restore procedures, and provides a
platform-independent storage format. The direct file access also facilitates
debugging and troubleshooting.

## Synchronization Protocol

<SyncProtocol />

The [synchronization protocol](/docs/sync) implements a stateless, delta-compressed
approach to data exchange. This design enables efficient transmission of changes
without requiring persistent sync state. The protocol is transport-independent,
working over any communication channel, and includes automatic handling of
concurrent modifications.

The protocol's design naturally enables peer-to-peer data recovery through its
distributed nature. Each peer maintains a complete copy of the data, and the
synchronization mechanism automatically handles data verification and recovery
when peers reconnect. This approach provides built-in redundancy without
requiring a separate recovery system. Cryptographic verification ensures data
integrity during both synchronization and recovery operations.

## Garbage Collection

<GarbageCollection />

GoatDB's garbage collection system (currently in design phase) uses a time-based
approach to managing commit history. It takes advantage of the system's
time-based nature. Commits older than the maximum session expiration time can be
safely discarded without compromising offline capabilities, creating a natural
boundary for garbage collection.

The system faces an interesting technical challenge: how to safely remove full
snapshot commits while maintaining the integrity of
[delta-compressed](/docs/commit-graph/#delta-compression) commits that depend on
them. This requires careful coordination between garbage collection and delta
compression to ensure atomic removal of full snapshots and their dependent
commits. The solution lies in treating the commit graph as a unit of garbage
collection, where entire branches of expired commits can be removed together.

## Technical Tradeoffs and Future Directions

GoatDB's architecture makes several deliberate technical tradeoffs. The system
prioritizes core functionality over complex features, favoring explicit control
over automatic optimization. It ensures consistency at the cost of some
performance overhead, reflecting a design philosophy that values reliability and
predictability.

Future technical exploration will focus on:

- Large scale backend deployment and benchmarks to validate performance
  characteristics and scalability in production environments
- Application-provided merge strategy to enable custom conflict resolution logic
  tailored to specific use cases
- Server-side sharding to support horizontal scaling of large datasets across
  multiple nodes
- Database integrations leveraging GoatDB's version control capabilities to
  efficiently synchronize and maintain consistency with external databases

These areas represent opportunities to enhance the system's capabilities while
maintaining its core design principles.
