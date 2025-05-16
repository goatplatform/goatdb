---
permalink: /repositories/
layout: default
title: Repositories
nav_order: 7
---

# Repositories in GoatDB

{: .highlight }

Repositories in GoatDB are the fundamental unit of data organization, similar to
tables in SQL databases or document collections in NoSQL databases. Each
repository manages a collection of related data items and provides synchronized,
durable storage with efficient read and write operations.

## Core Concepts

### Storage Architecture

![Repository Structure](/assets/repository-structure.svg)

Each repository is backed by a single `.jsonl` file that stores a log of
commits. This design takes advantage of modern SSD characteristics:

- **Sequential I/O**: Optimized for SSD performance with sequential writes,
  enabling efficient batching of operations
- **Hardware Parallelization**: Leverages SSD internal parallelization through
  large sequential I/O operations, enabling multiple NAND chips and controllers
  to work in parallel
- **Write Amplification**: Minimized through append-only design

The [JSON Lines](https://jsonlines.org/) format provides several benefits:

- **Human Readable**: Commits are stored in readable JSON format
- **Append-Only**: New commits are always appended to the end
- **Atomic Writes**: Each line is written atomically for consistency

### Commit Graphs

![Distinct Commit Graphs](/assets/commit-graphs.svg)

Repositories are collections of distinct commit graphs - one per item. Each item
(identified by its key) has its own independent commit history, allowing for
parallel evolution of different items without interference. This design enables
efficient concurrent operations and makes it possible to track the complete
history of each item separately.

### Commit Structure

Each commit in the repository log contains:

- **ID**: Unique identifier for the commit
- **Key**: The item key being modified
- **Data**: The actual data being written
- **Parents**: References to parent commits (for version history)
- **Timestamp**: When the commit was created
- **Metadata**: Additional information like organization ID and build version
- **Session**: The ID of the session that created the commit
- **Signature**: Cryptographic signature of the commit, generated using the
  session's private key

The signature is particularly important as it provides cryptographic proof that:

1. The commit was created by an authorized session
2. The commit data hasn't been tampered with
3. The commit is part of a verifiable chain of changes

This security model ensures that all operations in GoatDB are cryptographically
signed, creating a tamper-proof commit graph where each change can be traced
back to its authorized source.

{: .note }

> For performance-critical applications or trusted environments (like backend
> services), GoatDB offers a trusted mode that bypasses cryptographic
> verification. This mode can significantly [improve performance](/benchmarks)
> by skipping commit signing and verification. However, it should only be used
> in controlled, trusted environments where [security](/sessions) is handled at
> a different layer.

## Basic Operations

### Reading Data

{: .highlight }

For more details on reading and writing data, see
[Reading and Writing Data](/read-write-data).

GoatDB provides several ways to read data from repositories:

```typescript
// Get a specific item by its full path
// Returns the current value of the item or undefined if it doesn't exist
const user = db.item('/users/john/foo');

// Query items using a schema filter
// This example gets all notes in john's repository that match the note schema
const allNotes = db.query({
  source: '/users/john', // Repository path to search in
  schema: kSchemaNote, // Schema to filter by
});

// Get all keys in a repository
// This is useful for listing all items or checking what exists
const allKeys = db.keys('/users/john');
```

### Opening a Repository

In most cases, repositories are opened automatically when you access an item or
perform an operation that requires the repository. However, you can also
explicitly open a repository using the `db.open()` method. This is useful if you
want to preload a repository or perform operations that require direct access to
the repository instance.

```typescript
// Explicitly open a repository (returns a Promise that resolves to the Repository instance)
const repo = await db.open('/users/john');
```

While GoatDB will open repositories on demand, this can introduce a
[performance penalty](/benchmarks) the first time you access data in a
repository, especially in interactive applications. If you know your application
will need a repository (for example, when loading a user profile or switching
workspaces), it is recommended to manually open (preload) the repository in
advance using `db.open()`. This ensures the repository is ready for immediate
use and avoids delays during user interactions.

{: .note }

> When preloading a repository, you usually don't need to `await` the
> result—just call `db.open()` and continue. It's safe to call `open()` multiple
> times for the same repository; only the first call will actually start
> loading. If the repository isn't fully loaded by the time you access its data,
> GoatDB will automatically wait for loading to finish. This approach ensures
> your application remains responsive and avoids unnecessary delays for users.

### Closing a Repository

Repositories remain open in memory for the duration of your application's
session unless you explicitly close them. To manually close a repository and
release its resources, use the `db.close()` method:

```typescript
// Close a repository and flush any pending writes to disk
await db.close('/chats/chatId');
```

When you close a repository, GoatDB will first commit any in-memory changes for
items in that repository, then flush all pending writes to disk. This ensures
that all local edits are saved and durable before the repository is fully
released from memory. This is currently a manual operation. In future versions
of GoatDB, there will be an option to automatically close repositories when they
are no longer in use.

{: .note }

> In most cases, you don't need to `await` the result of `db.close()`. It's
> common to simply call `db.close()` and let GoatDB handle the process in the
> background. The system will ensure all changes are safely written to disk, so
> you can keep your application responsive without waiting for the close
> operation to finish.

## Durability

GoatDB provides strong durability through:

1. **Atomic Commits**: Each commit is written atomically - if a crash occurs
   mid-write, the half-written commit is simply trimmed from the log
2. **Parallel Writes**: Changes are written simultaneously to both local storage
   and replicated to other peers
3. **Automatic Recovery**: After a crash, the system automatically recovers
   missing commits through the [synchronization protocol](/sync), ensuring all
   peers converge to the same state. The P2P design enables both clients and
   servers to act as active replicas, providing redundancy and resilience

{: .note }

> Traditional database durability often focuses on server-side guarantees -
> ensuring data survives server crashes. But in GoatDB, we recognize that client
> durability is fundamentally different. Modern SSDs in laptops and phones
> rarely fail, and when they do, it's typically due to physical damage rather
> than data corruption. More importantly, user expectations differ between
> client and server operations - if your phone dies mid-click, you wouldn't
> expect that click's effect to be saved, but when a server acknowledges an API
> call, you rightfully expect that operation to be durable.

## Advanced Usage

The following methods are low-level APIs typically used for advanced scenarios
or debugging:

```typescript
// Get a repository instance directly
const repo = db.repository('/users/john');

// Low-level repository methods
// Get the current value and commit for a specific key
// Returns [value, commit] tuple or undefined if key doesn't exist
const [value, commit] = repo.valueForKey('/users/john');

// Set a new value for a key with an optional parent commit
// Returns a Promise that resolves to the new commit or undefined if no change
await repo.setValueForKey('/users/john', newItem, parentCommit);

// Get all keys in the repository
// Returns an iterable of all keys
const keys = repo.keys();

// Get all full paths in the repository
// Returns an iterable of paths (repository path + key)
const paths = repo.paths();

// Get the commit graph for a specific key
// Returns an array of CommitGraph objects showing the commit history
const graph = repo.graphForKey('/users/john/foo');

// Get a Cytoscape-compatible JSON representation of the commit network for a key
// This can be used to visualize the commit history in Cytoscape (https://cytoscape.org/)
const network = repo.debugNetworkForKey('/users/john/foo');
```

These low-level APIs are primarily useful for:

1. Debugging and troubleshooting
2. Building specialized tools that need direct access to the commit graph
3. Contributing to GoatDB's core functionality

For normal application development, the higher-level APIs (`db.item()` and
`db.create()`) provide a safer and more convenient interface. However, if you're
interested in contributing to GoatDB's development, these low-level APIs give
you direct access to the core functionality.
