# Changelog

All notable changes to GoatDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and GoatDB adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0 compatibility notice:** GoatDB is still pre-1.0. Backward
> compatibility is not guaranteed between releases; APIs, storage formats, and
> behavior may change without notice.

## [Unreleased]

### Known Quirks

The following behaviors are intentional artifacts of the current implementation
and are pinned by characterization tests:

- **iterableFilter is not applied during ref collection.** The Object branch
  drops options when recursing, so the filter never runs during ref collection.
  The filter is re-applied during final JSON encode, which can produce
  counterintuitive `__r`/`__d` wrappers. Pinned intentionally; see
  TODO(#58-followup) in `base/core-types/type-ops.ts`. Tests:
  `refs matrix: array iterableFilter is not applied during ref collection`,
  `refs matrix: set iterableFilter is not applied during ref collection`.

### Breaking Changes

- **Unified `Date` wire format and redefined commit checksum.** Dates in typed
  fields now encode as `{ "__t": "D", "__v": <epoch-seconds> }` instead of a
  bare number, and a `Date` is tagged uniformly in every checksum position (a
  typed date-field checksum changes from `416277608` to `1391363808`). A store
  written by an earlier version is rejected on open with a clear "older GoatDB"
  error instead of silently mis-decoding or marking every commit as corrupted.
  Back up the store before deleting or re-syncing it. Mixed-version fleets are
  unsupported.
- **Legacy rich-text refs are rejected.** Documents containing legacy ref nodes
  (`RefMarker` leaves or `RefNode` elements, e.g. `{ "tagName": "ref" }` or
  `{ "ref": "...", "type": "..." }`) now throw on read, normalize, and serialize
  instead of being silently stripped. The affected document is unreadable until
  it is migrated or removed. Back up the store first, then open the data with a
  release that still supports legacy refs to migrate it, or delete and re-sync
  only that data from a peer.
- `coreValueHash` alias removed. Use `encodableValueHash`.
- Mixed-version sync unsupported. Bare-number dates from old peers throw on
  typed-field deserialize and the commit is skipped. Epoch guards protect local
  store only.
- Checksum limit: a non-`typeSafe` string can collide with a tagged `Date` (e.g.
  `"41700000000"`). Use `typeSafe` checksums where untrusted input matters.
- Stray ref marker: a sole-key `{ "__rId": <number> }` object outside a
  `__r`/`__d` wrapper now throws at decode instead of passing through as user
  data. Wider objects containing `__rId` among other keys are unaffected.
- Clone aliasing: `coreValueClone`/`coreObjectClone` now preserve shared-ref
  aliasing across array/set siblings (they previously produced distinct copies).
  Alias identity within an object's fields was already preserved.

### Added

- `DBInstanceConfig.repoInactivityTimeoutMs` and `queryInactivityTimeoutMs`
  auto-close idle repositories and queries. Both default to `0` (disabled). A
  repository closes only when it has no in-flight leases, no external
  `DocumentChanged` listeners, and no open dependent queries; `/sys/`
  repositories are exempt.
- Query loading is lazy: `db.query()` no longer starts a scan. Loading begins on
  the first subscription (`onResultsChanged`), `onLoadingFinished`, or
  `loadingFinished()`; reads (`results()`, `has()`, ...) are side-effect free
  and do not start loading. A fresh unobserved query reports `loading === false`
  and, when `queryInactivityTimeoutMs` is set, is eligible for auto-close. A
  closed query is replaced by calling `db.query()` again.
- `compile()` now resolves to the path of the compiled executable
  (`Promise<string>`). Callers that ignore the value need no change.

### Changed

- `GOATDB_TEST_TIMEOUT_MS` now sets the whole-worker timeout and is validated
  strictly: non-integer values and values outside `1` to `2147483647` abort the
  run with an explicit error instead of silently using the 5-minute default.
  Workers send a heartbeat every 10 seconds, and a timeout reports the active
  suite and test, the test's elapsed time and the last heartbeat age.

### Fixed

- `deno compile` output names now include `.exe` for Windows targets, so
  `compile()` returns and logs the path that the compiler actually writes.
- The test runner no longer stops at the first failing runtime. Deno, Node and
  browser results are all collected, and the process exits non-zero with the
  combined failures.

### Breaking Changes

- `HttpServerInstance.stop()` and `Server.stop()` now return `Promise<void>`
  and must be awaited. The promise resolves only after the listener is closed
  and the port is free. A caller that ignores it can return before in-flight
  requests finish, and a restart can fail to bind the port.

### Changed

- `stop()` is graceful by default: in-flight requests and responses finish,
  new requests receive `503 Service Unavailable` with `connection: close`, and
  the listener closes when the drain ends. `force: true` closes immediately
  and `timeoutMs` bounds the drain (default 10s, an integer from 0 to
  2147483647; other values reject and leave the server running). Neither
  cancels application handlers.
- HTTP health checks from the `awsalb` host now accept `http` and `https`
  URLs on any port and ignore the query string; the path must be exactly
  `/healthy`. The comparison is now case-sensitive, so a mixed-case probe such
  as `/HEALTHY` returns 404; the `/healthy` endpoint itself still matches
  case-insensitively. Keep ALB health-check paths lowercase.

### Fixed

- A `Date` inside a `map` field now uses the tagged
  `{ "__t": "D", "__v": <epoch-seconds> }` wire form, the same as every other
  position. It was copied raw before, so it round-tripped as an ISO string while
  its checksum tagged it as a `Date`, marking the delta commit as corrupted on
  reload. Commits written by earlier builds with such values stay corrupted and
  must be re-created.
- `coreValueEquals` is now symmetric for objects when `objectFilterFields`
  inspects the object; previously the second comparison loop passed the wrong
  object to the filter.
- A server `stop()` that races an in-flight `start()` now waits for that start
  to settle before closing the listener, instead of returning early and
  leaving a bound server behind. A `start()` after a failed teardown retries
  cleanly, and a later `force` stop interrupts an in-progress drain even when
  the stop is queued behind a restart. Drain-then-close ordering is unchanged,
  and force or timeout still never cancel application handlers.

## [0.6.1] - 2026-09-01

### Fixed

- Republish 0.6.0 as 0.6.1: npm prohibits re-publishing an unpublished version
  (tombstone retention in registry `time` metadata), so 0.6.1 supersedes with
  identical code.

## [0.6.0] - 2026-08-30

### Breaking Changes

- **Binary `.goat` storage format**: Commits are now stored in a compact binary
  format (magic byte `0x47 'G'`, little-endian commit fields, big-endian 4-byte
  length framing). Both `.jsonl` and binary storage are supported, with the
  format selected through `DBInstanceConfig.storageFormat`. Tooling that reads
  `.goat` files directly requires manual migration.

- **Bloom-filter ancestors replaced with explicit string arrays**: The `af` and
  `ac` commit fields are no longer written or read. Existing commits using
  Bloom-filter ancestry load with empty ancestor arrays and rebuild their
  ancestry through new merge commits.

- **Strict `.goat` binary records**: Non-binary records in `.goat` files are
  rejected instead of being silently loaded. Mixed JSON/binary files require
  manual migration.

- **Ed25519 signing replaces ECDSA P-384**: Existing ECDSA-signed commits cannot
  be verified after upgrading and require a fresh trust pool.

- **Query cache identity changed**: Query IDs now use Murmur3 and account for
  relevant options and normalized source paths. Persisted caches from earlier
  versions may miss and be rebuilt lazily.

- **Query live updates are enabled by default**: Queries now receive uncommitted
  updates from `set()`. Set `liveUpdates: false` to retain commit-only behavior.

- **Public API changes**: The optional `session` parameter was removed from
  `Repository.leavesForKey()`, and `commitIsHighProbabilityLeaf()` was renamed
  to `commitIsLeaf()`.

- **Item path components are limited to 39 characters**: Type, repository, item,
  and embed path components longer than 39 characters are rejected.

### Added

- `GoatDB.insert()` for creating batches of new items without redundant ancestor
  computation.
- `liveUpdates` query configuration for selecting live or commit-only updates.
- `WriteFailure` events on `GoatDB` when a commit cannot be persisted.
- Shard configuration through `maxShardCommits`, `splitThreshold`, and
  `minShardCommits`, with read-only access through `GoatDB.shardConfig`.
- Public `AppConfig.esbuildPlugins` support for build customization.

### Changed

- CSS is bundled through esbuild during compile and debug builds, including
  plugin processing, hashed `url()` assets, and composed sourcemaps.
- The normal-accuracy sync Bloom-filter false-positive rate is capped at `0.001`
  to reduce unnecessary resynchronization rounds. The low-accuracy path retains
  its previous setting.
- Repository authentication concurrency is captured when the repository is
  created, preventing inconsistent verification batching.
- The homepage, benchmarks, and documentation have been overhauled.

### Fixed

- Conflict resolution now selects the closest available lowest common ancestor
  and defers merging when that ancestor is unavailable, avoiding destructive
  fallback merges.
- Query IDs no longer collide across relevant options or source paths, explicit
  empty IDs are preserved, stale aliases are avoided, and generated-ID caching
  is bounded.
- Query ordering and `find()` now handle dates, booleans, numbers, `NaN`, and
  near-equal values consistently.
- Locally created commits retain monotonic creation order when timestamps
  collide.
- `CoroutineQueue` now preserves FIFO ordering, runs a single worker, and
  recovers after task failures.
- Zero-byte writes now fail explicitly instead of retrying indefinitely.

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

## [0.5.0] - 2026-02-26

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

[Unreleased]: https://github.com/goatplatform/goatdb/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/goatplatform/goatdb/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/goatplatform/goatdb/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/goatplatform/goatdb/compare/v0.3.1...v0.5.0
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
