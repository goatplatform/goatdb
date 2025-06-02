import {
  type NormalizedLogEntry,
  type Severity,
  SeverityFromCode,
} from './entry.ts';
import type { LogEntry, LogStream } from './log.ts';

/**
 * A LogStream implementation that writes log entries to the console.
 * Different severity levels are mapped to different console methods.
 */
export class ConsoleLogStream implements LogStream {
  /** The minimum severity level to log */
  severity: Severity;

  /**
   * Creates a new ConsoleLogStream
   * @param severity The minimum severity level to log. Can be provided as a
   *                Severity string or numeric code. Defaults to 'DEFAULT'.
   */
  constructor(severity: Severity | number = 'DEFAULT') {
    this.severity = typeof severity === 'number'
      ? SeverityFromCode(severity)
      : severity;
  }

  /**
   * Appends a log entry to the console
   * @param e The normalized log entry to append
   */
  appendEntry(e: NormalizedLogEntry<LogEntry>): void {
    let textLog = `[${new Date(e.timestamp).toISOString()}] `;
    if (typeof e.message === 'string') {
      textLog += e.message + ': ';
    }
    textLog += JSON.stringify(e, null, 2);
    switch (e.severity as Severity) {
      case 'EMERGENCY':
      case 'ALERT':
      case 'CRITICAL':
      case 'ERROR':
        console.error(textLog);
        break;

      case 'WARNING':
      case 'NOTICE':
        console.warn(textLog);
        break;

      case 'INFO':
      case 'DEFAULT':
        console.log(textLog);
        break;

      case 'DEBUG':
      case 'METRIC':
      case 'EVENT':
        console.debug(textLog);
        break;
    }
  }
}

/**
 * A LogStream implementation that writes log entries to stderr for all severities.
 * This is intended for use in testing only, to ensure logs do not interfere with stdout output.
 */
export class StderrLogStream implements LogStream {
  /**
   * Appends a log entry to stderr (console.error) for all severities.
   * @param e The normalized log entry to append
   */
  appendEntry(e: NormalizedLogEntry<LogEntry>): void {
    let textLog = `[${new Date(e.timestamp).toISOString()}] `;
    if (typeof e.message === 'string') {
      textLog += e.message + ': ';
    }
    textLog += JSON.stringify(e, null, 2);
    console.error(textLog);
  }
}
