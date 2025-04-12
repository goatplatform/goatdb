---
permalink: /api/
layout: default
title: API
nav_order: 4
---

# GoatDB API

The main API entry point is the `GoatDB` class. Here's apractical guide to
using GoatDB in your applications.

## Creating a new DB instance

Create a new database instance by providing configuration options:

```javascript
const db = new GoatDB({
  path: '/data/db', // Where your data will be stored
  orgId: 'my-org', // Used to isolate different organizations' data
  peers: ['http://peer1'], // Other servers to sync with
  trusted: false, // Enable/disable security checks
  debug: false, // Enable/disable debug logging
});
```

## Working with Repositories

Think of repositories as separate databases within your main database. They help
organize your data logically and optimize synchronization.

### When to Use Separate Repositories

- **User Data**: Store user-specific information like settings or preferences
- **Shared Content**: Group chat messages or shared documents
- **Isolated Environments**: Game worlds or separate workspaces

### Basic Repository Operations

```javascript
// Open a repository (required before accessing data)
await db.open('/data/userSettings');

// Get item count
const itemCount = db.count('/data/userSettings');

// Get all item keys
const allKeys = db.keys('/data/userSettings');

// Close when done to free memory
await db.close('/data/userSettings');
```

## Working with Items

Items are the basic data units in GoatDB. Think of them as smart objects that
automatically sync and update.

### Creating and Accessing Items

```javascript
// Create a new item with specific ID
const userProfile = db.create('/data/users/john', userSchema, {
  name: 'John Doe',
  email: 'john@example.com',
});

// Create an item with auto-generated ID
const newPost = db.create('/data/posts', postSchema, {
  title: 'Hello World',
  content: 'My first post',
});

// Access an existing item
const item = db.item('/data/users/john');
```

### Reading and Writing Data

```javascript
// Read data
const userName = item.get('name');

// Write data (automatically syncs)
item.set('name', 'John Smith');

// Listen for changes
item.attach('change', (mutations) => {
  console.log('Item was updated:', mutations);
});
```

## Querying Data

Queries help you find and filter items using plain JavaScript functions:

```javascript
// Find all posts with "hello" in the title
const query = db.query({
  source: '/data/posts',
  schema: postSchema,
  predicate: ({ item }) => {
    return item.get('title').toLowerCase().includes('hello');
  },
  sortBy: ({ left, right }) => {
    // Sort by creation date
    return left.get('createdAt') - right.get('createdAt');
  },
});

// Get results (updates automatically as data changes)
const results = query.results();
```

## User Authentication

Simple authentication using magic links:

```javascript
// Send login link to user's email
await db.loginWithMagicLinkEmail('user@example.com');

// Log out current user
await db.logout();

// Check login status
if (db.loggedIn) {
  console.log('Current user:', db.currentUser);
}
```

## Data Persistence and Sync

GoatDB automatically handles data persistence and synchronization, but you can
manually control it:

```javascript
// Force save changes to disk
await db.flush('/data/posts');

// Save all changes across all repositories
await db.flushAll();

// Wait for database to be ready
await db.readyPromise();
```

Remember: Most operations in GoatDB are automatic - changes are saved and synced
without manual intervention. The manual controls above are mainly for special
cases.
