# Changelog

All notable changes to GoatDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and GoatDB adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Bug Fixes

- Exact `--suite` and `--test` no-match failures are now surfaced clearly on
  single-runtime execution paths, including the Node.js runner.
- Mixed-runtime filtered runs now tolerate a no-match result from one selected
  runtime when another selected runtime still has matching tests.

### Breaking Changes

- **Binary `.goat` storage format**: Commits are now stored in a compact binary
  format (magic byte `0x47 'G'`, little-endian commit fields, big-endian 4-byte
  length framing). Both `.jsonl` and the new binary format are first-class
  citizens; the format is selected via `DBInstanceConfig.storageFormat`. Manual
  migration required for any tooling that reads `.goat` files directly.

- **Bloom-filter ancestors replaced with explicit string arrays**: The `'af'`
  (ancestor filter) and `'ac'` (ancestor count) commit fields are no longer
  written or read. Existing commits that used Bloom-filter ancestry load with
  `ancestors=[]`; ancestor edges are rebuilt as new merge commits are written.
  No data loss occurs, but one extra merge cycle may run per affected key on
  first upgrade.

- **Strict `.goat` binary format**: Non-binary records in `.goat` files are now
  rejected with an error log (previously silently loaded). Any `.goat` file with
  mixed JSON/binary content requires manual migration.

- **`leavesForKey()` session parameter removed**: The optional `session`
  parameter has been removed from `Repository.leavesForKey()`.

- **`commitIsHighProbabilityLeaf()` renamed to `commitIsLeaf()`**: Reflects the
  switch from probabilistic Bloom-filter ancestry to exact ancestor tracking.

- **Ed25519 signing replaces ECDSA P-384**: Session keys now use Ed25519.
  Existing ECDSA-signed commits cannot be verified; a fresh trust pool is
  required.

- **`liveUpdates` defaults to `true`**: Queries now push live (uncommitted)
  updates on `set()` by default. Set `liveUpdates: false` to restore commit-only
  update behavior.

- **Query cache IDs changed (MD5 -> Murmur3)**: `generateQueryId` now uses
  Murmur3 instead of MD5. Persisted query caches from prior versions will miss
  on upgrade and be lazily rebuilt -- no data loss, but expect a one-time
  re-scan on first open.

- **`startDebugServer` returns `Promise<void>` now (was `Promise<never>`)**:
  Resolves after shutdown. Callers relying on `never` for control-flow narrowing
  need updating.
- **`config.debug` is now saved on entry and restored on exit**: No longer
  leaked after server stops.
- **Config file auto-detection is runtime-specific**: Deno imports `deno.json`;
  Node.js imports `package.json`. No cross-runtime fallback. Explicit
  `denoJson`/`packageJson` options work as before.

- **`AppConfig.cssPath` semantics changed** _(first released in 0.5.1)_: The
  `cssPath` field now represents a vendor/prepend CSS file that is prepended
  into `/index.css` before esbuild-bundled CSS, rather than the sole source of
  the app's CSS. Use this for global resets or vendor CSS that must load before
  component styles. For application CSS, prefer `import './index.css'` in your
  JS entry point instead.

  **Migration:**
  ```typescript
  // Before — cssPath was the only CSS file
  cssPath: './src/styles.css',

  // After — use cssPath only for vendor/prepend CSS;
  // import application CSS in your JS entry point
  cssPath: './src/vendor.css',
  // In your JS/TS entry: import './src/styles.css';
  ```

- **`EmailMessage` decoupled from nodemailer types**: `EmailMessage` no longer
  extends nodemailer's `SendMailOptions`. It is now a portable explicit type
  defined in `net/server/email-message.ts`, importable from
  `@goatdb/goatdb/server/email` without pulling in nodemailer. Custom email
  builders can now typecheck under Deno's `--node-modules-dir=false` mode.
  `Uint8Array` content is automatically converted to `Buffer` before sending.
  All common message fields (from, to, cc, bcc, subject, text, html, headers,
  attachments) are preserved. Users relying on nodemailer-specific
  `SendMailOptions` fields not in the portable subset may need to adjust.

### Added

- `GoatDB.insert()` — bulk API for batch item creation without ancestor
  computation overhead for new keys
- `liveUpdates` option on queries — live push updates from the repo
- `WriteFailure` event on `GoatDB` — surfaced when a commit fails to persist
- Binary commit codec (`base/core-types/encoding/binary-commit.ts`) bundled into
  the storage worker for zero-copy encode/decode
- `esbuildPlugins` option on `compile()` and `startDebugServer()` for custom
  esbuild plugins in the client bundle pipeline

- `DebugServerSession` type with `{ server, url, stop }` — exposed via `onReady`
  callback on `startDebugServer`
- `onReady` option on `startDebugServer` — runs after HTTP listening begins,
  before browser launch
- `openBrowser` option on `startDebugServer` — defaults to `true`; set `false`
  for headless/embedded usage
