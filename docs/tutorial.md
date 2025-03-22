---
permalink: /tutorial/
layout: default
title: Tutorial
nav_order: 1
---

- [Building a Todo List App with GoatDB](#building-a-todo-list-app-with-goatdb)
  - [Define the Task Schema and Authorization Rules](#define-the-task-schema-and-authorization-rules)
    - [Understanding Repositories \& Sharding](#understanding-repositories--sharding)
  - [Create the React Components](#create-the-react-components)
    - [Header Component](#header-component)
    - [TaskItem Component](#taskitem-component)
    - [Contents Component](#contents-component)
    - [Login Component with Custom Email](#login-component-with-custom-email)
    - [App Component](#app-component)
    - [Opening Public User Registration](#opening-public-user-registration)
  - [Running the Application](#running-the-application)
  - [Testing Real-Time Sync & Conflict Resolution](#testing-real-time-sync--conflict-resolution)
  - [Building the Server](#building-the-server)
  - [Conclusion](#conclusion)

# Building a Todo List App with GoatDB

This tutorial walks you through building a full-featured Todo List app with
GoatDB using React. It demonstrates how to leverage GoatDB's distributed,
edge-native architecture and real-time synchronization features.

GoatDB is an embedded, distributed, document database that prioritizes speed and
developer experience. It excels at real-time collaboration and embedded caching
applications.

Instead of following traditional database design patterns, GoatDB leverages
concepts refined over decades by distributed version control systems, enhanced
with novel algorithms ([bloom filter-based synchronization](/sync) and
[ephemeral CRDTs](/conflict-resolution)) for efficient synchronization and
automatic real-time conflict resolution.

In GoatDB, items are the basic data units (like rows or documents) defined by
versioned schemas and organized within repositories. Each item is uniquely
identified by a path (following the format `/type/repo/item`), which
distinguishes system, application, and user data, enabling efficient
synchronization and conflict resolution.

GoatDB employs a memory-first design with application-level sharding. Rather
than growing a single large database, it uses multiple medium-sized repositories
that sync independently. Each user or data group has its own repository,
enabling horizontal scaling and efficient client-server synchronization - a
natural architecture for multi-user applications.

## Define the Task Schema and Authorization Rules

Before we dive into the code, let's understand how GoatDB organizes data:

### Understanding Repositories & Sharding

GoatDB uses repositories to organize and shard data. A repository is a
collection of items that:

- Syncs independently from other repositories
- Can contain items with different schemas
- Has a path format of `/type/repo/item`

Best practice is to shard by user ID or domain-specific identifiers. Here are
two common examples:

1. **User-specific data** (like in our todo app):

```typescript
// ✅ Good: Each user has their own repository
/data/${userId}/task123

// ❌ Bad: All users share one repository
/data/tasks/task123
```

2. **Chat application** (like Slack):

```typescript
// ✅ Good: Each channel has its own repository
/data/${channelId}/message123

// ✅ Good: Each DM conversation has its own repository
/data/dm_${user1Id}_${user2Id}/message456

// ❌ Bad: All messages in one repository
/data/messages/message789
```

These patterns:

- Enable independent syncing of each repository's data
- Create natural access control boundaries
- Improve scalability as your application grows
- Make it easier to manage data lifecycles

Now, let's implement this pattern in our todo app:

```typescript
// schema.ts
import { itemPathGetPart, SchemaManager } from '@goatdb/goatdb';

export const kSchemaTask = {
  ns: 'task',
  version: 1,
  fields: {
    text: {
      type: 'string',
      required: true,
    },
    done: {
      type: 'boolean',
      default: () => false,
    },
  },
} as const;
export type SchemaTypeTask = typeof kSchemaTask;

// Register both the schema and authorization rules
export function registerSchemas(
  manager: SchemaManager = SchemaManager.default,
): void {
  // Register the task schema
  manager.registerSchema(kSchemaTask);

  // Register an authorization rule that only allows users to access their own repositories
  manager.registerAuthRule(
    /\/data\/\w+/, // Matches all repositories under /data/<user-id>
    (_db, repoPath, _itemKey, session, _op) =>
      // Only allow access if the repository matches the user's ID
      itemPathGetPart(repoPath, 'repo') === session.owner,
  );
}
```

This authorization rule ensures that:

- Each user can only read and write to their own repository
- Users cannot access other users' tasks
- The rule applies to all operations (create, read, update, delete)

## Create the React Components

GoatDB provides a set of [React hooks](/react)—`useDB()`, `useDBReady()`,
`useQuery()`, and `useItem()`—that simplify state management and data
synchronization. Your app will consist of several React components. Each
component uses GoatDB React hooks to interact with the database.

### Header Component

The `Header` component renders an input field and a button for adding new tasks.
It uses the `useDB` hook to access the database and create new task items.

When a new task is created, it is stored under a repository associated with the
current user, which triggers real‑time updates elsewhere in the app.

```tsx
// src/Header.tsx
// @deno-types="@types/react"
import React, { useRef } from 'react';
import { useDB } from '@goatdb/goatdb/react';
import { kSchemaTask } from '../schema.ts';

export function Header() {
  const db = useDB();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input type='text' ref={ref}></input>
      <button
        onClick={() => {
          // Create a new task at the user's personal repository.
          // This automatically triggers updates in the task list.
          db.create(`/data/${db.currentUser!.key}`, kSchemaTask, {
            text: ref.current!.value,
          });
        }}
      >
        Add
      </button>
    </div>
  );
}
```

### TaskItem Component

The `TaskItem` component displays an individual task. By using the `useItem()`
hook, it subscribes to changes on a specific task so that any modification
triggers a re-render.

```tsx
// src/TaskItem.tsx
// @deno-types="@types/react"
import React from 'react';
import { useItem } from '@goatdb/goatdb/react';
import { SchemaTypeTask } from '../schema.ts';

export type TaskItemProps = {
  path: string;
};

export function TaskItem({ path }: TaskItemProps) {
  // Subscribe to updates for the specific task.
  const task = useItem<SchemaTypeTask>(path);
  return (
    <div>
      <input
        type='checkbox'
        checked={task.get('done')}
        onChange={(event) => task.set('done', event.target.checked)}
      />
      <input
        type='text'
        value={task.get('text')}
        onChange={(event) => task.set('text', event.target.value)}
      />
      <button
        onClick={() => {
          // Mark the task for deletion.
          task.isDeleted = true;
        }}
      >
        Delete
      </button>
      <button onClick={() => task.downloadDebugGraph()}>
        Download Commit Graph
      </button>
      {
        /* The above button downloads a JSON file representing the commit graph.
          This file is formatted for inspection with Cytoscape
          (https://cytoscape.org/) for visualization and debugging purposes. */
      }
    </div>
  );
}
```

### Contents Component

The `Contents` component ties everything together by querying and displaying the
list of tasks. It uses the `useQuery()` hook to fetch tasks from the user's
repository, sorting and filtering them as needed. A local state variable is used
to control whether completed tasks should be shown.

```tsx
// src/Contents.tsx
// @deno-types="@types/react"
import React, { useState } from 'react';
import { useDB, useQuery } from '@goatdb/goatdb/react';
import { kSchemaTask } from '../schema.ts';
import { Header } from './Header.tsx';
import { TaskItem } from './TaskItem.tsx';

export function Contents() {
  const db = useDB();
  const [showChecked, setShowChecked] = useState(true);
  // Open a query to fetch all tasks sorted by their text.
  const query = useQuery({
    schema: kSchemaTask,
    source: `/data/${db.currentUser!.key}`,
    sortDescriptor: ({ left, right }) =>
      left.get('text').localeCompare(right.get('text')),
    predicate: ({ item, ctx }) => !item.get('done') || ctx.showChecked,
    showIntermittentResults: true,
    ctx: {
      showChecked,
    },
  });
  return (
    <div>
      <Header />
      <div>
        <span>Show Checked</span>
        <input
          type='checkbox'
          checked={showChecked}
          onChange={(event) => setShowChecked(event.target.checked)}
        />
      </div>
      {query.results().map(({ path }) => (
        <div key={path}>
          <TaskItem path={path} />
        </div>
      ))}
    </div>
  );
}
```

### Login Component with Custom Email

The `Login` component provides email-based authentication using magic links. You
can customize the appearance of these emails by configuring the email builder on
your server.

```tsx
// src/Login.tsx
// @deno-types="@types/react"
import React, { useRef, useState } from 'react';
import { useDB } from '@goatdb/goatdb/react';

export function Login() {
  const db = useDB();
  const ref = useRef<HTMLInputElement>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [sendError, setSendError] = useState(false);
  return (
    <div>
      <label htmlFor='LoginEmail'>Email:</label>
      <input type='text' ref={ref} id='LoginEmail'></input>
      <button
        onClick={async () => {
          if (await db.loginWithMagicLinkEmail(ref.current!.value)) {
            setEmailSent(true);
            setSendError(false);
          } else {
            setEmailSent(false);
            setSendError(true);
          }
        }}
      >
        Login
      </button>
      {emailSent && <span>Email Sent. Check your inbox</span>}
      {sendError && <span>Error sending email. Try again later.</span>}
    </div>
  );
}
```

On your server, customize the email appearance by providing a custom email
builder. The builder receives email information and server configuration to
generate the email template:

```typescript
// server/email-builder.ts
import { EmailBuilder, EmailInfo, ServerOptions } from '@goatdb/goatdb/server';

export const customEmailBuilder: EmailBuilder = (
  info: EmailInfo,
  config: ServerOptions,
): EmailMessage => {
  switch (info.type) {
    case 'Login':
      return {
        subject: `Login to ${config.buildInfo.appName}`,
        text: `Click on this link to login to your account: ${info.magicLink}`,
        html:
          `<html><body><div>Click on this link to login to your account: <a href="${info.magicLink}">here</a></div></body></html>`,
        to: info.to,
      };
  }
};
```

Then modify your debug-server.ts and server.ts files in your project's skaffold
directory to use the custom email builder:

### App Component

The `App` component is the root of your application. It uses the `useDBReady()`
hook to manage the initial loading state. Depending on whether the user is
logged in, it displays either the login screen or the task list.

```tsx
// src/App.tsx
// @deno-types="@types/react"
import React from 'react';
import { useDB, useDBReady } from '@goatdb/goatdb/react';
import { Contents } from './Contents.tsx';
import { Login } from './Login.tsx';

export function App() {
  const db = useDB();
  const ready = useDBReady();
  if (ready === 'loading') {
    return <div>Loading...</div>;
  }
  if (ready === 'error') {
    return <div>Error! Please reload the page.</div>;
  }
  return db.loggedIn ? <Contents /> : <Login />;
}
```

### Opening Public User Registration

By default, GoatDB requires users to be pre-registered before they can log in.
To support environment-specific user registration, you can modify both your
`server.ts` and `debug-server.ts` files. For example, you might enable public
registration during development while enforcing restrictions in production.

For production, you could adjust your server.ts file as follows:

```typescript
// server.ts
const server = new Server({
  staticAssets: staticAssetsFromJS(encodedStaticAsses),
  path: args.path || path.join(Deno.cwd(), 'server-data'),
  buildInfo,
  resolveDomain: () => 'production-domain.com',
  autoCreateUser: (info: AutoCreateUserInfo) => {
    // In production, restrict registration to approved domains (e.g., company emails)
    return info.email ? info.email.endsWith('@company.com') : false;
  },
});
```

In contrast, for development and debugging purposes, you might configure
`debug-server.ts` like this:

```typescript
// debug-server.ts
const server = new Server({
  staticAssets: staticAssetsFromJS(encodedStaticAsses),
  path: args.path || path.join(Deno.cwd(), 'server-data'),
  buildInfo,
  resolveDomain: () => 'localhost',
  autoCreateUser: () => true, // Enable public registration during development
});
```

Editing these files differently lets you tailor registration behavior: public
registration on dev runs and restricted registration on production builds.

## Running the Application

Run the development server with:

```bash
deno task debug
```

This command will start a live-reload local server that listens at
[http://localhost:8080](http://localhost:8080) and stores all data at
`./server-data`.

## Testing Real-Time Sync & Conflict Resolution

One of GoatDB's powerful features is real-time synchronization combined with
robust conflict resolution. Follow these steps to observe these features in
action:

1. **Open the App in Two Tabs:**

   - Launch your application in your browser (e.g.,
     [http://localhost:8080](http://localhost:8080)).
   - Open a second tab and navigate to the same URL.

2. **Observe Real-Time Updates:**

   - In one tab, add a new task using the input field.
   - Watch as the new task appears in the second tab almost immediately,
     demonstrating real-time data propagation.

3. **Simulate a Conflict:**

   - In both tabs, locate the same task item.
   - Edit the task's text in both tabs simultaneously.
   - Observe how GoatDB's built-in conflict resolution mechanism handles the
     simultaneous updates. Typically, the system resolves conflicts based on the
     commit graph and version control-inspired logic. You can also click the
     **Download Commit Graph** button to inspect the underlying commit history
     for deeper insights. The downloaded JSON file can be loaded into Cytoscape
     ([https://cytoscape.org/](https://cytoscape.org/)) for visualization and
     analysis.

This interactive demo highlights how GoatDB ensures a consistent and resilient
application state even when multiple sources make concurrent modifications.

## Building the Server

To build a self-contained executable that includes both the server and client
code, run:

```bash
deno task build
```

This command leverages [ESBuild](https://esbuild.github.io/) and
[esbuild_deno_loader](https://github.com/lucacasonato/esbuild_deno_loader) under
the hood.

> **Note:** For cross compilation details and additional build configurations,
> please refer to the `build.ts` file.

## Conclusion

This Todo List app showcases the robust capabilities of GoatDB's architecture:

- **Edge-Native Design:** GoatDB shifts computational and synchronization tasks
  to edge nodes while a central server manages overall authority. This design
  allows your application to function efficiently even in offline or partially
  connected environments.
- **Version Control-Inspired Data Management:** With an append-only commit graph
  and versioned schemas, GoatDB offers a built-in audit trail and conflict
  resolution mechanism reminiscent of distributed version control systems.
- **Real-Time Synchronization & Conflict Resolution:** Through background
  commits and a probabilistic synchronization protocol, the app achieves
  near-real-time updates while gracefully handling concurrent modifications.
- **Seamless Integration with React:** GoatDB's React hooks (`useDB`,
  `useDBReady`, `
