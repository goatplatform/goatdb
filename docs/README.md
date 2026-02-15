# GoatDB Documentation

This documentation site is built using [Docusaurus](https://docusaurus.io/), a
modern static website generator.

## Prerequisites

- Deno (no Node.js or npm required!)

## Installation

First time setup - install dependencies using Deno:

```bash
cd docs
deno install
```

This will download and cache all npm dependencies specified in package.json
using Deno's npm compatibility layer.

## Development

To run the documentation site locally, use the Deno build script from the
project root:

```bash
deno run -A docs-build.ts serve
```

This will start a local development server with hot reload at
http://localhost:3000.

## Build

To build the static documentation site:

```bash
deno run -A docs-build.ts build
```

This generates static content into the `build/docs` directory.

## Architecture

GoatDB uses Deno throughout the entire project, including for documentation. The
`docs-build.ts` script leverages Deno's npm compatibility to run Docusaurus
directly without requiring Node.js:

- Uses `deno run -A npm:@docusaurus/core` to execute Docusaurus commands
- Dependencies are managed through `package.json` but executed via Deno
- No `node_modules` directory or npm installation required

This approach maintains consistency with GoatDB's Deno-first philosophy while
leveraging the excellent documentation features of Docusaurus.
