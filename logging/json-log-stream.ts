import type { LogEntry, LogStream } from './log.ts';
import {
  type JSONLogFile,
  JSONLogFileAppend,
  JSONLogFileOpen,
} from '../base/json-log/json-log.ts';

import type { NormalizedLogEntry } from './entry.ts';
import { randomInt } from '../base/math.ts';

/**
 * A LogStream implementation that writes log entries to a JSON file.
 * Supports optional throttling to reduce the number of entries written.
 */
export class JSONLogStream implements LogStream {
  /** Promise resolving to the underlying JSON log file */
  private readonly _log: Promise<JSONLogFile>;

  /**
   * Creates a new JSONLogStream
   * @param path Path to the JSON log file
   * @param throttleRate Optional throttling rate - only 1/throttleRate entries
   *                     will be written. Default is 1 (no throttling).
   */
  constructor(path: string, readonly throttleRate: number = 1) {
    this._log = JSONLogFileOpen(path, true);
  }

  /**
   * Appends a log entry to the JSON file, respecting the throttle rate
   * @param e The normalized log entry to append
   */
  async appendEntry(e: NormalizedLogEntry<LogEntry>): Promise<void> {
    if (this.throttleRate <= 1 || randomInt(0, this.throttleRate) === 0) {
      await JSONLogFileAppend(await this._log, [e]);
    }
  }
}
