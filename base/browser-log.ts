import { log, type LogEntry } from '../logging/log.ts';

/**
 * Some Playwright console event types only describe console grouping/clearing
 * and add noise without carrying durable diagnostic value.
 */
const kIgnoredBrowserConsoleTypes = new Set([
  'clear',
  'startGroup',
  'startGroupCollapsed',
  'endGroup',
]);

function browserConsoleMessage(type: string, text: string): string {
  const label = `[browser:${type}]`;
  return text ? `${label} ${text}` : label;
}

export type BrowserConsoleSeverity =
  | 'ERROR'
  | 'WARNING'
  | 'DEBUG'
  | 'INFO';

export function browserConsoleSeverity(type: string): BrowserConsoleSeverity {
  switch (type) {
    case 'error':
    case 'assert':
      return 'ERROR';

    case 'warning':
      return 'WARNING';

    // Diagnostic/instrumentation methods — useful for debugging but never
    // indicate a problem in test output.
    case 'debug':
    case 'trace':
    case 'dir':
    case 'dirxml':
    case 'profile':
    case 'profileEnd':
    case 'count':
    case 'timeEnd':
    case 'verbose':
      return 'DEBUG';

    default:
      return 'INFO';
  }
}

export function browserConsoleLogEntry(
  type: string,
  text: string,
): LogEntry | undefined {
  if (kIgnoredBrowserConsoleTypes.has(type)) {
    return undefined;
  }
  const message = browserConsoleMessage(type, text);
  const severity = browserConsoleSeverity(type);
  if (severity === 'ERROR') {
    return {
      severity,
      error: 'BrowserConsoleError',
      message,
    };
  }
  return { severity, message };
}

export function logBrowserConsole(type: string, text: string): void {
  const entry = browserConsoleLogEntry(type, text);
  if (entry) {
    log(entry);
  }
}

export function logBrowserPageError(err: {
  message?: string;
  stack?: string;
}): void {
  log({
    severity: 'ERROR',
    error: 'UncaughtClientError',
    message: err.message ?? 'Unknown browser page error',
    trace: err.stack,
  });
}