- Concurrent-call guard on `startDebugServer` — rejects if another instance is
  already running
- `Server.stop()` idempotency — cached promise, safe to call multiple times
- `startDebugServer` now supports Node.js alongside Deno
- `createBuildContext` now supports Node.js alongside Deno

### Changed

- Sync Bloom filter FPR cap lowered from `0.5` to `0.001` for normal-accuracy
  sync, reducing unnecessary resync rounds during peer-to-peer commit exchange
  (low-accuracy path retains `0.5`)
- Auth concurrency captured once at `Repository` construction, preventing a
  potential race between pool sizing and batch slicing in `verifyCommits`
- Homepage redesigned with new hero, logo, and quick-start component
- Benchmark suite overhauled; documentation updated
- Test runner uses `NoMatchError` (exit code 2) instead of string-matching for
  no-match filter failures
- Docs upgraded to Docusaurus 3.10 with `@docusaurus/faster` for SWC-based
  builds
- CSS bundling documented in dedicated [CSS and esbuild](/docs/css-esbuild)
  guide
- Build failure severity during watch-mode rebuilds downgraded from `ERROR` to
  `WARNING` — transient build failures in development are not application errors

- `Server.start()` now awaits a prior `stop()` promise and checks `_stopping`
  flag for clean start/stop race handling
- `Server.stop()` uses promise caching for idempotency and handles early-exit
  cleanup when services are initialized without an HTTP listener

## [0.5.1] - 2026-03-05

### Breaking Changes

- **`./init` sub-path export removed.** `deno run -A jsr:@goatdb/goatdb/init` no
  longer works.

  **Migration:**
  ```bash
  # Before
  deno run -A jsr:@goatdb/goatdb/init

  # After (Deno)
  deno run -A jsr:@goatdb/goatdb init

  # After (Node.js)
  npx -y @goatdb/goatdb init
  ```

### Changed

- npm build output uses `.js` extension instead of `.mjs`
- `@types/node` bumped from ^22 to ^24
- `postject` bundled as optional dependency — no more global install required
- esbuild target updated from `node18` to `node24`
- `goatdb` CLI binary now available via npm (`npx -y @goatdb/goatdb init`)

## [0.4.0] - 2026-02-20

### Breaking Changes

- **Build tools moved from `@goatdb/goatdb/server`**: `compile`,
  `startDebugServer`, and `AppConfig` moved to `@goatdb/goatdb/server/build`.
  Runtime exports (`Server`, `createHttpServer`, etc.) remain in
  `@goatdb/goatdb/server`.

  **Migration:**
  ```typescript
  // Before
  import { compile, Server, startDebugServer } from '@goatdb/goatdb/server';

  // After
  import { Server } from '@goatdb/goatdb/server';
  import { compile, startDebugServer } from '@goatdb/goatdb/server/build';
  ```

### Security

- Fixed two vulnerabilities in `persistCommits`: null namespace guard and
  delta-based record bypass

### Added

- `GoatDB.sync(repo)` and `GoatDB.syncAll()` for explicit sync control
- `GoatDB.mode` property to query the current operation mode
- Client mode for non-browser environments (Deno, Node.js)
- `StderrLogStream` for logging to stderr
- `getGlobalLoggerStreams()` for log stream management
- Loading status exposed on `ManagedItem`
- `itemPathIsValid()` exported as a public utility
- `getEnvVar` exported as stable cross-runtime API
- `setup` callback in `DebugServerOptions` for configuring server-side logic
  during development
- Health check endpoint on `Server`
- `port` and `address` getters on `Server`; graceful shutdown support
- Node.js Single Executable Application (SEA) compilation via `compile()`
- `jsr:@goatdb/goatdb/link` now works in Node.js in addition to Deno
- HTTPS support with automatic self-signed certificate generation for secure
  development

### Changed

- Runtime abstraction layer refactored for cross-platform compatibility (Deno,
  Node.js, Browser)
- Path utilities moved to `base/path.ts` with POSIX-style handling across all
  environments
- Windows path support — backslashes from `Deno.cwd()`/`process.cwd()` are
  normalized to forward slashes
- `FileImpl` interface extended with `exists`, `copyFile`, and `readDir` methods
- CLI `init` templates externalized to `cli/templates/` directory
- CLI commands (`init`, `link`) now work in Node.js
- Build info and platform detection now work on Windows
- Node.js minimum version raised to 24 (required for SEA support)
- Node.js is now production-ready; experimental warning removed
- esbuild bumped from 0.24 to 0.25.4
- Browser `getOS()` uses 3-tier detection (User-Agent Client Hints,
  `navigator.platform`, User-Agent string) and returns `'unknown'` when platform
  cannot be detected
- Default server port for HTTPS changed to 8443 (HTTP remains 8080)
- `ManagedItem.commit()` now ensures all changes are fully committed before
  returning

