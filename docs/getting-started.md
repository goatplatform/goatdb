---
permalink: /getting-started/
layout: default
title: Getting Started
nav_order: 1
---

# Getting Started with GoatDB

GoatDB is a comprehensive SDK for building Single Page Applications (SPAs) using [Deno](https://docs.deno.com), [ESBuild](https://esbuild.github.io/), and [React](https://react.dev/). It offers an interactive development server and the capability to compile projects into standalone executables without external dependencies.

---

## Installation

Ensure you have [Deno 2+](https://docs.deno.com/runtime/getting_started/installation/) installed. If not, install it [here](https://docs.deno.com/runtime/getting_started/installation/). Deno is a modern alternative to Node.js, offering superior developer experience and workflows.

For a better development experience, consider installing the Deno plugin for your preferred IDE.

### Steps:

1. Navigate to your project directory:
   ```bash
   cd /path/to/project
   ```
2. Add GoatDB to your project:
   ```bash
   deno add jsr:@goatdb/goatdb
   ```
3. Initialize GoatDB:
   ```bash
   deno run -A jsr:@goatdb/goatdb/init
   ```

---

## Starting the Debug Server

After installation, start the interactive debug server by running:

```bash
deno task debug
```

This launches the server at [http://localhost:8080](http://localhost:8080). The server watches for project changes and automatically rebuilds the client code.

**Tip:** Use an incognito browser session when accessing the debug server, as GoatDB persists data between sessions.

---

## Project Structure

- **`/schema.ts`**: Define new schemas for your project here. Follow the instructions in the file for guidance.
- **`/src/`**: Contains your application’s code—the core of your project.
- **`/scaffold/`**: Hosts the root HTML, CSS, and TSX files for your project. Edit these for application-wide effects.

---

# Creating a Schema

To create a schema:

1. Open `schema.ts` and remove the placeholder schema.
2. Add a new schema definition, for example:

   ```typescript
   export const kSchemaTask = {
     ns: 'task',
     version: 1,
     fields: {
       text: {
         type: 'string',
         default: () => 'Untitled',
       },
       done: {
         type: 'boolean',
         default: () => false,
       },
     },
   } as const;
   export type SchemaTypeTask = typeof kSchemaTask;
   ```

   This schema defines a task with two fields:

   - **`text`**: A string with a default value of "Untitled."
   - **`done`**: A boolean with a default value of `false`.

3. Register the schema by updating the `registerSchemas()` function at the bottom of the file:
   ```typescript
   export function registerSchemas(
     manager: SchemaManager = SchemaManager.default,
   ): void {
     manager.register(kSchemaTask);
   }
   ```

**Note:** Both client and server code call this function during initialization to ensure consistent schema definitions. Schema versions are automatically managed, and items are upgraded on-the-fly.

---

# Storing Data

In GoatDB, data is organized into repositories—collections of items designed to:

- Hold up to 100,000 items (this limit may increase in future versions).
- Contain items with various schemas within the same repository.

Repositories automatically track item histories and synchronize changes independently with the server. This design improves performance and enables real-time collaboration.

### Repository Usage

For a simple to-do list, store all tasks in the `/data/tasks` repository. GoatDB will create the repository automatically when needed—no manual setup required.

### Benefits of Repositories:

- **Optimized Performance**: Group related items together to minimize overhead.
- **Flexible Permissions**: Access rules can be applied at the item level, allowing granular control within a single repository.
- **Versioning**: Repositories seamlessly upgrade item schemas to the latest version, so you never deal with outdated data.

**Pro Tip:** Keep related items within the same repository to take full advantage of GoatDB’s synchronization and performance optimizations.

---

# Querying Data

To query data, edit the `Contents` component in `src/app.tsx`:

```typescript
export function Contents() {
  const query = useQuery({
    schema: kSchemaTask,
    source: '/data/tasks',
  });

  return (
    <div>
      {query.results().map(({ path }) => (
        <div key={path}>
          <TaskItem path={path} />
        </div>
      ))}
    </div>
  );
}
```

### How It Works:

- **`useQuery`**: Opens an [incremental query](/query) with the provided configuration.
  - **`schema`**: Defines the schema of the items to query.
  - **`source`**: Specifies the repository (`/data/tasks` in this case).
- Items are automatically upgraded to the latest schema version during queries.
- The hook re-renders the component whenever the repository changes, whether by local or remote updates.

**Real-time Collaboration:** GoatDB synchronizes changes between users up to three times per second, enabling seamless collaboration.
