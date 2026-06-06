# AGENTS.md - AI Agent Operations

## Tech Stack

- **Runtime**: Deno v2.x, Node.js 24.x
- **Language**: TypeScript (strict, explicit `.ts` imports required)
- **Browser Tests**: Playwright/Chromium
- **Package**: JSR @goatdb/goatdb

## Logging

GoatDB uses custom `logging/` infra. ALWAYS use it. NEVER direct console logs.

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

## Invariants

### Test Registration

ALL `TEST()` calls MUST be inside the setup function:

```typescript
// tests/my.test.ts
export default function setup() {
  TEST("Suite", "test name", async (ctx) => {
    const db = await ctx.createDB("test-id");
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

### Runtime-Specific Tests

DO NOT put platform checks inside test bodies or around individual `TEST()`
calls. Instead, gate TEST registration at the setup-function or entry-point
level:

```typescript
// ✅ CORRECT — registration gated, test body is pure
export default function setupServerTests() {
  TEST("Suite", "works", async (ctx) => {
    // No platform checks here — pure test logic
  });
}

// tests-entry.ts or test-registry.ts — caller decides which runtimes
// register which suites. Only ONE gate per test file.
import { isBrowser } from "../base/common.ts";
import setupServerTests from "./server.test.ts";

if (!isBrowser()) {
  setupServerTests(); // ← gate here, not inside the setup function
}
```

❌ WRONG — platform check in test body:

```typescript
TEST("Suite", "name", async (ctx) => {
  if (!isNode()) return; // ← silently no-ops, wastes resources
});
```

❌ WRONG — platform check around each TEST():

```typescript
if (!isBrowser()) {        // ← repetitive, 59 copies in one file
  TEST('Suite', 'name', ...);
}
```

## Security Invariants

- Ed25519 keys: private keys never leave device
- Sessions expire after 30 days (auto key rotation)
- All commits cryptographically signed (unless in Trusted mode)
- Authorization rules run on every operation
