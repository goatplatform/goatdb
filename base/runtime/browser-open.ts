import type { OperatingSystem } from '../os.ts';

const kControlCharacterPattern = /[\u0000-\u001F\u007F]/;

let _testBrowserOpenCommand:
  | ((
    os: OperatingSystem,
    url: string,
  ) => { cmd: string; args: string[] } | undefined)
  | undefined;

/** Returns true when a URL is safe to pass to the OS browser launcher. */
export function isBrowserOpenUrl(url: string): boolean {
  // Reject leading/trailing whitespace and control chars before URL parsing so
  // malformed raw inputs cannot be normalized into a launcher-visible URL.
  if (url !== url.trim() || kControlCharacterPattern.test(url)) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Returns a sanitized reason string for invalid browser-open inputs. */
export function invalidBrowserOpenUrlReason(url: string): string {
  if (url.length === 0) {
    return 'empty URL';
  }
  if (url !== url.trim()) {
    return 'surrounding whitespace';
  }
  if (kControlCharacterPattern.test(url)) {
    return 'control characters';
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) {
      return 'missing host';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `unsupported protocol ${parsed.protocol}`;
    }
  } catch {
    return 'invalid URL syntax';
  }
  return 'invalid URL';
}

/**
 * @internal Test-only scoped override for browser open command resolution.
 */
export async function withTestBrowserOpenCommand<T>(
  resolver: (
    os: OperatingSystem,
    url: string,
  ) => { cmd: string; args: string[] } | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = _testBrowserOpenCommand;
  _testBrowserOpenCommand = resolver;
  try {
    return await fn();
  } finally {
    _testBrowserOpenCommand = prev;
  }
}

/**
 * Resolves the OS-specific command and arguments to open a URL in the default
 * browser. The URL is always passed as a raw arg so shell parsing never sees
 * untrusted URL content. Windows uses `rundll32 url.dll,FileProtocolHandler`
 * instead of `cmd /c start` to avoid cmd-specific expansion rules.
 */
export function browserOpenCommand(
  os: OperatingSystem,
  url: string,
): { cmd: string; args: string[] } | undefined {
  // Only http/https URLs are safe to open via OS launchers.
  // Reject file:, javascript:, data:, etc. to prevent misuse.
  if (!isBrowserOpenUrl(url)) {
    return undefined;
  }
  if (_testBrowserOpenCommand) {
    return _testBrowserOpenCommand(os, url);
  }
  if (os === 'darwin') return { cmd: 'open', args: [url] };
  if (os === 'linux') return { cmd: 'xdg-open', args: [url] };
  if (os === 'windows') {
    return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  }
  return undefined;
}
