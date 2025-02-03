---
permalink: /tutorial/
layout: default
title: Tutorial
nav_order: 1
---

# Building a Todo List App with GoatDB

Below is the complete tutorial in Markdown format. This tutorial walks you
through building a full-featured Todo List app with GoatDB using React. It
demonstrates how to leverage GoatDB’s distributed, edge-native architecture and
real-time synchronization features.

In this tutorial, you’ll build a Todo List app with GoatDB. You’ll learn how to:

- **Set up a GoatDB project**
- **Define versioned schemas for your data**
- **Create React components that leverage real-time synchronization**
- **Run an edge-native application using GoatDB’s distributed architecture**

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

---

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

Your app will consist of several React components. Each component uses GoatDB
React hooks to interact with the database.

### 3.1 Header Component

The `Header` component provides an input for new tasks and a button to add them.
It uses the `useDB` hook to access the database and create new task items.

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
      <input type='text' ref={ref} />
      <button
        onClick={() => {
          // Create a new task in the /data/tasks repository.
          // This automatically triggers updates in the task list.
          db.create('/data/tasks', kSchemaTask, {
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

The `TaskItem` component displays and manages an individual task. It uses the
`useItem` hook to subscribe to changes on a specific task, allowing for
real-time updates and seamless state management.

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
    </div>
  );
}
```

### 3.3 Contents Component

The `Contents` component manages the list of tasks. It uses the `useQuery` hook
to fetch and sort tasks from the `/data/tasks` repository. A local state
variable is used to control whether completed tasks should be shown.

```tsx
// src/Contents.tsx
// @deno-types="@types/react"
import React, { useState } from 'react';
import { useQuery } from '@goatdb/goatdb/react';
import { kSchemaTask } from '../schema.ts';
import { Header } from './Header.tsx';
import { TaskItem } from './TaskItem.tsx';

export function Contents() {
  const [showChecked, setShowChecked] = useState(true);
  // Create a query to fetch and sort tasks alphabetically by their text.
  const query = useQuery({
    schema: kSchemaTask,
    source: '/data/tasks',
    sortDescriptor: ({ left, right }) =>
      left.get('text').localeCompare(right.get('text')),
    // Filter tasks based on their "done" status and the local state.
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

### 3.4 App Component

The `App` component is the root of your application. It uses the `useDBReady`
hook to manage the initial loading state. Once GoatDB is ready, the main
contents of the app are rendered.

```tsx
// src/App.tsx
// @deno-types="@types/react"
import React from 'react';
import { useDBReady } from '@goatdb/goatdb/react';
import { Contents } from './Contents.tsx';

export function App() {
  const ready = useDBReady();
  // Display a loading screen or error message as needed.
  if (ready === 'loading') {
    return <div>Loading...</div>;
  }
  if (ready === 'error') {
    return <div>Error! Please reload the page.</div>;
  }
  return <Contents />;
}
```

## 4. Running the Application

```bash
deno task debug
```

Will start a live-reload local server that listens at http://localhost:8080 and
stores all data at `./server-data`

## 5. Building the Server

```bash
deno task build
```

Will build a self contained executable including both the server and client
code. Under the hood it uses [ESBuild](https://esbuild.github.io/) and
[esbuild_deno_loader](https://github.com/lucacasonato/esbuild_deno_loader).

## Conclusion

This Todo List app showcases the robust capabilities of GoatDB’s architecture:

- **Edge-Native Design:** GoatDB shifts computational and synchronization tasks
  to edge nodes while a central server manages overall authority. This design
  allows your application to function efficiently even in offline or partially
  connected environments.
- **Version Control-Inspired Data Management:** With an append-only commit graph
  and versioned schemas, GoatDB offers a built-in audit trail and conflict
  resolution mechanism reminiscent of distributed version control systems.
- **Real-Time Synchronization:** Through background commits and a probabilistic
  synchronization protocol, the app achieves near-real-time updates, ensuring
  that both local and remote changes are quickly propagated.
- **Seamless Integration with React:** GoatDB’s React hooks (`useDB`,
  `useDBReady`, `useQuery`, and `useItem`) abstract away the complexities of
  state management and data synchronization, allowing you to focus on
  application logic.

By leveraging these architectural principles, the app not only maintains a
consistent and resilient state but also provides a scalable foundation for
building modern, edge-native applications. Enjoy building and extending your
GoatDB-powered applications!

---
