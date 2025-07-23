---
id: authorization-rules
title: Authorization
sidebar_position: 5
slug: /authorization
---


# Authorization

Authorization rules in GoatDB provide a flexible way to control access to your
data. They work in conjunction with GoatDB's
[session-based authentication system](/sessions) to define who can read and
write to specific [repositories](/repositories) or items within repositories.
For details about how sessions and authentication work, see
[Sessions and Users](/sessions) and [Concepts](/concepts).

<div style={{textAlign: 'center'}}>
  <img src="/img/auth-rules.svg" alt="Auth Rule Diagram" />
</div>

## Overview

Authorization rules are registered with the
[DataRegistry](/concepts#the-data-registry) and are evaluated whenever a
[read or write operation](/read-write-data) is attempted. Each rule consists of:

1. A path pattern (string or RegExp) that matches [repositories](/repositories)
2. A rule function that determines if the operation is allowed

Authorization rules are executed very frequently—on every read and write
operation. However, since GoatDB operates as an
[in-memory cache](/architecture), rules can safely:

- Access the database for session permissions
- Run [queries](/query) to check complex authorization conditions
- Look up related data for access decisions
- Cache results when appropriate

## Granularity

Authorization rules apply at the individual [item](/concepts#item) level and
affect:

- The item's current state
- Its entire [commit history](/commit-graph)
- All related metadata
- Associated change records

This means:

- Access to an item includes access to its full [history](/commit-graph)
- Rules cannot selectively allow access to specific versions
- Historical data inherits the same access controls as current data
- The entire [commit graph](/commit-graph) for an item is subject to the same
  rules

## Basic Concepts

### AuthOp

Operations are classified into two types:

- `read`: [Reading data](/read-write-data#reading-data) from a repository
- `write`: [Writing data](/read-write-data#writing-data) to a repository

### AuthRuleInfo

The rule function receives an `AuthRuleInfo` object containing:

- `db`: The GoatDB instance
- `repoPath`: Path to the [repository](/repositories) being accessed
- `itemKey`: Key of the [item](/concepts#item) being accessed
- `session`: Current [user session](/sessions) (contains public key and owner)
- `op`: Type of operation (`read` or `write`)

## Creating Authorization Rules

Authorization rules are created by registering a path pattern and a rule
function with the [DataRegistry](/concepts#the-data-registry). The rule function
receives an `AuthRuleInfo` object containing the database instance, repository
path, item key, session, and operation type. Here's an example:

```typescript
import { DataRegistry } from '@goatdb/goatdb';

// This rule allows users to access only their own repository at /user/<user-id>
DataRegistry.default.registerAuthRule(
  /^\/user\/\w+$/,
  ({ session, repoPath, op }) => {
    // Extract user ID from the repository path
    // Example: /user/123 -> userId = '123'
    const userId = itemPathGetPart(repoPath, 'repo');
    // Check if the current session owner matches the user ID in the path
    return session.owner === userId;
  },
);
```

For more on defining schemas and the registry, see [Schema](/schema) and
[Concepts](/concepts).

## Built-in Rules

GoatDB includes several built-in rules:

1. System Rules (Enforced):
   - `/sys/sessions`: [Read-only access](/concepts#system-repositories)
   - `/sys/stats`: No access

2. System Rules (Optional):
   - `/sys/*`: Only root session can access
   - `/user/<user-id>`: Private to specific session owner

## Best Practices

1. **Deny-All**
   ```typescript
   // Deny-All rule - a security best practice
   DataRegistry.default.registerAuthRule(
     /.*/,
     () => false,
   );
   ```

2. **Use Specific Paths**
   ```typescript
   // Specific path protection example
   // This rule protects a specific private API endpoint
   DataRegistry.default.registerAuthRule(
     '/api/private',
     () => false,
   );
   ```

3. **Combine Multiple Rules**
   ```typescript
   // Public read access with write restrictions
   DataRegistry.default.registerAuthRule(
     '/public/*',
     ({ op }) => op === 'read',
   );
   ```

4. **Look Up User Information**
   ```typescript
   // Admin-only access rule
   // Note: Sessions only contain the user ID, so we need to look up the user's roles
   DataRegistry.default.registerAuthRule(
     '/admin/*',
     ({ db, session }) => {
       // Deny anonymous access
       if (!session.owner) {
         return false;
       }
       const userItem = db.item('/sys/users', session.owner);
       return userItem.get('roles').includes('admin');
     },
   );
   ```

For more on role-based access and user management, see
[Sessions and Users](/sessions) and [Querying Data](/query).

## Common Use Cases

### 1. Public Read, Private Write

```typescript
// Public read, private write pattern
// This is a common pattern for public content that only authenticated sessions can modify
DataRegistry.default.registerAuthRule(
  '/public/*',
  ({ session, op }) => {
    // Allow anyone to read
    if (op === 'read') {
      return true;
    }
    // Only authenticated sessions can write
    return session.owner !== undefined;
  },
);
```

This pattern is often used for collaborative apps—see the [Tutorial](/tutorial)
and [React Hooks](/react) for real-world examples.

### 2. Role-Based Access

```typescript
// Role-based access control
// This pattern restricts write access to sessions with specific roles
DataRegistry.default.registerAuthRule(
  '/editor/*',
  ({ db, session, op }) => {
    // Allow anyone to read
    if (op === 'read') {
      return true;
    }
    // Deny anonymous writes
    if (!session.owner) {
      return false;
    }
    // Only editor sessions can write
    const userItem = db.item('/sys/users', session.owner);
    return userItem.get('roles').includes('editor');
  },
);
```

For more on roles and user profiles, see [Sessions and Users](/sessions) and
[Schema](/schema).

### 3. Owner-Only Access

```typescript
// Owner-only access pattern
// This ensures sessions can only access their own data
DataRegistry.default.registerAuthRule(
  '/user/*',
  ({ session, repoPath }) => {
    // Only the session owner can access
    const repoId = itemPathGetPart(repoPath, 'repo');
    return session.owner === repoId;
  },
);
```

For more on repository structure and item ownership, see
[Repositories](/repositories) and [Concepts](/concepts).

## Trusted Mode and Authorization Rules

While authorization rules provide fine-grained control over data access, there
are scenarios where bypassing these rules is necessary for performance or
architectural reasons. GoatDB's [trusted mode](/sessions#trusted-mode) allows
you to disable authorization rule evaluation entirely. For performance
implications, see [Benchmarks](/benchmarks#trusted-mode).

:::note

Trusted mode is particularly useful when:

- Building high-performance microservices that handle their own access control
- Running in a controlled environment where network-level security is
  sufficient
- Using GoatDB as a caching layer with separate authorization mechanisms

:::

To enable trusted mode, set the `trusted` flag to `true` when creating a DB
instance:

```typescript
const db = new GoatDB({
  path: '/path/to/db',
  trusted: true,
});
```

When trusted mode is enabled:

- All registered authorization rules are ignored
- System repositories (`/sys/*`) become accessible without restrictions
- User-specific repositories (`/user/*`) can be accessed by any session
- Role-based access control is effectively disabled

:::warning

Important considerations when using trusted mode:

- Authorization rules provide critical security boundaries—disabling them
  removes these protections
- All sessions gain full access to all repositories and items
- The security model shifts from GoatDB's authorization system to your
  application's security layer
- This mode should only be used when you have equivalent or better security
  controls at a different layer

Use trusted mode with extreme caution and only in environments where you can
guarantee security through other means.

:::

For more on security, durability, and distributed design, see
[Architecture](/architecture), [FAQ](/faq), and
[Conflict Resolution](/conflict-resolution).
