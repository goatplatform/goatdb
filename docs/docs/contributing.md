---
id: contributing
title: Contributing
sidebar_position: 99
description: Join GoatDB's mission to revolutionize collaborative applications
keywords: [contributing, development, open source, distributed databases, collaboration]
---

# Contributing to GoatDB

Your contributions power the next generation of collaborative applications. Every feature you add, bug you fix, and optimization you make helps developers worldwide build better real-time, offline-capable apps.

:::tip[Ready to Start?]
Check out our [Good First Issues](https://github.com/goatplatform/goatdb/labels/good%20first%20issue) to find your first contribution opportunity.
:::

## What You're Building

**Simplicity for Complex Problems**: Your code eliminates the complexity of custom sync servers, [conflict resolution](/docs/conflict-resolution), and state management that traditionally plague collaborative apps.

**Cutting-Edge Distributed Systems**: Work on [Bloom filter synchronization](/docs/sync), ephemeral [CRDTs](/docs/conflict-resolution), and [cryptographically signed commit graphs](/docs/commit-graph)—techniques pushing the boundaries of database design.

**Cross-Runtime Innovation**: Build features that work identically across [Deno, Node.js, and browsers](/docs/architecture#repository-system) with a single TypeScript codebase.

## Getting Started

**Prerequisites**: **Deno v2.4+** ([install here](https://deno.com/)) and **Node.js v24+** for [cross-runtime testing](/docs/architecture).

**AI-Enhanced Development**: GoatDB is optimized for AI-assisted development with [Claude Code](https://www.anthropic.com/claude-code), [Cursor](https://cursor.com/), and [ChunkHound](https://github.com/ofriw/chunkhound).

**Setup**:
```bash
git clone https://github.com/goatplatform/goatdb.git
cd goatdb

# Verify cross-platform functionality
deno task test   # Tests across Deno, Node.js, and browsers
deno task bench  # Performance validation
deno task build  # Compile optimizations

# Documentation site
deno task docs:serve  # Docusaurus docs server
```

## Testing & Performance

**Cross-Platform Testing**: Ensure your changes work identically across all runtimes:

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

**Performance Validation**: Maintain GoatDB's real-time performance characteristics:

```bash
# Full benchmark suite
deno task bench

# Specific scenarios
deno task bench --benchmark="GoatDB Sync Protocol"
deno task bench --runtime=browser --headless
```

**Features**: Single-process debugging, real-world metrics (P95, P99), source map support across all platforms.

:::tip[Quality Gate]
Run `deno task test && deno task bench` before submitting to ensure no regressions.
:::

## Code Standards

**Formatting**: `deno fmt` (2 spaces, single quotes, 80 chars)
**Naming**: `camelCase` for variables, `PascalCase` for classes  
**Imports**: Use explicit `.ts` extensions
**Cross-platform**: Code must work identically on all target runtimes

## Contributor License Agreement

Before your first contribution can be merged, you'll need to sign our Contributor License Agreement (CLA). This one-time process takes just a minute:

1. **Open a Pull Request** with your contribution
2. **CLA Assistant will comment** with a link to sign the agreement
3. **Click the link and sign** using your GitHub account
4. **Your PR status updates automatically** once signed

The CLA ensures GoatDB can maintain long-term project sustainability while protecting both contributors and users. You retain copyright of your work while granting GoatDB the rights needed to distribute and improve the project.

:::tip[One-Time Process]
Once signed, the CLA covers all your future contributions to GoatDB. Corporate contributors should use our [Corporate CLA](https://cla-assistant.io/goatplatform/goatdb).
:::

## Pull Request Checklist

- **CLA signed** (automated check will verify)
- **Descriptive title** explaining your change's impact
- **All tests pass**: `deno task test` across all platforms
- **Performance maintained**: `deno task bench` shows no regressions
- **Documentation updated** for API changes

## Issues & Ideas

**Bug Reports**: Include GoatDB version, target runtime, reproduction steps, and error messages.

**Feature Requests**: Check [existing issues](https://github.com/goatplatform/goatdb/issues) first, then use our [feature request template](https://github.com/goatplatform/goatdb/issues/new).

**Security**: Email security issues privately to ofri [at] goatdb [dot] com.

## Community

- **[Discord](https://discord.gg/SAt3cbUqxr)** - Real-time chat and collaboration
- **[GitHub Discussions](https://github.com/goatplatform/goatdb/discussions)** - Technical conversations and proposals
- **[Reddit](https://www.reddit.com/r/zbdb/s/jx1jAbEqtj)** - Share projects and get feedback
- **[GitHub Issues](https://github.com/goatplatform/goatdb/issues)** - Bug reports and feature coordination

## License

All contributions are licensed under the MIT license. The CLA you sign grants GoatDB the rights needed for long-term project sustainability, including the ability to relicense if needed for future project health, while you retain copyright ownership.

---

Ready to contribute? Your first pull request is just a fork away.
