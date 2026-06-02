import type { OperatingSystem } from '../os.ts';

/**
 * Resolves the OS-specific command and arguments to open a URL in the default
 * browser. The URL is passed as a raw arg (no shell on mac/linux) so spaces
 * and special chars are safe. On Windows, `cmd /c start` needs an empty
 * quoted title `""` as the first start arg (otherwise the first quoted arg
 * is eaten as the window title), then the raw URL follows unquoted.
 */
export function browserOpenCommand(
  os: OperatingSystem,
  url: string,
): { cmd: string; args: string[] } | undefined {
  if (os === 'darwin') return { cmd: 'open', args: [url] };
  if (os === 'linux') return { cmd: 'xdg-open', args: [url] };
  if (os === 'windows') return { cmd: 'cmd', args: ['/c', 'start', '""', url] };
  return undefined;
}
