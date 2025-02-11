---
permalink: /tutorial/
layout: default
title: Tutorial
nav_order: 1
---

# Building a Todo List App with GoatDB

This tutorial walks you through building a full-featured Todo List app with
GoatDB using React. It demonstrates how to leverage GoatDB’s distributed,
edge-native architecture and real-time synchronization features.

GoatDB is a distributed, edge‑native database that shifts data processing to
client nodes while maintaining centralized authority. In GoatDB, items are the
basic data units (like rows or documents) defined by versioned schemas and
organized within repositories. Each item is uniquely identified by a path
(following the format /type/repo/item), which distinguishes system, application,
and user data, enabling efficient synchronization and conflict resolution.

## Prerequisites

- [Deno](https://deno.land/) installed on your machine.
- Basic knowledge of React and TypeScript.
- Familiarity with command-line operations.

## 1. Initialize Your GoatDB Project

Follow these steps to set up a new GoatDB project:

1. **Navigate to your project directory:**

   ```bash
   cd /path/to/project
   ```

2. **Add GoatDB to your project:**

   ```bash
   deno add jsr:@goatdb/goatdb
   ```

3. **Initialize GoatDB:**

   ```bash
   deno run -A jsr:@goatdb/goatdb/init
   ```

These steps install GoatDB and set up the underlying infrastructure for your
application.

## 2. Define the Task Schema

Create a file named `schema.ts` that defines the structure of your task items.
In GoatDB, schemas are plain JavaScript objects that define the versioned
structure of your data.

```typescript
// schema.ts
import { SchemaManager } from '@goatdb/goatdb';

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

// Register the schema with the default Schema Manager
export function registerSchemas(
  manager: SchemaManager = SchemaManager.default,
): void {
  manager.register(kSchemaTask);
}
```

## 3. Create the React Components

GoatDB provides a set of [React hooks](/react)—`useDB()`, `useDBReady()`,
`useQuery()`, and `useItem()`—that simplify state management and data
synchronization. Your app will consist of several React components. Each
component uses GoatDB React hooks to interact with the database.

### 3.1 Header Component

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

### 3.2 TaskItem Component

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

### 3.3 Contents Component

The `Contents` component ties everything together by querying and displaying the
list of tasks. It uses the `useQuery()` hook to fetch tasks from the user’s
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

### 3.4 Login Component

The `Login` component provides a simple email-based login using a magic link.
Once the user is authenticated, the app displays the task list. GoatDB includes
built in authentication and authorization tools that tie into the
[signed commit graph](/commit-graph).

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

### 3.5 App Component

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

## 4. Running the Application

Run the development server with:

```bash
deno task debug
```

This command will start a live-reload local server that listens at
[http://localhost:8080](http://localhost:8080) and stores all data at
`./server-data`.

## 5. Testing Real-Time Sync & Conflict Resolution

One of GoatDB’s powerful features is real-time synchronization combined with
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
   - Edit the task’s text in both tabs simultaneously.
   - Observe how GoatDB’s built-in conflict resolution mechanism handles the
     simultaneous updates. Typically, the system resolves conflicts based on the
     commit graph and version control-inspired logic. You can also click the
     **Download Commit Graph** button to inspect the underlying commit history
     for deeper insights. The downloaded JSON file can be loaded into Cytoscape
     ([https://cytoscape.org/](https://cytoscape.org/)) for visualization and
     analysis.

This interactive demo highlights how GoatDB ensures a consistent and resilient
application state even when multiple sources make concurrent modifications.

## 6. Building the Server

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

This Todo List app showcases the robust capabilities of GoatDB’s architecture:

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
- **Seamless Integration with React:** GoatDB’s React hooks (`useDB`,
  `useDBReady`, `useQuery`, and `useItem`) abstract away the complexities of
  state management and data synchronization, allowing you to focus on
  application logic.

By leveraging these architectural principles, the app not only maintains a
consistent and resilient state but also provides a scalable foundation for
building modern, edge-native applications. Enjoy building and extending your
GoatDB-powered applications!
