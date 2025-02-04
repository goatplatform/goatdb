## **GoatDB Cheatsheet Summary**

### **1. Paths & Repository Structure**

- **Path Format:** `/type/repoId/itemKey`
  - **Examples:**
    - Entire repo: `'/data/tasks'`
    - Specific item: `'/data/tasks/123'`

---

### **2. Architecture & Core Concepts**

- **Versioning & Commit Graph:**
  - Append‐only, signed commit graph (like Git) for auditability and migrations.
- **Managed P2P Network:**
  - **Central Server:** Authenticates nodes and supplies partial commit
    histories.
  - **Edge Nodes:** Handle local state, computation, and real-time sync.
- **Real-Time Synchronization:**
  - Syncs state changes up to 3× per second using a Bloom Filter–based protocol.
- **Storage Strategies:**
  - **Servers/Native Clients:** Append-only log file.
  - **Browsers:** Use OPFS; fallback to IndexedDB.
  - Clients maintain local replicas for offline work and debugging.

---

### **3. React Hooks API**

- **`useDB()`**
  - **Purpose:** Initialize or retrieve the default GoatDB instance.
  - **Usage:**
    ```tsx
    const db = useDB();
    ```

- **`useDBReady()`**
  - **Purpose:** Check the DB initialization status: `"loading"`, `"ready"`, or
    `"error"`.
  - **Usage:**
    ```tsx
    const dbStatus = useDBReady();
    if (dbStatus === 'loading') return <LoadingScreen />;
    if (dbStatus === 'error') return <ErrorScreen message='DB load failed' />;
    return <MainApp />;
    ```

- **`useQuery(config)`**
  - **Purpose:** Query a repository with filtering, sorting, limits, and
    context-triggered re-renders.
  - **Key Options:**
    - `schema`: Schema definition.
    - `source`: Repository path (e.g., `'/data/tasks'`).
    - `predicate`: Optional filter function.
    - `sortDescriptor`: Optional sort function.
    - `ctx`: Extra context.
    - `limit` & `showIntermittentResults`: Result handling.
  - **Usage:**
    ```tsx
    const tasksQuery = useQuery({
      schema: taskSchema,
      source: '/data/tasks',
      sortDescriptor: (a, b) => a.get('text').localeCompare(b.get('text')),
      predicate: (item) => !item.get('done'),
      showIntermittentResults: true,
    });
    ```

- **`useItem()`**
  - **Purpose:** Subscribe to a specific item for live updates.
  - **Usage:**
    ```tsx
    // Direct path string:
    const item = useItem('/data/tasks/123', { keys: ['text'] });

    // With separate repo and itemKey:
    const item = useItem(opts, '/data/tasks', '123');
    ```
  - **Existence Check:**
    ```ts
    if (cell.schema.ns !== null) {
      // The item exists.
    }
    ```

---

### **4. Schema Definition & Management**

- **Schema Structure:** A plain object with:
  - `ns`: Namespace (defines the item type).
  - `version`: Version number.
  - `fields`: Field definitions (type, required flag, default value, optional
    upgrade logic).
- **Registering Schemas:**
  - Use **SchemaManager** (e.g., via `SchemaManager.default`) to register your
    schemas.
- **Example – Task Schema:**
  ```ts
  // schema.ts
  import { SchemaManager } from '@goatdb/goatdb';

  export const kSchemaTask = {
    ns: 'task',
    version: 1,
    fields: {
      text: { type: 'string', required: true },
      done: { type: 'boolean', default: () => false },
    },
  } as const;

  export type SchemaTypeTask = typeof kSchemaTask;

  export function registerSchemas(
    manager: SchemaManager = SchemaManager.default,
  ): void {
    manager.register(kSchemaTask);
  }
  ```

---

### **5. Example: Todo List App Components**

#### **Header Component**

- **Purpose:** Create a new task using `useDB()`.
- **Code:**
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
            db.create('/data/tasks', kSchemaTask, { text: ref.current!.value });
          }}
        >
          Add
        </button>
      </div>
    );
  }
  ```

#### **TaskItem Component**

- **Purpose:** Subscribe to a task using `useItem()` for live updates.
- **Code:**
  ```tsx
  // src/TaskItem.tsx
  // @deno-types="@types/react"
  import React from 'react';
  import { useItem } from '@goatdb/goatdb/react';
  import { SchemaTypeTask } from '../schema.ts';

  export type TaskItemProps = { path: string };

  export function TaskItem({ path }: TaskItemProps) {
    const task = useItem<SchemaTypeTask>(path);
    if (!task) return <div>Loading...</div>;

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

#### **Contents Component**

- **Purpose:** List tasks using `useQuery()` with filtering and sorting.
- **Code:**
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
    const query = useQuery({
      schema: kSchemaTask,
      source: '/data/tasks',
      sortDescriptor: ({ left, right }) =>
        left.get('text').localeCompare(right.get('text')),
      predicate: ({ item, ctx }) => !item.get('done') || ctx.showChecked,
      showIntermittentResults: true,
      ctx: { showChecked },
    });

    return (
      <div>
        <Header />
        <div>
          <span>Show Checked</span>
          <input
            type='checkbox'
            checked={showChecked}
            onChange={(e) => setShowChecked(e.target.checked)}
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

#### **App Component**

- **Purpose:** Wait for DB readiness using `useDBReady()` before rendering.
- **Code:**
  ```tsx
  // src/App.tsx
  // @deno-types="@types/react"
  import React from 'react';
  import { useDBReady } from '@goatdb/goatdb/react';
  import { Contents } from './Contents.tsx';

  export function App() {
    const ready = useDBReady();
    if (ready === 'loading') return <div>Loading...</div>;
    if (ready === 'error') return <div>Error! Please reload.</div>;
    return <Contents />;
  }
  ```

---

### **6. Quick Reference for Coding**

- **Paths:**\
  Use `/type/repoId/itemKey`\
  (e.g., `/data/tasks` for a repo, `/data/tasks/123` for an item)

- **DB Initialization:**
  - `useDB()` to create/retrieve the DB instance.
  - `useDBReady()` to check if the DB is `"loading"`, `"ready"`, or `"error"`.

- **Data Management:**
  - **List queries:** `useQuery({ source: <path>, ... })`
  - **Single item:** `useItem(<path>)` (check existence with
    `cell.schema.ns !== null`)

- **Schema & Registration:**\
  Define schemas (with `ns`, `version`, and `fields`) and register them using
  **SchemaManager**.

- **Deno-Style Imports:**\
  Always include file extensions (e.g., `.ts`, `.tsx`) and, for third-party
  libraries, use URLs.\
  **Example:**
  ```ts
  // @deno-types="@types/react"
  import React from 'react';
  ```

---

This summary gives you all the key details and code patterns needed to build a
GoatDB-powered React app using Deno-style imports. Use it as a reference when
generating new code or extending functionality.
