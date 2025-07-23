---
id: concepts
title: Concepts
sidebar_position: 1
slug: /concepts
---


# Concepts

[GoatDB](/) is an embedded, [distributed](/architecture),
[schema-based](/schema) database designed for collaborative applications that
work consistently both online and offline. This document outlines the core
concepts of [GoatDB](/).

## The Data Registry

The `DataRegistry` provides a shared definition of data between all peers in the
network (clients and servers). This shared understanding ensures that every
participant in the distributed system interprets and validates data in the same
way, which is essential for maintaining consistency.

The registry manages [schemas](/schema), schema versioning, and
[access control](/authorization). It maintains a catalog of all available
[schemas](/schema) and their versions, handles schema upgrades, and enforces
[authorization](/authorization) rules across [repositories](/repositories).
Applications typically use the default global registry (`DataRegistry.default`)
which is initialized when the database starts. The registry ensures data
integrity and security throughout the system.

## Data Model

### Item

The atomic unit of data in [GoatDB](/). Each item follows a [schema](/schema)
and maintains its own [distributed commit graph](/commit-graph), guaranteeing
[causal consistency](https://en.wikipedia.org/wiki/Causal_consistency). Items
track their own [version history](/commit-graph), enabling concurrent
modifications across devices.

### ManagedItem

A `ManagedItem` provides a high-level interface for [reading](/read-write-data),
[writing](/read-write-data), and [synchronizing](/sync) a single
[item](/concepts#item) in [GoatDB](/). It manages the item's state,
[schema](/schema) validation, and [version history](/commit-graph), ensuring
changes are tracked and merged across devices.

### Schema

Defines the structure of an [item](#item), including field types, validation
rules, and [conflict resolution](/conflict-resolution) strategies.
[Schemas](/schema) are versioned, allowing gradual [schema](/schema) migrations.
A schema includes:

- Field types (string, number, boolean, date, set, map, richtext)
- Validation rules
- Default values
- Required fields
- Upgrade functions for migrating data between schema versions (v1→v2→v3),
  allowing backward compatibility as schemas evolve

### Repository

A collection of [items](#item) that are logically related within your
application's domain. [Repositories](/repositories) are [synchronized](/sync)
independently, enabling application-level sharding. Each
[repository](/repositories) maintains [commit histories](/commit-graph) for its
[items](#item) and handles [merging](/conflict-resolution) of concurrent
changes. Examples of repositories include:

- A user's private notes collection
- A shared document workspace between team members
- A group chat with its messages and metadata
- A project kanban board with its cards, columns, and settings
- A calendar with events and attendees

### Path

[Items](#item) are uniquely identified by [paths](#path) following this
structure:

```
/type/repo/item
```

## Repositories

[Repositories](/repositories) are collections of [items](#item) that share a
common purpose or access pattern. Each [repository](/repositories) is
[synchronized](/sync) independently, enabling efficient data distribution and
[access control](/authorization).

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

Stores the public keys of all [sessions](/sessions) in the system. This enables
each peer to independently verify the authenticity of commits in the
[distributed commit graph](/commit-graph) and enforce
[permissions](/authorization), without requiring a central authority. Sessions
can be anonymous or linked to specific users.
[Read-only access](/authorization#built-in-rules) for all users.

#### /sys/users

A recommended convention for storing user profiles and metadata. While
[GoatDB](https://goatdb.dev/) provides default
[authorization rules](/authorization) for this [repository](/repositories)
(users can manage their own profiles, read-only access to others), it's up to
the application to decide whether and how to use it. Applications may implement
their own user management system differently if needed.

#### /sys/stats

System telemetry and monitoring data. Accessible only with root access.
