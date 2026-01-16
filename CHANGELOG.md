# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Breaking Changes

- **`@goatdb/goatdb/server` submodule removed**: Server APIs are now exported from the main `@goatdb/goatdb` module.

  **Migration:**
  ```typescript
  // Before
  import { Server, startDebugServer, compile } from '@goatdb/goatdb/server';

  // After
  import { Server, startDebugServer, compile } from '@goatdb/goatdb';
  ```

### Changed

- Runtime abstraction layer refactored for cross-platform compatibility (Deno, Node.js, Browser)
- Path utilities moved to `base/path.ts` with POSIX-style handling across all environments
- Windows path support added - backslashes from `Deno.cwd()`/`process.cwd()` are normalized to forward slashes
- FileImpl interface extended with `exists`, `copyFile`, and `readDir` methods
- CLI init templates externalized to `cli/templates/` directory

### Fixed

- Fixed resource leak in OPFS `copyFile()` - file handles now properly closed on error
- Fixed template `DomainConfig` to use correct method names (`resolveOrg` instead of `mapToOrg`)
- Fixed template HTML to reference built `/app.js` instead of raw `index.tsx`
