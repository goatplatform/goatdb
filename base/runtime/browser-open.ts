import type { OperatingSystem } from '../os.ts';

let _testBrowserOpenCommand:
  | ((
    os: OperatingSystem,
    url: string,
  ) => { cmd: string; args: string[] } | undefined)
  | undefined;

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
