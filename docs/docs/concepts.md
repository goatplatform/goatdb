---
id: concepts
title: Concepts
sidebar_position: 1
slug: /concepts
---

# Concepts

[GoatDB](/) is the realtime state layer for human-agent collaboration: an
embedded, [distributed](/docs/architecture), [schema-based](/docs/schema)
database where humans, AI agents, and tools work on the same live state. Every
participant holds a local replica of each repository it has opened or been authorized to sync, works offline, and merges concurrent edits
from other actors automatically. This document outlines the core concepts of
[GoatDB](/).

## Key Terminology

GoatDB uses a precise vocabulary to describe its distributed state model:

| Term                 | Definition                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**            | A conceptual participant — human, agent, tool, or service. Actors are not an API identity in GoatDB; the application owns the mapping from sessions to actors.                                 |
| **Peer**             | A running GoatDB instance with its local replica of one or more repositories. A peer may back a human's UI or an agent's process; every peer is symmetric in the protocol.                     |
| **Session**          | An Ed25519 signing and authorization unit. Signatures prove the session key; the application determines which actor (if any) owns the session.                                                 |
| **Repository**       | The unit of loading, sync, authorization, and continuity — a collection of items that share an access domain.                                                                                  |
| **State continuity** | Durable, resumable state that survives restarts, offline gaps, and handoffs between actors.                                                                                                    |
| **Reactive / live**  | Immediate local subscriptions that recompute when data changes. Remote changes trigger the same reactions after sync delivers them.                                                            |
| **Sync protocol**    | The transport-independent durable reconciliation and convergence mechanism. Not tied to any particular carrier or trigger.                                                                     |
| **Carrier**          | The transport layer peers use to exchange sync messages. **HTTP** is current; WebSocket and WebRTC are planned.                                                                                |
| **Shoulder tap**     | An active ephemeral trigger that tells a peer to begin durable sync. Does not replace commit-graph reconciliation as the source of truth. **Polling** is current; shoulder tap is in progress. |
| **Convergence**      | Causal eventual consistency combined with deterministic structural merge. Not semantic or business conflict resolution.                                                                        |
| **Topology**         | How peers are connected. Currently **server-coordinated**; true direct P2P requires the planned WebRTC carrier.                                                                                |

## The Data Registry

The `DataRegistry` provides a shared definition of data between all peers in the
network (clients, servers, and agent processes). This shared understanding
ensures that every participant in the distributed system interprets and
validates data in the same way, which is essential for maintaining consistency.

The registry manages [schemas](/docs/schema), schema versioning, and
[access control](/docs/authorization). It maintains a catalog of all available
[schemas](/docs/schema) and their versions, handles schema upgrades, and
coordinates [authorization](/docs/authorization) rule evaluation across
[repositories](/docs/repositories). Applications typically use the default
global registry (`DataRegistry.default`) which is initialized when the database
starts. The registry ensures data integrity and security throughout the system.

## Data Model

### Item

The atomic unit of data in [GoatDB](/). Each item follows a
[schema](/docs/schema) and maintains its own
[distributed commit graph](/docs/commit-graph), guaranteeing
[causal consistency](https://en.wikipedia.org/wiki/Causal_consistency). Items
track their own [version history](/docs/commit-graph), enabling concurrent
modifications across devices.

### ManagedItem

A `ManagedItem` provides a high-level interface for
[reading](/docs/read-write-data), [writing](/docs/read-write-data), and
[synchronizing](/docs/sync) a single [item](/docs/concepts#item) in [GoatDB](/).
It manages the item's state, [schema](/docs/schema) validation, and
[version history](/docs/commit-graph), ensuring changes are tracked and merged
across devices.

### Schema

Defines the structure of an [item](#item), including field types, validation
rules, and [conflict resolution](/docs/conflict-resolution) strategies.
[Schemas](/docs/schema) are versioned, allowing gradual [schema](/docs/schema)
migrations. A schema includes:

- Field types (string, number, boolean, date, set, map, richtext)
- Validation rules
- Default values
- Required fields
- Upgrade functions for migrating data between schema versions (v1→v2→v3),
  allowing backward compatibility as schemas evolve

### Repository

A collection of [items](#item) that are logically related within your
application's domain. [Repositories](/docs/repositories) are
[synchronized](/docs/sync) independently, enabling application-level sharding.
Each [repository](/docs/repositories) maintains
[commit histories](/docs/commit-graph) for its [items](#item) and handles
[merging](/docs/conflict-resolution) of concurrent changes. Examples of
repositories include:

- A user's private notes collection
- A shared document workspace between team members
- A group chat with its messages and metadata
- A project kanban board with its cards, columns, and settings
- A task queue shared between a human supervisor and the agents executing its
  tasks
- A calendar with events and attendees

### Path

[Items](#item) are uniquely identified by [paths](#path) following this
structure:

```
/type/repo/item
```

## Repositories

[Repositories](/docs/repositories) are collections of [items](#item) that share
a common purpose or access pattern. Each [repository](/docs/repositories) is
[synchronized](/docs/sync) independently, enabling efficient data distribution
and [access control](/docs/authorization).

### Repository Types

Repository types appear as the first segment in a path (`/type/repo/item`):

**sys**: Reserved for system repositories. While applications shouldn't create
new repositories under this type, they interact with existing system
repositories through proper APIs.

**Common Application Types**:

- **data**: For general application data (e.g., `/data/tasks/task-123`)
- **user**: For user-specific data (e.g., `/user/alice/preferences`)

Applications can create additional types as needed to organize their data (e.g.,
`/team/engineering/roadmap`, `/org/acme/policy`).

### System Repositories

[GoatDB](https://goatdb.dev/) includes several built-in repositories under
`/sys/` that handle core functionality:

#### /sys/sessions

Stores the public keys of all [sessions](/docs/sessions) in the system. This
enables each peer to independently verify the authenticity of commits in the
[distributed commit graph](/docs/commit-graph) and enforce
[permissions](/docs/authorization), without requiring a central authority.
Sessions can be anonymous or linked to specific users.
[Read-only access](/docs/authorization#built-in-rules) for all users.

#### /sys/users

A recommended convention for storing user profiles and metadata. GoatDB registers optional [authorization rules](/docs/authorization) for this [repository](/docs/repositories) (users can manage their own profiles, read-only access to others). Applications may implement their own user management system differently if needed.

#### /sys/stats

System telemetry and monitoring data. Accessible only with root access.
