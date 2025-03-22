<!-- ---
permalink: /llm-cheatsheet/
layout: default
title: LLM Cheatsheet
nav_order: 4
description: Optimize AI-generated code for GoatDB-powered React applications with this comprehensive Large Language Model (LLM) cheatsheet.
keywords: ["LLM", "AI code generation", "Large Language Models", "React", "GoatDB", "AI-assisted development", "generative AI", "synchronous API", "AI programming"]
--- -->

# LLM Code Generation Cheatsheet for GoatDB

## Enhance Generative AI Performance with GoatDB

This cheatsheet is designed to help Large Language Models (LLMs) generate
high-quality, efficient code for GoatDB-powered React applications. By
leveraging GoatDB's synchronous API, LLMs can produce more predictable and
optimized code with minimal complexity.

### How to Use This Cheatsheet for LLM Code Generation

1. **Copy** this entire cheatsheet.
2. **Paste** it as context before your actual AI code generation prompt.
3. **Provide** your specific code generation request after the cheatsheet.

```
[Paste cheatsheet here]

Based on the above, generate a React component that displays a list of tasks with the following requirements:
- Show task title and completion status
- Allow marking tasks as complete
- Sort by creation date
```

## Why GoatDB Improves AI Code Generation

### Optimized for Large Language Models

#### **1. Synchronous API for Simplified AI Reasoning**

GoatDB eliminates complexities that often confuse LLMs, such as:

- **Async/await pitfalls**: No need for handling asynchronous execution.
- **State synchronization**: LLMs can directly manipulate state without fetching
  logic.
- **Race conditions**: Predictable execution order eliminates common concurrency
  issues.

##### **Code Comparison**

**With GoatDB (Synchronous Execution)**

```javascript
const task = useItem(path);
task.set('done', true); // Direct state update
```

**Traditional Approach (Asynchronous Execution)**

```javascript
try {
  await fetch(...);
  await refetchData();
  setState(...);
} catch (err) { ... }
```

#### **2. AI-Friendly Code Patterns for Better LLM Output**

- **Reduced Error Handling Complexity**: Status checks replace try/catch logic.
- **Deterministic Execution**: More predictable code paths enhance AI
  reliability.
- **Less Context Needed**: LLMs can focus on core business logic instead of
  network or state management.

### **3. Faster and More Accurate AI-Assisted Development**

GoatDB allows LLMs to efficiently generate complex, data-driven applications by
removing redundant decision points. This enables AI models to produce:

- **Cleaner, more readable code**
- **Fewer logic errors**
- **Optimized, high-performance components**

## LLM Code Generation Workflow with GoatDB

**Traditional AI Development Challenges:** LLMs must reason about:

- Database queries and connections
- State management solutions
- Cache invalidation strategies
- Handling loading states
- Error boundaries
- Complex data fetching logic

**GoatDB-Powered AI Development:** LLMs only need to:

1. Define the schema.
2. Use GoatDB hooks for data management.
3. Focus on business logic and UI.

### **Conclusion: Why GoatDB is the Best Choice for AI-Assisted Development**

By simplifying state management, reducing API complexity, and ensuring
predictable execution, GoatDB dramatically enhances AI-generated code quality.
LLMs using GoatDB can focus purely on business logic and UI, leading to
**faster, more accurate, and more efficient** AI-assisted development.

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
        sortBy: 'Optional sort function.'
        ctx: 'Extra context.'
        limit: 'Result handling.'
        showIntermittentResults: 'Result handling.'
      usage: |
        const tasksQuery = useQuery({
          schema: taskSchema,
          source: '/data/tasks',
          sortBy: (a, b) => a.get('text').localeCompare(b.get('text')),
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

      // Supported field types:
      // - string: Text values
      // - number: Numeric values
      // - boolean: True/false values
      // - date: DateTime values
      // - set: Unordered collection of unique values
      // - map: Key-value pairs
      // - richtext: Formatted text content
      // Note: Arrays are not supported - use Set instead
      export const kSchemaTask = {
        ns: 'task',
        version: 1,
        fields: {
          text: { type: 'string', required: true },
          done: { type: 'boolean', default: () => false },
          metadata: { type: 'map', default: () => new Map() },
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
            sortBy: ({ left, right }) =>
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

  AuthenticationAndUserManagement:
    login_process:
      magic_link_flow: |
        1. User enters email
        2. System sends magic link email
        3. User clicks link to complete login
        4. Session automatically attaches to user account
      code_example: |
        // Login.tsx
        function Login() {
          const db = useDB();
          const [emailSent, setEmailSent] = useState(false);

          const handleLogin = async (email) => {
            if (await db.loginWithMagicLinkEmail(email)) {
              setEmailSent(true);
            }
          };
        }

    logout_process:
      description: 'Clears local data and reloads page on browsers.'
      code_example: |
        const handleLogout = async () => {
          await db.logout();
          // Browser auto-reloads after logout
        };

    user_registration:
      server_configuration: |
        // server.ts
        const server = new Server({
          // ... other config ...
          autoCreateUser: (info) => {
            // Examples:

            // Allow all registrations:
            return true;

            // Restrict to company domain:
            return info.email?.endsWith('@company.com') ?? false;

            // Restrict to allowlist:
            const allowedEmails = ['user1@example.com', 'user2@example.com'];
            return info.email ? allowedEmails.includes(info.email) : false;
          },
        });

    session_management:
      check_login_status: 'db.loggedIn returns true if user is authenticated.'
      get_current_user: 'db.currentUser returns the user item if logged in.'
      get_current_session: 'db.currentSession returns the active session.'
      code_example: |
        function AuthGuard({ children }) {
          const db = useDB();
          const ready = useDBReady();

          if (ready === 'loading') return <LoadingScreen />;
          if (!db.loggedIn) return <Login />;
          return children;
        }

  AuthRulesQuickReference:
    basic_pattern: |
      // Register auth rules using path patterns and rule functions
      schemaManager.registerAuthRule('/data/todos', (db, repoPath, itemKey, session, op) => {
        // Return true to allow access, false to deny
        return session.owner === itemKey || op === 'read';
      });

    common_patterns:
      owner_only: |
        // Only allow access to item owner
        (db, repoPath, itemKey, session) => session.owner === itemKey

      read_public_write_owner: |
        // Public read, owner-only write
        (db, repoPath, itemKey, session, op) => op === 'read' || session.owner === itemKey

      team_access: |
        // Team-based access using metadata
        (db, repoPath, itemKey, session) => {
          const item = db.get(repoPath, itemKey);
          return item?.get('teamId') === session.get('teamId');
        }

    path_matching:
      exact_path: "'/data/todos'"
      regex_pattern: '/^\/data\/teams\/[^/]+\/items\//g'

    rule_execution: 'Rules are evaluated in registration order. First matching rule determines access.'
```
