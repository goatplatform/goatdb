# AGENTS.md - AI Agent Operations

Essential invariants and commands for AI agents working on GoatDB.

## Tech Stack

- **Runtime**: Deno v2.x, Node.js 24.x
- **Language**: TypeScript (strict, explicit `.ts` imports)
- **Browser Tests**: Playwright/Chromium
- **Package**: JSR @goatdb/goatdb

## Logging

Use `logging/` infra. Never `console.log`.

## Commands

```bash
deno task test                          # All runtimes
deno task test --suite=Trusted          # Filter suite
deno task test --test="should init"     # Filter name
deno task test --runtime=deno           # deno | node | browser
deno task test:smoke                    # <2s smoke test
deno check mod.ts                       # Type check
deno fmt                                # Format
deno task build                         # Rebuild (req'd after codec changes)
```

## Agent Commands

```bash
agent-browser open <url>    # Open URL in headless browser
agent-browser snapshot -ic  # Snapshot interactive elements (default)
agent-browser snapshot -c   # Snapshot full page structure
agent-browser snapshot -s "css-selector" -ic  # Scope snapshot
```

## Common Failures

| Symptom                  | Cause                    | Fix                            |
| ------------------------ | ------------------------ | ------------------------------ |
| Test never runs          | `TEST()` outside setup   | Move inside `setup()`          |
| Operations fail silently | Missing `readyPromise()` | Always await before ops        |
| Validation error         | Schema not registered    | Register before use            |
| Test hangs               | DB not closed            | Use try/finally with `close()` |
| Path assertion           | Wrong format             | Use `/type/repo/item`          |
