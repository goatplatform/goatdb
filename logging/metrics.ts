import type { BaseLogEntry, NormalizedLogEntry, Severity } from './entry.ts';

/**
 * List of server-side metric names that can be logged.
 *
 * - PeerResponseTime: Time taken for a peer to respond to a request (ms)
 * - CommitsPersistTime: Time taken to persist commits to storage (ms)
 * - CommitsPersistCount: Number of commits persisted in a batch
 * - DeltaFormatSavings: Bytes saved by using delta format vs full content
 * - ServerStarted: Timestamp when server started
 * - HttpStatusCode: HTTP response status code
 * - IncompatibleProtocolVersion: Count of incompatible protocol version errors
 * - InternalServerError: Count of internal server errors
 * - EmailSent: Count of emails sent by type
 * - OperatorLogsQuery: Time taken to execute operator logs queries (ms)
 */
export const kServerMetricNames = [
  'PeerResponseTime',
  'CommitsPersistTime',
  'CommitsPersistCount',
  'DeltaFormatSavings',
  'ServerStarted',
  'HttpStatusCode',
  'IncompatibleProtocolVersion',
  'InternalServerError',
  'EmailSent',
  'OperatorLogsQuery',
] as const;

/**
 * List of client-side metric names that can be logged.
 *
 * - QueryFired: Count of search queries initiated by the user
 * - QueryCancelled: Count of search queries cancelled before completion
 * - QueryCompleted: Count of search queries that completed successfully
 * - FullTextIndexingTime: Time taken to index document text for search (ms)
 */
export const kClientMetricNames = [
  'QueryFired',
  'QueryCancelled',
  'QueryCompleted',
  'FullTextIndexingTime',
] as const;

/**
 * Combined list of all metric names that can be logged, including both
 * server-side and client-side metrics.
 */
export const kMetricNames = [...kServerMetricNames, ...kClientMetricNames];

export type ServerMetricName = (typeof kServerMetricNames)[number];
export type ClientMetricName = (typeof kClientMetricNames)[number];
export type MetricName = ServerMetricName | ClientMetricName;
export type MetricUnit = 'Count' | 'Bytes' | 'Milliseconds' | 'Percent';
export type MetricType = 'Count' | 'Gauge' | 'Histogram' | 'Summary';
export type HTTPMethod =
  | 'OPTIONS'
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'TRACE'
  | 'CONNECT'
  | 'PATCH';

export type MetricSeverity = Extract<Severity, 'METRIC' | 'ERROR'>;

export type EmailType = 'Login' | 'AnalyticsReport';

export interface BaseMetricLogEntry<T extends MetricSeverity = MetricSeverity>
  extends BaseLogEntry {
  severity: T;
  name: MetricName;
  value: number;
  unit: MetricUnit;
  help?: string; // Help message for users of this metric
  orgId?: string;
}

export type MetricLogWithURL<
  T extends BaseMetricLogEntry = BaseMetricLogEntry,
> = T & {
  url?: string;
  urls?: string[];
};

export type MetricLogWithHTTP<T extends MetricLogWithURL = MetricLogWithURL> =
  & T
  & {
    method?: HTTPMethod;
  };

export type MetricLogWithType<
  T extends string = string,
  BASE extends BaseMetricLogEntry = BaseMetricLogEntry,
> = BASE & {
  type?: T;
};

export type MetricLogWithError<
  T extends BaseMetricLogEntry = BaseMetricLogEntry,
> = T & {
  error?: string;
  trace?: string;
};

export type MetricLogWithQuery<
  T extends BaseMetricLogEntry = BaseMetricLogEntry,
> = T & {
  query: string;
  operator: string;
  session: string;
};

export type MetricLogWithPath<
  T extends BaseMetricLogEntry = BaseMetricLogEntry,
> = T & {
  path: string;
};

export type MetricLogEntryType<N extends MetricName> = N extends
  'PeerResponseTime' ? MetricLogWithURL
  : N extends 'HttpStatusCode' ? MetricLogWithHTTP
  : N extends 'InternalServerError' ?
      & Required<MetricLogWithError<BaseMetricLogEntry<'ERROR'>>>
      & MetricLogWithHTTP<BaseMetricLogEntry<'ERROR'>>
  : N extends 'EmailSent' ? MetricLogWithType<EmailType>
  : N extends 'OperatorLogsQuery' ? MetricLogWithQuery<MetricLogWithError>
  : N extends 'DBError' ? MetricLogWithPath
  : N extends 'CommitsPersistTime' | 'CommitsPersistCount' ? MetricLogWithPath
  : BaseMetricLogEntry;

export type MetricLogEntry = MetricLogEntryType<`${MetricName}`>;

export function logEntryIsMetric(
  entry: NormalizedLogEntry<BaseLogEntry>,
): entry is NormalizedLogEntry<MetricLogEntry> {
  if (
    (entry.severity !== 'METRIC' && entry.severity !== 'ERROR') ||
    typeof entry.name !== 'string'
  ) {
    return false;
  }
  return (kMetricNames as readonly string[]).includes(entry.name);
}

export function isClientMetric(m: MetricLogEntry): boolean {
  return (kClientMetricNames as readonly string[]).includes(m.name);
}

export function isServerMetric(m: MetricLogEntry): boolean {
  return (kServerMetricNames as readonly string[]).includes(m.name);
}

export function isMetricWithURL(m: MetricLogEntry): m is MetricLogWithURL {
  return (
    typeof m.url === 'string' ||
    (m.urls instanceof Array &&
      m.urls.length > 0 &&
      typeof m.urls[0] === 'string')
  );
}
