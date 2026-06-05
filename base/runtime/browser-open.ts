import type { OperatingSystem } from '../os.ts';

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
  if (os === 'darwin') return { cmd: 'open', args: [url] };
  if (os === 'linux') return { cmd: 'xdg-open', args: [url] };
  if (os === 'windows') {
    return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  }
  return undefined;
}