### Removed

- `@std/fs` dependency (replaced by cross-runtime file abstraction)
- `@std/expect` dependency (fixes test compatibility on Node.js)

### Fixed

- Expired sessions are now blocked from accessing protected routes
- First sync awaited when opening a repository for the first time
- Query scan now correctly awaited in browser environments
- Resource leak in OPFS `copyFile()` — file handles now properly closed on error
- Template `DomainConfig` used incorrect method names (`resolveOrg` instead of
  `mapToOrg`)
- Template HTML referenced raw `index.tsx` instead of built `/app.js`
- Sync engine: recursive `serverUrl` expansion, infinite loop, dangling promise,
  and sync-before-open bugs
- `FileImpl`: partial-read loop and resource cleanup on error
- No longer crashes when the cache file is missing
- Now throws an error when commit contents are missing instead of failing
  silently

## [0.3.1]

### Fixed

- Support for crypto on older Node.js versions has been improved #27
- Item not properly propagating schema field types
- Correctly propagate inspect flag to worker in node #27
- `GoatDB.close()` correctly flushes to disk and clears memory

### Changed

- Updated React dependency to 19.1.0

## [0.3.0]

### Added

- [Orderstamp](https://github.com/goatplatform/orderstamp-js) is now bundled and
  exposed directly within GoatDB

## [0.2.2]

### Added

- An exception is now thrown when passing an invalid source path to a query
- Added `SchemaField<T>` for easy access to a schema's field names

### Fixed

- `itemPathNormalize` sometimes returns relative paths

### Changed

- Renamed `SchemaManager` to `DataRegistry`
- Renamed `DBConfig` to `DBInstanceConfig`

## [0.2.1]

### Added

- `FieldDef.validate` enables custom field level validation
- Before/After hooks for integrating with external build steps via
  `LiveReloadOptions.beforeBuild` and `LiveReloadOptions.afterBuild`
- `CoreTypes` are now exported by the top level `mod.ts`
- It's now possible to set a custom user schema via `SchemaManager.userSchema`
- Attempting to commit an item with invalid data now throws with a detailed
  message when running in debug mode

### Fixed

- Live reload in debug server is now working again
- Set types being deserialized incorrectly
- Crash in `useItem` React hook when first passing `undefined` then a
  `ManagedItem` instance

## [0.2.0]

### Added

- Initial support for Node.js
- Trusted mode which disables security mechanisms for increased performance in
  trusted environments

### Changed

- Auth rules now accept an info object like query predicate and sort descriptor
- Added default auth rules for `/user/<userId>`
- Improved repository open performance by ~25%

### Fixed

- Attempting to register multiple auth rules throws an error
- Crash when opening a query without a sort descriptor
- `db.flush` now properly flushes query caches to disk

### Removed

- Order stamps have been moved to their own repository —
  https://github.com/goatplatform/orderstamp-js

## [0.1.6] - 2025-02-26

### Added

- `FileImpl.getCWD` to get the current working directory
- `cli/link.ts` now enables easy development of GoatDB alongside an existing
  project

### Fixed

- Debug server now correctly turns on debug mode

## [0.1.3] - 2025-02-17

### Added

- `BaseTimer.reset` to reset the timer and reschedule it

### Changed

- GoatDB is now licensed under Apache 2.0
- `JSONLogFile.append` now automatically scans the log file rather than throw
- `JSONLogFile` worker now uses the transpiled JS version both for the server
  and the browser
- Improved React SPA scaffold
- `ServerOptions.domain` enables fine control over domain / organization mapping

### Fixed

- Configuration is now correctly injected into the app bundle

## [0.1.2] - 2025-02-16

### Added

- `Item.isNull` to check if an item has a null schema
- It's now possible to override the authorization rules for `/sys/users` and
  `/sys/*`
- `Query.sortDescending` to sort results in descending order

### Changed

- `Item.get` now returns `undefined` for null items

### Fixed

- Init script calling `manager.register()` instead of `manager.registerSchema()`
- `Item.isNull` now works as expected

## [0.1.1] - 2025-02-15

### Added

- `ServerOptions.autoCreateUser` for environment-specific user creation

### Changed

- Updated LLM cheatsheet

### Removed

- Operator Emails

## [0.1.0] - 2025-02-13

### Added

- Initial release

[Unreleased]: https://github.com/goatplatform/goatdb/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/goatplatform/goatdb/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/goatplatform/goatdb/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/goatplatform/goatdb/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/goatplatform/goatdb/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/goatplatform/goatdb/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/goatplatform/goatdb/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/goatplatform/goatdb/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/goatplatform/goatdb/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/goatplatform/goatdb/compare/v0.1.3...v0.1.6
[0.1.3]: https://github.com/goatplatform/goatdb/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/goatplatform/goatdb/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/goatplatform/goatdb/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/goatplatform/goatdb/releases/tag/v0.1.0
