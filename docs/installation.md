---
permalink: /install/
layout: default
title: Install
nav_order: 0
---

## GoatDB Installation

GoatDB can be installed in both Deno and Node.js environments. Deno is our
preferred runtime (with benefits like compiling to a self-contained executable),
while Node.js support is currently **experimental**.

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

{: .warning }

Node.js support is currently a work in progress and is not yet ready for
production. Progress is tracked under this
[GitHub issue](https://github.com/goatplatform/goatdb/issues/27).

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

<br />
[Next: Concepts](/concepts){: .btn .btn-purple }
<br />
