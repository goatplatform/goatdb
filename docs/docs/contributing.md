---
id: contributing
title: Contributing
sidebar_position: 99
description: Help build the realtime state layer for human-agent collaboration
keywords: [
  contributing,
  development,
  open source,
  distributed databases,
  collaboration,
]
---

# Contributing to GoatDB

Your contributions build the state layer that humans and AI agents share. Every
feature you add, bug you fix, and optimization you make helps developers build
realtime, offline-capable apps where people and agents work on the same live
state.

:::tip[Ready to Start?] Check out our
[Good First Issues](https://github.com/goatplatform/goatdb/labels/good%20first%20issue)
to find your first contribution opportunity. :::

## What You're Building

**Simplicity for a Hard Problem**: Your code eliminates the custom sync servers,
[conflict resolution](/docs/conflict-resolution), and state management that
human-agent collaboration would otherwise require every app to build from
scratch.

**Distributed Systems Core**: Work on
[Bloom filter synchronization](/docs/sync), ephemeral
[CRDTs](/docs/conflict-resolution), and
[secure-mode cryptographically signed commit graphs](/docs/commit-graph) that
give agent actions a verifiable audit trail.

**Cross-Runtime Support**: Build features that work identically across
[Deno, Node.js, and browsers](/docs/architecture#repository-system) with a
single TypeScript codebase.

## Getting Started

**Prerequisites**: **Deno v2.4+** ([install here](https://deno.com/)) and
**Node.js v24+** for [cross-runtime testing](/docs/architecture).

**AI-Enhanced Development**: GoatDB is optimized for AI-assisted development
with [Claude Code](https://www.anthropic.com/claude-code),
[Cursor](https://cursor.com/), and
[ChunkHound](https://github.com/ofriw/chunkhound).

**Setup**:

```bash
git clone https://github.com/goatplatform/goatdb.git
cd goatdb

# Verify cross-platform functionality
deno task test   # Tests across Deno, Node.js, and browsers
deno task bench  # Performance validation
deno task build  # Compile optimizations

# Documentation site
deno task docs:install  # Install docs dependencies (first time)
deno task docs:serve    # Docusaurus docs server
```

## Testing & Performance

**Cross-Platform Testing**: Ensure your changes work identically across all
runtimes:

```bash
# All platforms
deno task test

# Specific environments
deno task test --runtime=browser
deno task test --runtime=node
deno task test --suite=DB --test="conflict resolution"

# Debug mode
deno task test --debug --deno-inspect-brk
```

**Performance Validation**: Maintain GoatDB's realtime performance
characteristics:

```bash
# Full benchmark suite
deno task bench

# Specific scenarios
deno task bench --benchmark="GoatDB Sync Protocol"
deno task bench --runtime=browser --headless
```

**Features**: Single-process debugging, real-world metrics (P95, P99), source
map support across all platforms.

:::tip[Quality Gate] Run `deno task test && deno task bench` before submitting
to ensure no regressions. :::

## Code Standards

- **Formatting** — `deno fmt` (2-space indent, single quotes, 80-char line
  width)
- **Naming** — `camelCase` for variables/functions, `PascalCase` for classes,
  `_prefix` for private fields
- **Imports** — explicit `.ts` extensions required
- **Cross-platform** — code must work identically across Deno, Node.js, and
  browsers

## Pull Request Checklist

- **Descriptive title** explaining your change's impact
- **All tests pass**: `deno task test` across all platforms
- **Performance maintained**: `deno task bench` shows no regressions
- **Documentation updated** for API changes

## Issues & Ideas

**Bug Reports**: Include GoatDB version, target runtime, reproduction steps, and
error messages.

**Feature Requests**: Check
[existing issues](https://github.com/goatplatform/goatdb/issues) first, then use
our
[feature request template](https://github.com/goatplatform/goatdb/issues/new).

**Security**: Email security issues privately to ofri [at] goatdb [dot] com.

## Community

- **[Discord](https://discord.gg/SAt3cbUqxr)** - Real-time chat and
  collaboration
- **[GitHub Discussions](https://github.com/goatplatform/goatdb/discussions)** -
  Technical conversations and proposals
- **[Reddit](https://www.reddit.com/r/zbdb/s/jx1jAbEqtj)** - Share projects and
  get feedback
- **[GitHub Issues](https://github.com/goatplatform/goatdb/issues)** - Bug
  reports and feature coordination

## License

All contributions are licensed under the
[MIT license](https://github.com/goatplatform/goatdb/blob/main/LICENSE).

---

Ready to contribute? Your first pull request is just a fork away.
