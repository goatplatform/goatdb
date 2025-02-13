---
permalink: /llm-cheatsheet/
layout: default
title: LLM Cheatsheet
nav_order: 4
---

# GoatDB LLM Cheatsheet

This cheatsheet is designed to help Large Language Models (LLMs) generate
accurate code for GoatDB-powered React applications. To use it effectively:

1. Copy this entire cheatsheet
2. Paste it as context before your actual code generation prompt
3. Follow with your specific code generation request

Example usage:

```
[Paste cheatsheet here]

Based on the above, generate a React component that displays a list of tasks with the following requirements:
- Show task title and completion status
- Allow marking tasks as complete
- Sort by creation date
```

## Why GoatDB Helps LLMs Generate Complex Code

### Synchronous API Benefits for LLMs

1. **Reduced State Space**: LLMs don't need to reason about:
   - Async/await patterns
   - Promise chains
   - Race conditions
   - Network retries
   - State synchronization

2. **Predictable Patterns**: Code follows simple, consistent structures:
   ```javascript
   // LLMs can focus on business logic
   const task = useItem(path);
   task.set('done', true); // Direct manipulation
   ```
   Instead of complex async patterns:
   ```javascript
   // LLMs must reason about many edge cases
   try {
     await fetch(...)
     await refetchData()
     setState(...)
   } catch (err) { ... }
   ```

3. **Error Handling Simplification**:
   - Status checks replace try/catch logic
   - Fewer edge cases to consider
   - More deterministic code paths

4. **Context Reduction**:
   - LLMs can generate complex features with less context
   - No need to understand network topology
   - No need to track state management patterns

### Example: LLM Code Generation

When asking an LLM to generate code for a real-time collaborative feature:

**Traditional Approach** - LLM needs to understand:

- WebSocket connections
- State synchronization
- Conflict resolution
- Error recovery
- Race conditions

**GoatDB Approach** - LLM only needs to:

1. Define the schema
2. Use appropriate hooks
3. Focus on UI/business logic

This dramatic reduction in complexity allows LLMs to generate more reliable code
for complex features.

## GoatDB Cheatsheet

```yaml
GoatDBCheatsheet:
  PathsAndRepositoryStructure:
    path_format: '/type/repoId/itemKey'
    examples:
      - "Entire repo: '/data/tasks'"
      - "Specific item: '/data/tasks/123'"

  ArchitectureAndCoreConcepts:
    versioning_commit_graph: 'Append-only, signed commit graph (like Git) for auditability and migrations.'
    managed_p2p_network:
      central_server: 'Authenticates nodes and supplies partial commit histories.'
      edge_nodes: 'Handle local state, computation, and real-time sync.'
    real_time_synchronization: 'Syncs state changes up to 3× per second using a Bloom Filter–based protocol.'
    storage_strategies:
      servers_native_clients: 'Append-only log file.'
      browsers: 'Use OPFS; fallback to IndexedDB.'
      note: 'Clients maintain local replicas for offline work and debugging.'

  ReactHooksAPI:
    useDB:
      purpose: 'Initialize or retrieve the default GoatDB instance.'
      usage: 'const db = useDB();'
    useDBReady:
      purpose: "Check the DB initialization status: 'loading', 'ready', or 'error'."
      usage: |
        const dbStatus = useDBReady();
        if (dbStatus === 'loading') return <LoadingScreen />;
        if (dbStatus === 'error') return <ErrorScreen message='DB load failed' />;
        return <MainApp />;
    useQuery:
      purpose: 'Query a repository with filtering, sorting, limits, and context-triggered re-renders.'
      key_options:
        schema: 'Schema definition.'
        source: "Repository path (e.g., '/data/tasks')."
        predicate: 'Optional filter function.'
        sortDescriptor: 'Optional sort function.'
        ctx: 'Extra context.'
        limit: 'Result handling.'
        showIntermittentResults: 'Result handling.'
      usage: |
        const tasksQuery = useQuery({
          schema: taskSchema,
          source: '/data/tasks',
          sortDescriptor: (a, b) => a.get('text').localeCompare(b.get('text')),
          predicate: (item) => !item.get('done'),
          showIntermittentResults: true,
        });
    useItem:
      purpose: 'Subscribe to a specific item for live updates.'
      usage:
        direct_path: "const item = useItem('/data/tasks/123', { keys: ['text'] });"
        separate_repo_and_itemKey: "const item = useItem(opts, '/data/tasks', '123');"
      existence_check: |
        if (cell.schema.ns !== null) {
          // The item exists.
        }

  SchemaDefinitionAndManagement:
    schema_structure: 'A plain object with: ns (namespace), version, and fields (type, required flag, default value, optional upgrade logic).'
    registering_schemas: 'Use SchemaManager (e.g., via SchemaManager.default) to register your schemas.'
    example_task_schema: |
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

  TodoListAppComponents:
    header_component:
      purpose: 'Create a new task using useDB().'
      code: |
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
    task_item_component:
      purpose: 'Subscribe to a task using useItem() for live updates.'
      code: |
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
    contents_component:
      purpose: 'List tasks using useQuery() with filtering and sorting.'
      code: |
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
    app_component:
      purpose: 'Wait for DB readiness using useDBReady() before rendering.'
      code: |
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

  QuickReference:
    paths: 'Use /type/repoId/itemKey (e.g., /data/tasks for a repo, /data/tasks/123 for an item).'
    db_initialization:
      useDB: 'to create/retrieve the DB instance.'
      useDBReady: "to check if the DB is 'loading', 'ready', or 'error'."
    data_management:
      list_queries: 'useQuery({ source: <path>, ... })'
      single_item: 'useItem(<path>) (check existence with cell.schema.ns !== null)'
    schema_and_registration: 'Define schemas (with ns, version, and fields) and register them using SchemaManager.'
    deno_style_imports: |
      Always include file extensions (e.g., .ts, .tsx) and, for third-party libraries, use URLs.
      Example:
      // @deno-types="@types/react"
      import React from 'react';
```
