# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

### Added

- Node.js Single Executable Application (SEA) compilation support via
  `compile()`

### Changed

- Runtime abstraction layer refactored for cross-platform compatibility (Deno,
  Node.js, Browser)
- Path utilities moved to `base/path.ts` with POSIX-style handling across all
  environments
- Windows path support added - backslashes from `Deno.cwd()`/`process.cwd()` are
  normalized to forward slashes
- FileImpl interface extended with `exists`, `copyFile`, and `readDir` methods
- CLI init templates externalized to `cli/templates/` directory
- Node.js engine minimum bumped from 18 to 20 (required for SEA support)
- esbuild bumped from 0.24 to 0.25.4
- Browser `getOS()` uses 3-tier detection (User-Agent Client Hints,
  navigator.platform, User-Agent string) and returns `'unknown'` when platform
  cannot be detected
- Default server port for HTTPS changed to 8443 (HTTP remains 8080)

### Removed

- `@std/fs` dependency (replaced by cross-runtime file abstraction)

### Fixed

- Fixed resource leak in OPFS `copyFile()` - file handles now properly closed on
  error
- Fixed template `DomainConfig` to use correct method names (`resolveOrg`
  instead of `mapToOrg`)
- Fixed template HTML to reference built `/app.js` instead of raw `index.tsx`
