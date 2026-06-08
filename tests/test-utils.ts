/**
 * Shared test utilities for GoatDB tests.
 *
 * Consolidates commonly-reimplemented helpers into one location.
 */
import type { LogEntry, LogStream } from '../logging/log.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';
import {
  getGlobalLoggerStreams,
  newLogger,
  setGlobalLoggerStreams,
} from '../logging/log.ts';
import { withTestCWD as _withTestCWD } from '../base/runtime/index.ts';

/**
 * Swaps in a capturing log stream for the duration of `fn`, then restores
 * the original streams. The captured array is passed to the callback.
 */
export function withLogCapture<T>(
  fn: (captured: NormalizedLogEntry<LogEntry>[]) => Promise<T>,
): Promise<T> {
  const captured: NormalizedLogEntry<LogEntry>[] = [];
  const prev = getGlobalLoggerStreams();
  setGlobalLoggerStreams([{
    appendEntry(e: NormalizedLogEntry<LogEntry>): void {
      captured.push(e);
    },
  }]);
  return fn(captured).finally(() => setGlobalLoggerStreams(prev));
}

/**
 * Creates a logger backed by a capturing log stream.
 * Returns the captured entries array and the logger.
 */
export function createCapturedLogger(): {
  captured: NormalizedLogEntry<LogEntry>[];
  logger: ReturnType<typeof newLogger>;
} {
  const captured: NormalizedLogEntry<LogEntry>[] = [];
  const stream: LogStream = {
    appendEntry(e): void {
      captured.push(e);
    },
  };
  return {
    captured,
    logger: newLogger([stream]),
  };
}

/**
 * @internal Temporarily overrides the effective CWD for the duration of fn.
 * Delegates to the scoped _testCWD mechanism in base/runtime/index.ts
 * instead of mutating the runtime adapter singleton.
 */
export function withTestCWD<T>(
  cwd: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  return _withTestCWD(cwd, () => Promise.resolve(fn()));
}
