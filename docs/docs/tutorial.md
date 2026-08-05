---
id: tutorial
title: Tutorial
sidebar_position: 2
slug: /tutorial
---

# Building a Todo List App with GoatDB

This tutorial walks you through building a Todo List app with
[GoatDB](https://goatdb.dev/) using [React](/docs/react). It demonstrates how to
leverage GoatDB's [architecture](/docs/architecture) and
[synchronization](/docs/sync) features. For the conceptual foundation behind
GoatDB's design, see [Core Concepts](/docs/concepts).

## Prerequisites

Before starting, make sure you have:

1. Completed the [Installation](/docs/install) steps
2. Read the [Concepts](/docs/concepts) documentation

## Define the Task Schema

Edit the file `common/schema.ts` to define our [schemas](/docs/schema) and
[authorization](/docs/authorization) rules:

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

This [schema](/docs/schema) defines:

- A required `text` field for the task description
- A `done` boolean field that defaults to false
- A `dateCreated` field that automatically sets the creation timestamp
- Authorization rules that ensure users can only access their own data

## Create the React Components

### Header Component

The `Header` component provides an input field for adding new task
[items](/docs/concepts#item):

```tsx
// client/Header.tsx
import React, { useRef } from 'react';
import { useDB } from '@goatdb/goatdb/react';
import { kSchemaTask } from '../common/schema.ts';

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

The `TaskItem` component displays and manages individual tasks
[items](/docs/concepts#item):

```tsx
// client/TaskItem.tsx
import React from 'react';
import { useItem } from '@goatdb/goatdb/react';
import { SchemaTypeTask } from '../common/schema.ts';

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

The `Contents` component manages the task list and
[filtering](/docs/query/#filtering-data):

```tsx
// client/Contents.tsx
import React, { useState } from 'react';
import { useDB, useQuery } from '@goatdb/goatdb/react';
import { kSchemaTask } from '../common/schema.ts';
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

The `Login` component handles user [authentication](/docs/sessions):

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

**Deno:**

```bash
deno task dev
```

**Node.js:**

```bash
npm run dev
```

This starts an interactive development server at http://localhost:8080 that
automatically rebuilds and reloads when you make changes to your code. The
server supports `beforeBuild` and `afterBuild` hooks for integrating external
build steps like Tailwind CSS or type generation.

## Testing Synchronization Features

### Sync Between Browser Tabs

1. Open the app in two browser tabs
2. Add a task in one tab - it should appear in the other tab
3. Edit a task simultaneously in both tabs - GoatDB will automatically resolve
   conflicts
4. Mark a task as done in one tab - the change should sync to the other tab

### Add an Agent Participant

This example runs agent logic **inside the development server process**. It uses
the server-local database and its root session; it is not a separately
configured replica peer. To see a human and that server-local agent share live
state, create `server/agent.ts`:

```typescript validate=module
// server/agent.ts
// Server-local agent logic that shares the server database with browser users.
import type { GoatDB } from '@goatdb/goatdb';
import { kSchemaTask } from '../common/schema.ts';

const initializedSuggestionPaths = new Set<string>();

function updateSuggestion(db: GoatDB, userKey: string): void {
  const path = `/data/${userKey}/agent-suggestion`;
  const suggestion = db.create(path, kSchemaTask, {
    text: 'Agent suggestion: rename me while offline',
    done: false,
  });
  if (initializedSuggestionPaths.has(path)) suggestion.set('done', true);
  else initializedSuggestionPaths.add(path);
}

export function startAgent(db: GoatDB): void {
  setInterval(() => {
    for (const userKey of db.repository('sys', 'users')!.keys()) {
      updateSuggestion(db, userKey);
    }
  }, 10_000);
}
```

Then wire it into `server/debug-server.ts`, right after `server.start()`:

```typescript
import { startAgent } from './agent.ts';

// ... after await server.start() ...

// Attach server-local agent logic. The server database uses a root session,
// which may write to any repository; its commits are signed by that session.
const services = await server.servicesForOrganization('dev-org');
startAgent(services.db);
```

Now run the full loop:

1. Start the development server, log in, and wait for the agent suggestion to
   appear. It arrives without a refresh through [sync](/docs/sync) and the same
   live [query](/docs/query) that renders your own tasks.
2. Before the next 10-second agent tick, use your browser's developer tools to
   go offline. Rename the suggestion without changing its checkbox.
3. Wait at least 10 seconds. The server's root session marks that same item done
   while your browser holds its offline text edit.
4. Go online again and show completed tasks if necessary. The item keeps both
   your new text and the agent's `done` value because concurrent changes to
   different fields merge independently. This demonstrates a same-item merge,
   not merely simultaneous writes to separate items. See
   [conflict resolution](/docs/conflict-resolution).

### Signed Provenance: Which Session Wrote What

In secure mode, every commit records the session that signed it. Walk any task's
[commit graph](/docs/commit-graph) to see exactly which session produced each
change - this snippet runs anywhere you have a `db` handle (inside `startAgent`,
or a temporary button handler in the app):

```typescript
const item = db.item(`/data/${userKey}/${taskKey}`);
for (const commit of item.repository!.commitsForKey(item.key)) {
  // commit.session is the signing session's id, stored in /sys/sessions
  console.log(commit.id, 'signed by session', commit.session);
}
```

Your edits are signed by your browser session; this example's agent edits are
signed by the server's root session. A signature proves which _session_ signed a
commit - mapping sessions to actors (this human, that agent) is your
application's responsibility. See [Sessions](/docs/sessions) for details.

## Building for Production

### Creating the Executable

Run the build command to create a self-contained executable:

**Deno:**

```bash
deno task build
```

**Node.js:**

```bash
npm run build
```

> **Node.js SEA builds** use `postject` (installed automatically with GoatDB).
> See the [CLI & Build Tools](./cli#building-standalone-executables) for
> details.

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

Deno supports cross-compilation for different environments:

- Operating Systems: macOS, Linux, Windows
- Architectures: x64 (Intel/AMD), arm64 (Apple Silicon/ARM)

Node.js uses
[Single Executable Applications (SEA)](https://nodejs.org/api/single-executable-applications.html)
for compilation. SEA does not support cross-compilation — you must build on the
same platform you intend to deploy to.

The entire build pipeline is implemented as a TypeScript API, making it easy to
integrate into existing build systems or CI/CD pipelines. You can
programmatically control the build process and customize it to your needs.
