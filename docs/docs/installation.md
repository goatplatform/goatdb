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

2. **Scaffold a new project** (optional, for new apps):

   ```bash
   deno run -A jsr:@goatdb/goatdb init
   ```

   This creates a complete project — React client, GoatDB server, shared schema,
   and dev tooling — then installs all dependencies. Skip this step if you're
   adding GoatDB to an existing project.

   See the [CLI & Build Tools](./cli) for the generated file structure, all
   options, and Node.js usage.

### Node.js Installation

Requires **Node.js 26 or later**.

Install using one of the following package managers:

:::tip[Building Standalone Executables]

To compile Node.js applications to standalone executables using SEA (Single
Executable Applications), GoatDB uses the built-in `node --build-sea` flag
(available since Node.js 25.5.0). No additional dependencies required. See
[Node.js SEA docs](https://nodejs.org/api/single-executable-applications.html).

:::

**npm:**

```bash
npx jsr add @goatdb/goatdb
```

GoatDB's npm package has JSR-backed dependencies. `jsr add` configures the
`@jsr` registry automatically. If you install the package directly with npm, add
this to your project's `.npmrc` first:

```ini
@jsr:registry=https://npm.jsr.io
```

Then install it normally:

```bash
npm install @goatdb/goatdb
```

**Yarn:**

```bash
yarn dlx jsr add @goatdb/goatdb
```

**pnpm:**

```bash
pnpm dlx jsr add @goatdb/goatdb
```

**Scaffold a new project** (optional, for new apps):

```bash
npx -y @goatdb/goatdb init
npx -y @goatdb/goatdb init ./my-app   # optional target directory
```

See the [CLI & Build Tools](./cli) for details and generated file structure.
