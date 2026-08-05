# GoatDB Documentation

This site uses [Docusaurus](https://docusaurus.io/) for written documentation
and TypeDoc for the generated API reference.

## Prerequisites

- Deno 2.x
- Node.js 24.x with npm

## Installation

Install the locked documentation dependencies from the repository root:

```bash
deno task docs:install
```

This runs `npm ci` against the tracked `docs/package-lock.json`.

## Development

Generate the API reference and start the local development server:

```bash
deno task docs:serve
```

The site is available at <http://localhost:3000> with hot reload.

## Build

Build the complete static site:

```bash
deno task docs:build
```

The build produces `build/docs` and `build/docs.zip`.

Type-check the Docusaurus site separately with:

```bash
npm --prefix docs run typecheck
```

Remove generated output and installed dependencies with:

```bash
deno task docs:clean
```

The clean task preserves both dependency lockfiles.

## Dependency ownership

npm owns the documentation dependency tree in `docs/node_modules` and installs
it deterministically from `docs/package-lock.json`. Deno orchestrates API
reference generation and the Docusaurus npm scripts using `docs/deno.json`; that
config keeps the Deno-only JSR dependencies pinned in `docs/deno.lock`.
