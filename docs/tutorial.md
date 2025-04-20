---
permalink: /tutorial/
layout: default
title: Tutorial
nav_order: 2
---

# Building a Todo List App with GoatDB

This tutorial walks you through building a Todo List app with GoatDB using
React. It demonstrates how to leverage GoatDB's distributed, edge-native
architecture and real-time synchronization features.

## Prerequisites

Before starting, make sure you have:

1. Completed the [Installation](/install) steps
2. Read the [Concepts](/concepts) documentation

## Define the Task Schema

Edit the file `common/registry.ts` to define our schemas and authorization
rules:

```typescript
import { DataRegistry, itemPathGetPart } from '@goatdb/goatdb';

// Define the task schema
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
    dateCreated: {
      type: 'date',
      default: () => new Date(),
    },
  },
} as const;
export type SchemaTypeTask = typeof kSchemaTask;

// Register schemas and authorization rules
export function registerSchemas(
  registry: DataRegistry = DataRegistry.default,
): void {
  // Register the task schema
  registry.registerSchema(kSchemaTask);

  // Allow each user to access only their own repository
  registry.registerAuthRule(
    /\/data\/\w+/,
    ({ repoPath, session }) =>
      itemPathGetPart(repoPath, 'repo') === session.owner,
  );
}
```

This schema defines:

- A required `text` field for the task description
- A `done` boolean field that defaults to false
- A `dateCreated` field that automatically sets the creation timestamp
- Authorization rules that ensure users can only access their own data

## Create the React Components

### Header Component

The `Header` component provides an input field for adding new tasks:

```tsx
// client/Header.tsx
import React, { useRef } from 'react';
import { useDB } from '@goatdb/goatdb/react';
import { kSchemaTask } from '../common/registry.ts';

export function Header() {
  const db = useDB();
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div>
      <input type='text' ref={ref} />
      <button
        onClick={() => {
          if (ref.current?.value) {
            // Create a new task in the user's repository
            db.create(`/data/${db.currentUser!.key}`, kSchemaTask, {
              text: ref.current.value,
            });
            ref.current.value = '';
          }
        }}
      >
        Add
      </button>
    </div>
  );
}
```

### TaskItem Component

The `TaskItem` component displays and manages individual tasks:

```tsx
// client/TaskItem.tsx
import React from 'react';
import { useItem } from '@goatdb/goatdb/react';
import { SchemaTypeTask } from '../common/registry.ts';

export type TaskItemProps = {
  path: string;
};

export function TaskItem({ path }: TaskItemProps) {
  // Subscribe to changes for this specific task
  const task = useItem<SchemaTypeTask>(path)!;

  return (
    <div>
      <input
        type='checkbox'
        checked={task.get('done')}
        onChange={(e) => task.set('done', e.target.checked)}
      />
      <input
        type='text'
        value={task.get('text')}
        onChange={(e) => task.set('text', e.target.value)}
      />
      <button
        onClick={() => {
          // Mark the task for deletion
          task.isDeleted = true;
        }}
      >
        Delete
      </button>
    </div>
  );
}
```

### Contents Component

The `Contents` component manages the task list and filtering:

```tsx
// client/Contents.tsx
import React, { useState } from 'react';
import { useDB, useQuery } from '@goatdb/goatdb/react';
import { kSchemaTask } from '../common/registry.ts';
import { Header } from './Header.tsx';
import { TaskItem } from './TaskItem.tsx';

export function Contents() {
  const db = useDB();
  const [showChecked, setShowChecked] = useState(true);

  // Query tasks from the user's repository
  const query = useQuery({
    schema: kSchemaTask,
    source: `/data/${db.currentUser!.key}`,
    sortBy: 'dateCreated',
    sortDescending: true,
    predicate: ({ item, ctx }) => !item.get('done') || ctx.showChecked,
    showIntermittentResults: true,
    ctx: { showChecked },
  });

  return (
    <div>
      <Header />
      <div>
        <label>
          Show Completed Tasks
          <input
            type='checkbox'
            checked={showChecked}
            onChange={(e) => setShowChecked(e.target.checked)}
          />
        </label>
      </div>
      {query.results().map(({ path }) => <TaskItem key={path} path={path} />)}
    </div>
  );
}
```

### Login Component

The `Login` component handles user authentication:

```tsx
// client/Login.tsx
import React, { useRef, useState } from 'react';
import { useDB } from '@goatdb/goatdb/react';

export function Login() {
  const db = useDB();
  const ref = useRef<HTMLInputElement>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div>
      <input type='email' ref={ref} placeholder='Enter your email' />
      <button
        onClick={async () => {
          if (await db.loginWithMagicLinkEmail(ref.current!.value)) {
            setEmailSent(true);
            setError(false);
          } else {
            setError(true);
          }
        }}
      >
        Login
      </button>
      {emailSent && <p>Check your email for the login link</p>}
      {error && <p>Error sending login email. Please try again.</p>}
    </div>
  );
}
```

### App Component

The root component that ties everything together:

```tsx
// client/App.tsx
import React from 'react';
import { useDB, useDBReady } from '@goatdb/goatdb/react';
import { Contents } from './Contents.tsx';
import { Login } from './Login.tsx';

export function App() {
  const db = useDB();
  const ready = useDBReady();

  if (ready === 'loading') return <div>Loading...</div>;
  if (ready === 'error') return <div>Error loading database</div>;

  return db.loggedIn ? <Contents /> : <Login />;
}
```

## Running the Application

Start the development server with:

```bash
deno task debug
```

This starts an interactive development server at http://localhost:8080 that
automatically rebuilds and reloads when you make changes to your code. The
server supports `beforeBuild` and `afterBuild` hooks for integrating external
build steps like Tailwind CSS or type generation.

## Testing Real-Time Features

1. Open the app in two browser tabs
2. Add a task in one tab - it should appear in the other tab
3. Edit a task simultaneously in both tabs - GoatDB will automatically resolve
   conflicts
4. Mark a task as done in one tab - the change should sync to the other tab

## Building for Production

### Creating the Executable

Run the build command to create a self-contained executable:

```bash
deno task build
```

### Configuring the Build

Edit `server/build.ts` to specify your target environment:

```typescript
await compile({
  // ... other options ...
  os: 'linux', // Target OS: 'mac', 'linux', or 'windows'
  arch: 'x64', // Target architecture: 'x64' or 'arm64'
});
```

### Cross-Compilation Support

The build process supports cross-compilation for different environments:

- Operating Systems: macOS, Linux, Windows
- Architectures: x64 (Intel/AMD), arm64 (Apple Silicon/ARM)

The entire build pipeline is implemented as a TypeScript API, making it easy to
integrate into existing build systems or CI/CD pipelines. You can
programmatically control the build process and customize it to your needs.

<br />
[Next: Sessions and Users](/sessions){: .btn .btn-purple }
<br />
