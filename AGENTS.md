# AGENTS.md - AI Agent Operations

Essential invariants and commands for AI agents working on GoatDB.

## Tech Stack

- **Runtime**: Deno v2.x, Node.js 24.x
- **Language**: TypeScript (strict, explicit `.ts` imports required)
- **Browser Tests**: Playwright/Chromium
- **Package**: JSR @goatdb/goatdb

## Commands

```bash
# Tests (non-interactive)
deno task test                          # All runtimes
deno task test --suite=Trusted          # Filter by suite
deno task test --test="should init"     # Filter by test name
deno task test --runtime=deno           # deno | node | browser

# Smoke test (security boundaries only, <2s)
deno task test:smoke

# Build & Check
deno check mod.ts                       # Type check
deno fmt                                # Format
deno task build                         # Rebuild system assets
```

## Architecture Overview

```
db/db.ts           → GoatDB class (main entry)
db/managed-item.ts → ManagedItem (document interface)
db/session.ts      → ECDSA P-384 authentication
repo/              → Commit graphs, version history
net/server/        → HTTP server, sync protocol
server-build.ts    → Build-time exports (compile, startDebugServer, AppConfig)
tests/mod.ts       → Test framework (TEST function)
```

## Invariants

### Path Format: `/type/repo/item`

Strictly enforced via runtime assertions. No exceptions.

```typescript
db.item('/data/todos/task-123'); // Correct
db.item('/todos/task-123'); // FAILS - missing type
db.item('data/todos/task-123'); // FAILS - not absolute
```

### Async Readiness

Database operations MUST await readiness:

```typescript
const db = new GoatDB({ path: './data' });
await db.readyPromise(); // MANDATORY - always
// ... operations ...
await db.flushAll();
await db.close();
```

### Test Registration

ALL `TEST()` calls MUST be inside the setup function:

```typescript
// tests/my.test.ts
export default function setup() {
  TEST('Suite', 'test name', async (ctx) => {
    const db = await ctx.createDB('test-id');
    try {
      // test code
    } finally {
      await db.flushAll();
      await db.close();
    }
  });
}
```

Then register in `tests/tests-entry-server.ts`.

### Schema Registration

Schemas must be registered before use:

```typescript
DataRegistry.default.registerSchema(kMySchema);
db.create('/data/repo/item', kMySchema, data);
```

## Naming Conventions

| Type                | Pattern       | Example       |
| ------------------- | ------------- | ------------- |
| Variables/Functions | `camelCase`   | `changeCount` |
| Classes             | `PascalCase`  | `ManagedItem` |
| Private fields      | `_prefix`     | `_ready`      |
| Grouped utilities   | Common prefix | `itemPath*()` |

## Security Invariants

- ECDSA P-384 keys: private keys never leave device
- Sessions expire after 30 days (auto key rotation)
- All commits cryptographically signed
- Authorization rules run on every operation

## Common Failures

| Symptom                  | Cause                    | Fix                            |
| ------------------------ | ------------------------ | ------------------------------ |
| Test never runs          | `TEST()` outside setup   | Move inside `setup()`          |
| Operations fail silently | Missing `readyPromise()` | Always await before ops        |
| Validation error         | Schema not registered    | Register before use            |
| Test hangs               | DB not closed            | Use try/finally with `close()` |
| Path assertion           | Wrong format             | Use `/type/repo/item`          |

## CI

GitHub Actions runs `deno task test` on push/PR to main. Requires Playwright:
`deno run -A npm:playwright@^1.48.0 install --with-deps chromium`
