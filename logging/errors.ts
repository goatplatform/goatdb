import type { JSONValue } from '../base/interfaces.ts';
import type { BaseLogEntry } from './entry.ts';
import type { EmailType } from './metrics.ts';

/**
 * A union type representing errors that occur due to developer mistakes or bugs.
 * These errors should never occur in production and indicate a code issue that
 * needs fixing.
 *
 * - NotImplemented: Used when a required feature is not yet implemented
 * - NotReached: Used when code execution reaches a path that should be
 *               impossible
 * - FailedAssertion: Used when an assertion check fails
 * - UncaughtServerError: Used for unhandled exceptions on the server
 * - MissingConfiguration: Used when required configuration options are missing
 */
export type DeveloperError =
  | 'NotImplemented'
  | 'NotReached'
  | 'FailedAssertion'
  | 'UncaughtServerError';

/**
 * Base interface for all error log entries. Extends BaseLogEntry with an
 * optional stack trace field.
 *
 * @property trace - Optional stack trace string from the error, if available
 */
export interface BaseErrorLogEntry extends BaseLogEntry {
  trace?: string;
}

/**
 * Interface for log entries that represent developer errors. Extends
 * with severity set to 'ERROR' and a developer error type.
 *
 * @property severity - The severity level of the log entry
 * @property error - The type of developer error that occurred
 */
export interface LogEntryDeveloperError extends BaseErrorLogEntry {
  severity: 'ERROR';
  error: DeveloperError;
}

/**
 * Union type for all operational errors that can occur in the system.
 *
 * - FetchError: Error occurred while fetching data
 * - SerializeError: Error occurred while serializing data
 * - BadRequest: Invalid request received from client
 * - UnknownCommand: Unknown command received from caller
 * - UnknownSyncError: Unknown error occurred during sync
 * - AttachmentRemovalFailed: Failed to remove attachment
 * - AttachmentDownloadFailed: Failed to download attachment
 * - DuplicateFailed: Failed to handle duplicate message
 * - SessionError: Error occurred while handling session
 * - EmailSendFailed: Failed to send email
 */
export type OperationalError =
  | 'FetchError'
  | 'SerializeError'
  | 'BadRequest'
  | 'UnknownCommand'
  | 'UnknownSyncError'
  | 'AttachmentRemovalFailed'
  | 'AttachmentDownloadFailed'
  | 'DuplicateFailed'
  | 'SessionError'
  | 'EmailSendFailed'
  | 'MissingConfiguration';

/**
 * Interface for log entries that represent operational errors. Extends
 * BaseErrorLogEntry with severity set to 'INFO' and an operational error type.
 *
 * @property severity - The severity level of the log entry, always 'INFO'
 * @property error - The type of operational error that occurred
 * @property url - Optional URL related to the error
 * @property key - Optional key identifier related to the error
 * @property valueType - Optional type of the value that caused the error
 * @property value - Optional JSON value related to the error
 * @property vertex - Optional vertex identifier related to the error
 * @property type - Optional email type for email-related errors
 */
export interface OperationalErrorLogEntry extends BaseErrorLogEntry {
  severity: 'INFO' | 'ERROR' | 'WARNING';
  error: OperationalError;
  url?: string;
  key?: string;
  valueType?: string;
  value?: JSONValue;
  vertex?: string;
  type?: EmailType;
}

/**
 * Union type for all system-level errors that can occur.
 *
 * - BackupWriteFailed: Error occurred while writing backup data
 * - IncompatibleVersion: Version mismatch between components
 * - LoggerWriteFailed: Error occurred while writing to logs
 */
export type SystemError =
  | 'BackupWriteFailed'
  | 'IncompatibleVersion'
  | 'LoggerWriteFailed';

/**
 * Interface for log entries that represent system-level errors. Extends
 * BaseErrorLogEntry with severity set to 'ERROR' and a system error type.
 *
 * @property severity - The severity level of the log entry, always 'ERROR'
 * @property error - The type of system error that occurred
 * @property commit - Optional commit hash related to the error
 * @property repo - Optional repository name related to the error
 * @property url - Optional URL related to the error
 * @property localVersion - Optional local version number
 * @property peerVersion - Optional peer version number
 */
export interface SystemErrorLogEntry extends BaseErrorLogEntry {
  severity: 'ERROR';
  error: SystemError;
  commit?: string;
  repo?: string;
  url?: string;
  localVersion?: number;
  peerVersion?: number;
}
