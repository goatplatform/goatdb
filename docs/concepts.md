---
permalink: /concepts/
layout: home
title: Concepts
nav_order: 1
---

# Concepts

GoatDB is a distributed, schema-based database designed for collaborative
applications that work consistently both online and offline. This document
outlines the core concepts of GoatDB.

## Table of Contents

1. [The Data Registry](#the-data-registry)
2. [Data Model](#data-model)
   - [Item](#item)
   - [Schema](#schema)
   - [Repository](#repository)
   - [Path](#path)
3. [Repositories](#repositories)
   - [Repository Types](#repository-types)
   - [System Repositories](#system-repositories)

## The Data Registry

The `DataRegistry` provides a shared definition of data between all nodes in the
network (clients and servers). This shared understanding ensures that every
participant in the distributed system interprets and validates data in the same
way, which is essential for maintaining consistency.

The registry manages schemas, schema versioning, and access control. It
maintains a catalog of all available schemas and their versions, handles schema
upgrades, and enforces authorization rules across repositories. Applications
typically use the default global registry (`DataRegistry.default`) which is
initialized when the database starts. The registry ensures data integrity and
security throughout the system.

## Data Model

### Item

The atomic unit of data in GoatDB. Each item follows a schema and maintains its
own distributed commit graph, guaranteeing causal consistency. Items track their
own version history, enabling concurrent modifications across devices.

### Schema

Defines the structure of an item, including field types, validation rules, and
conflict resolution strategies. Schemas are versioned, allowing gradual schema
migrations. A schema includes:

- Field types (string, number, boolean, date, set, map, richtext)
- Validation rules
- Default values
- Required fields
- Upgrade functions for migrating data between schema versions (v1→v2→v3),
  allowing backward compatibility as schemas evolve

### Repository

A collection of items that are logically related within your application's
domain. Repositories are synchronized independently, enabling application-level
sharding. Each repository maintains commit histories for its items and handles
merging of concurrent changes. Examples of repositories include:

- A user's private notes collection
- A shared document workspace between team members
- A group chat with its messages and metadata
- A project kanban board with its cards, columns, and settings
- A calendar with events and attendees

### Path

Items are uniquely identified by paths following this structure:

```
/type/repo/item
```

## Repositories

Repositories are collections of items that share a common purpose or access
pattern. Each repository is synchronized independently, enabling efficient data
distribution and access control.

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

GoatDB includes several built-in repositories under `/sys/` that handle core
functionality:

#### /sys/sessions

Stores the public keys of all sessions in the system. This enables each node to
independently verify the authenticity of commits in the distributed commit graph
and enforce permissions, without requiring a central authority. Sessions can be
anonymous or linked to specific users. Read-only access for all users.

#### /sys/users

A recommended convention for storing user profiles and metadata. While GoatDB
provides default authorization rules for this repository (users can manage their
own profiles, read-only access to others), it's up to the application to decide
whether and how to use it. Applications may implement their own user management
system differently if needed.

#### /sys/stats

System telemetry and monitoring data. Accessible only with root access.
