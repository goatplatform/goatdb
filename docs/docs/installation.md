---
id: installation
title: Install
sidebar_position: 0
slug: /install
---


## GoatDB Installation

GoatDB runs on both Deno and Node.js as fully supported, first-class runtimes.
Deno is recommended for its cross-compilation support (compile once, deploy
anywhere), but Node.js is equally capable for production use.

### Deno Installation (Recommended)

1. **Add GoatDB to your project:**

   ```bash
   deno add jsr:@goatdb/goatdb
   ```

2. **Initialize the React Scaffold** (optional, for SPAs only):

   ```bash
   deno run -A jsr:@goatdb/goatdb/init
   ```
   > **Note**: The initialization step is only required for Single Page
   > Applications (SPAs). This command installs React dependencies and creates a
   > project scaffold with both client-side and server-side code structures.
   > Skip this step if you're not building a SPA or already have your React
   > setup configured.

### Node.js Installation

Install using one of the following package managers:

:::tip[Building Standalone Executables]

To compile Node.js applications to standalone executables using SEA (Single Executable Applications), ensure **postject** is available:

```bash
npm install -g postject
```

GoatDB uses postject automatically via `npx` during compilation. See [Node.js SEA docs](https://nodejs.org/api/single-executable-applications.html).

:::

**npm:**

```bash
npx jsr add @goatdb/goatdb
```

**Yarn:**

```bash
yarn dlx jsr add @goatdb/goatdb
```

**pnpm:**

```bash
pnpm dlx jsr add @goatdb/goatdb
```
