---
id: faq
title: FAQ
sidebar_position: 12
slug: /faq
---


# GoatDB FAQ

## What is GoatDB?

GoatDB is a distributed database designed for edge-native applications. Inspired
by distributed version control systems, GoatDB focuses on maximizing client-side
processing, reducing server dependency, and supporting real-time synchronization
across peers.

## Won't This Architecture Overload the Client?

No. Modern cloud-first applications already perform similar operations under the
guise of temporary caching. Any data rendered on the client's screen has already
been downloaded to the client, aligning with GoatDB's approach. Modern client
devices are significantly more powerful than the fraction of a server's
resources allocated to serve them, enabling them to handle such workloads
efficiently.

## Won't it expose sensitive data to clients?

No. GoatDB establishes a private network, unlike public approaches such as
Bitcoin or IPFS. Clients only access data explicitly granted by developers,
adhering to the same principles as cloud-first applications.

## What workload is GoatDB optimized for?

GoatDB is optimized for read-heavy workloads, where reads significantly
outnumber writes. For the occasional writes, GoatDB supports concurrent
operations with distributed, lockless [concurrency control](/docs/architecture). It
is ideal for use cases that naturally segment into logical data repositories.

## Can you delete data from GoatDB?

Yes. Although the underlying structure is an
[append-only commit graph](/docs/commit-graph), GoatDB employs garbage collection.
Data deletion involves marking items as deleted, with garbage collection
handling eventual removal. Note that the garbage collection feature is still a
work in progress and will be fully implemented in upcoming releases.

## How does synchronization work in GoatDB?

GoatDB employs a soft [real-time synchronization](/docs/sync) mechanism that captures
in-memory states of peers up to three times per second. These states are
packaged into signed commits and appended to an append-only commit graph.
Synchronization uses a probabilistic protocol with Bloom Filters to minimize
data comparison overhead, ensuring efficient and consistent propagation of
updates across peers.

## What sync latency should I expect?

Typical synchronization latency is **700-1000ms** between peers in real-world deployments. This represents application-perceived latency (when data becomes available via API) rather than pure network transmission time.

GoatDB prioritizes data consistency and offline-first capabilities over minimal latency. The architecture uses polling-based synchronization with adaptive timing that balances performance with reliability. For applications requiring sub-100ms sync times, evaluate whether GoatDB's consistency guarantees align with your performance requirements.

## Can GoatDB operate offline?

Yes. GoatDB supports offline mode by design. When the server is unavailable,
peers continue functioning autonomously. Updates made offline are synchronized
with the server once connectivity is restored. Future updates will also
introduce WebRTC-based peer-to-peer synchronization for added resilience.

## How does GoatDB handle data conflicts?

Conflict resolution is automated and optimized for real-time operations.
Detailed strategies for resolving conflicts are outlined in the
[Conflict Resolution documentation](/docs/conflict-resolution). By leveraging
distributed version control principles, GoatDB ensures that conflicts are
resolved efficiently and transparently.

## How does GoatDB simplify development?

GoatDB abstracts network and synchronization complexities, providing developers
with a synchronous, in-memory data representation. This design reduces the need
for traditional REST APIs and streamlines application development. Debugging and
deploying GoatDB as a single executable is simpler compared to managing multiple
microservices. A single executable consolidates the application stack, reducing
inter-service communication issues and deployment overhead. For React
applications, GoatDB offers a state management package that integrates with
React hooks, supporting real-time updates and efficient UI state handling.

## What is the deployment process for GoatDB?

Deployment is simplified through a unified artifact that combines the database,
application code, and static assets into a single executable. This approach
ensures compatibility with standard servers and on-premises environments while
reducing operational complexity. Additionally, an upcoming managed service will
make deployment and rolling updates a one-click process, further streamlining
operations for developers and reducing the need for manual interventions.

## How does GoatDB ensure data reliability?

- **Active Replication:** Each client peer maintains a local copy of the data,
  serving as an active replica. In case of server data loss, these replicas can
  restore the server state.
- **Backup and Restore:** The distributed design inherently supports backup and
  redundancy. Peers store partial replicas, facilitating recovery. Backing up
  the data is as simple as zipping the live directory of data, making it
  straightforward to preserve and restore states.

## Does GoatDB support schema migrations?

Yes. GoatDB employs version control principles for schema management. Changes
are applied to a separate branch, ensuring backward compatibility. Rolling
updates are supported without disrupting workflows, and problematic changes can
be reverted seamlessly.

## Can GoatDB integrate with data warehouses?

Yes. GoatDB's schema-based data organization supports straightforward
integration with data warehouses. Its structured approach aligns well with
analytical workflows.

## What debugging tools does GoatDB provide?

GoatDB includes a "History Playback" feature that allows developers to replay
specific commit sequences. This functionality simplifies debugging by enabling
precise analysis of data changes over time.

## How does GoatDB ensure compliance and auditability?

The append-only signed [commit graph](/docs/commit-graph) acts as a built-in audit
log. This log provides full traceability for data modifications, ensuring
transparency and compliance with regulatory requirements. Additionally, it
allows reversion to the last valid state if needed.

## What is the performance impact of GoatDB on client devices?

GoatDB is optimized for lightweight operations on client devices. The
append-only storage model and delta-compressed synchronization reduce
computational overhead while maintaining real-time responsiveness. For detailed
performance metrics and benchmarks, see our [benchmarks page](/docs/benchmarks).

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

## What licensing options does GoatDB offer?

GoatDB is released under the Apache License 2.0, a permissive open-source
license that provides:

- Freedom to use the software for any purpose
- Freedom to modify and distribute the software
- Patent rights from contributors to users
- No requirement to release your source code when making changes

The Apache 2.0 license is business-friendly while still maintaining open-source
principles, making GoatDB suitable for both commercial and open-source projects
without imposing restrictive conditions on users.
