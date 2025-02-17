import type { LogEntry, LogStream } from './log.ts';
import {
  type JSONLogFile,
  JSONLogFileAppend,
  JSONLogFileClose,
  JSONLogFileFlush,
  JSONLogFileOpen,
} from '../base/json-log/json-log.ts';

import type { NormalizedLogEntry } from './entry.ts';
import { randomInt } from '../base/math.ts';
import { SimpleTimer } from '../base/timer.ts';
import { kMinuteMs } from '../base/date.ts';

/**
 * A LogStream implementation that writes log entries to a JSON file.
 * Supports optional throttling to reduce the number of entries written.
 */
export class JSONLogStream implements LogStream {
  /** Promise resolving to the underlying JSON log file */
  private _log?: JSONLogFile;
  private _closeTimer: SimpleTimer;

  /**
   * Creates a new JSONLogStream
   * @param path Path to the JSON log file
   * @param throttleRate Optional throttling rate - only 1/throttleRate entries
   *                     will be written. Default is 1 (no throttling).
   */
  constructor(readonly path: string, readonly throttleRate: number = 1) {
    this._closeTimer = new SimpleTimer(
      kMinuteMs,
      false,
      () => this.close(),
      `JSONLogStream-${path}`,
    );
  }

  /**
   * Appends a log entry to the JSON file, respecting the throttle rate
   * @param e The normalized log entry to append
   */
  async appendEntry(e: NormalizedLogEntry<LogEntry>): Promise<void> {
    if (!this._log) {
      this._log = await JSONLogFileOpen(this.path, true);
    }
    if (this.throttleRate <= 1 || randomInt(0, this.throttleRate) === 0) {
      await JSONLogFileAppend(this._log, [e]);
    }
    this._closeTimer.reset();
  }

  /**
   * Closes the JSON log file if it's open. This is handled automatically by the
   * stream and there's no need to call it explicitly under normal operation.
   *
   * You may want to call this explicitly when:
   * - You need to ensure logs are flushed to disk immediately
   * - You're shutting down the application and want to clean up resources
   * - You want to release the file handle before the automatic timeout
   */
  async close(): Promise<void> {
    if (this._log) {
      await JSONLogFileFlush(this._log);
      await JSONLogFileClose(this._log);
      this._log = undefined;
    }
  }
}
