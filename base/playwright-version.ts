/**
 * Single source of truth for the Playwright version used across GoatDB's
 * test infrastructure.
 *
 * Must stay in sync with:
 *   - .github/workflows/test.yml (cache key, restore keys, install command)
 *
 * Update both locations together when upgrading Playwright.
 */
export const PLAYWRIGHT_VERSION = '1.60.0';
