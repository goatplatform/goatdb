/**
 * TypeScript definitions for SQLite WASM Worker1 Promiser API
 * Based on official SQLite WASM documentation: https://sqlite.org/wasm/doc/trunk/api-worker1.md
 */

// Global type for the sqlite3Worker1Promiser function
declare global {
  interface Window {
    sqlite3Worker1Promiser: Sqlite3Worker1PromiserFactory;
  }
}

// Configuration for the promiser factory
export interface Sqlite3Worker1PromiserConfig {
  onready?: () => void;
  worker?: Worker | (() => Worker);
  generateMessageId?: (messageObject: unknown) => string;
  debug?: (...args: unknown[]) => void;
  onunhandled?: (event: MessageEvent) => void;
  onerror?: (...args: unknown[]) => void;
}

// Database identifier type
export type DbId = string | undefined;

// SQLite version information
export interface SqliteVersion {
  libVersion: string;
  sourceId: string;
  libVersionNumber: number;
  downloadVersion: number;
}

// Configuration result from config-get
export interface ConfigGetResult {
  version: SqliteVersion;
  bigIntEnabled: boolean;
  opfsEnabled: boolean;
  vfsList: string[];
}

// Open database arguments
export interface OpenArgs {
  filename?: string;
  vfs?: string;
}

// Open database result
export interface OpenResult {
  filename: string;
  dbId: DbId;
  persistent: boolean;
  vfs: string;
}

// Close database arguments
export interface CloseArgs {
  unlink?: boolean;
}

// Close database result
export interface CloseResult {
  filename: string | undefined;
}

// Exec SQL arguments
export interface ExecArgs {
  sql: string;
  dbId?: DbId;
  bind?: unknown[];
  returnValue?: string;
  rowMode?: 'object' | 'array';
  countChanges?: boolean;
}

// Exec SQL result
export interface ExecResult {
  dbId: DbId;
  sql: string;
  bind: unknown[];
  returnValue: string;
  resultRows?: unknown[][];
  changeCount?: number;
}

// Export database result
export interface ExportResult {
  byteArray: Uint8Array;
  filename: string;
  mimetype: string;
}

// Worker message types
export type WorkerMessageType =
  | 'open'
  | 'close'
  | 'exec'
  | 'config-get'
  | 'export';

// Base worker message envelope
export interface WorkerMessageEnvelope {
  type: WorkerMessageType;
  messageId?: string;
  dbId?: DbId;
  args?: unknown;
}

// Worker response base
export interface WorkerResponseBase {
  type: WorkerMessageType | 'error';
  messageId?: string;
  dbId?: DbId;
}

// Success response
export interface WorkerResponseSuccess<T extends WorkerMessageType>
  extends WorkerResponseBase {
  type: T;
  result: T extends 'open' ? OpenResult
    : T extends 'close' ? CloseResult
    : T extends 'exec' ? ExecResult
    : T extends 'config-get' ? ConfigGetResult
    : T extends 'export' ? ExportResult
    : never;
}

// Error response
export interface WorkerResponseError extends WorkerResponseBase {
  type: 'error';
  result: {
    operation: string;
    message: string;
    errorClass: string;
    input: object;
    stack: unknown[];
  };
}

// Union type for all worker responses
export type WorkerResponse<T extends WorkerMessageType> =
  | WorkerResponseSuccess<T>
  | WorkerResponseError;

// Promiser function type
export type Promiser = <T extends WorkerMessageType>(
  messageType: T,
  messageArguments?: T extends 'open' ? OpenArgs
    : T extends 'close' ? CloseArgs
    : T extends 'exec' ? ExecArgs
    : T extends 'config-get' ? Record<string, never>
    : T extends 'export' ? Record<string, never>
    : never,
) => Promise<WorkerResponse<T>>;

// Factory function type
export type Sqlite3Worker1PromiserFactory = (
  config?: Sqlite3Worker1PromiserConfig | (() => void),
) => Promiser;

// V2 promiser (ESM version)
export type Sqlite3Worker1PromiserV2Factory = (
  config?: Sqlite3Worker1PromiserConfig | (() => void),
) => Promise<Promiser>;

// Test item interface for the benchmark
export interface TestItem {
  id: string;
  title: string;
  count: number;
  tags: string;
}

// Database row result interface
export interface TestItemRow {
  id: string;
  title: string;
  count: number;
  tags: string;
}

// Count result interface
export interface CountResult {
  count: number;
}
