# Changelog

All notable changes to GoatDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and GoatDB adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  `navigator.platform`, User-Agent string) and returns `'unknown'` when
  platform cannot be detected
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
- Resource leak in OPFS `copyFile()` — file handles now properly closed on
  error
- Template `DomainConfig` used incorrect method names (`resolveOrg` instead
  of `mapToOrg`)
- Template HTML referenced raw `index.tsx` instead of built `/app.js`
- Sync engine: recursive `serverUrl` expansion, infinite loop, dangling
  promise, and sync-before-open bugs
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
