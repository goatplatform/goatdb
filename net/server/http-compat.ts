import { getRuntime } from '../../base/runtime/index.ts';
import { assert, notReached } from '../../base/error.ts';
import { log } from '../../logging/log.ts';

/**
 * A minimal interface for Node.js Buffer functionality used in this module.
 * This type represents just the subset of Buffer methods we need for
 * request body handling.
 */
export type MinimalBuffer = {
  /**
   * Concatenates an array of Uint8Array chunks into a single buffer
   * @param chunks Array of Uint8Array chunks to concatenate
   * @returns An object with a toString method to convert the buffer to a string
   */
  concat(
    chunks: Uint8Array[],
  ): {
    /**
     * Converts the buffer to a string
     * @param encoding The character encoding to use (defaults to 'utf8')
     * @param start The start position in the buffer
     * @param end The end position in the buffer
     * @returns The decoded string
     */
    toString(encoding?: string, start?: number, end?: number): string;
  };
};

let _nodeHttp: typeof import('node:http') | undefined;
let _nodeBufferModule: typeof import('node:buffer') | undefined;

/**
 * Gets a reference to the Node.js HTTP module implementation.
 *
 * This function lazily loads the HTTP module from node:http and caches it
 * for subsequent calls. It will throw an error if called outside of a Node.js
 * environment.
 *
 * @returns A promise that resolves to the HTTP module implementation
 * @throws {Error} If called outside of Node.js
 */
async function getNodeHttp() {
  if (!_nodeHttp) {
    _nodeHttp = await import('node:http');
  }
  return _nodeHttp;
}

/**
 * Gets a reference to the Node.js Buffer module implementation.
 *
 * This function lazily loads the Buffer module from node:buffer and caches it
 * for subsequent calls. It will throw an error if called outside of a Node.js
 * environment.
 *
 * @returns A promise that resolves to the Buffer module implementation
 * @throws {Error} If called outside of Node.js
 */
async function getNodeBufferModule() {
  if (!_nodeBufferModule) {
    _nodeBufferModule = await import('node:buffer');
  }
  return _nodeBufferModule;
}

/**
 * Gets a reference to the Node.js Buffer implementation.
 *
 * This function lazily loads the Buffer implementation from node:buffer
 * and caches it for subsequent calls. It will throw an error if called
 * outside of a Node.js environment.
 *
 * @returns A promise that resolves to the Buffer implementation
 * @throws {Error} If called outside of Node.js
 */
async function getBuffer(): Promise<MinimalBuffer> {
  assert(getRuntime().id === 'node', 'Buffer is only available in Node.js');
  // Use cached dynamic import
  const mod = await getNodeBufferModule();
  return mod.Buffer;
}

/**
 * Represents a Node.js HTTP/1.x request object.
 * This interface defines the minimal structure needed to handle HTTP/1.x
 * requests in Node.js environments.
 */
interface NodeHttp1Request {
  /** HTTP headers as a record of header names to their values */
  headers: Record<string, string | string[] | undefined>;
  /** The request URL (optional) */
  url?: string;
  /** The HTTP method (e.g. GET, POST, etc.) */
  method: string;
  /** Socket information (optional) */
  socket?: {
    /** Whether the connection is encrypted (HTTPS) */
    encrypted?: boolean;
  };
}

/**
 * Represents a Node.js HTTP/2 request object.
 * This interface defines the minimal structure needed to handle HTTP/2
 * requests in Node.js environments.
 */
interface NodeHttp2Request {
  /** HTTP headers as a record of header names to their values */
  headers: Record<string, string | string[] | undefined>;
  /** The request URL (optional) */
  url?: string;
  /** The HTTP method (e.g. GET, POST, etc.) */
  method: string;
}

/**
 * Type guard to check if a request object is a Node.js HTTP/2 request.
 *
 * @param req - The request object to check
 * @returns True if the request is a Node.js HTTP/2 request, false otherwise
 */
function isNodeHttp2Request(req: unknown): req is NodeHttp2Request {
  return (
    typeof req === 'object' && req !== null &&
    'headers' in req &&
    // deno-lint-ignore no-explicit-any
    typeof (req as any).headers === 'object' &&
    (
      // deno-lint-ignore no-explicit-any
      ':scheme' in (req as any).headers ||
      // deno-lint-ignore no-explicit-any
      ':authority' in (req as any).headers ||
      // deno-lint-ignore no-explicit-any
      ':path' in (req as any).headers
    )
  );
}

/**
 * Type guard to check if a request object is a Node.js HTTP/1.x request.
 *
 * @param req - The request object to check
 * @returns True if the request is a Node.js HTTP/1.x request, false otherwise
 */
function isNodeHttp1Request(req: unknown): req is NodeHttp1Request {
  return (
    typeof req === 'object' && req !== null &&
    'headers' in req &&
    // deno-lint-ignore no-explicit-any
    typeof (req as any).headers === 'object' &&
    'method' in req &&
    // deno-lint-ignore no-explicit-any
    typeof (req as any).method === 'string' &&
    !isNodeHttp2Request(req)
  );
}

/**
 * Type guard to check if a request object is a web standard Request.
 *
 * @param req - The request object to check
 * @returns True if the request is a web standard Request, false otherwise
 */
function isWebRequest(req: unknown): req is Request {
  return (
    typeof Request !== 'undefined' &&
    req instanceof Request
  );
}

/**
 * Union type representing the possible header implementations supported by
 * GoatRequest. This can be either the web standard Headers class or our
 * NodeHeadersPolyfill implementation for Node.js environments where the
 * web standard Headers is not available.
 *
 * @group HTTP
 */
export type GoatHeaders = Headers | NodeHeadersPolyfill;

/**
 * Creates a GoatHeaders instance with the appropriate implementation for the current runtime.
 *
 * @param init Optional headers initialization data
 * @returns A GoatHeaders instance (either Headers or NodeHeadersPolyfill)
 */
export function createGoatHeaders(init?: HeadersInit): GoatHeaders {
  if (typeof Headers !== 'undefined') {
    // Web standard Headers is available (Deno or modern Node.js)
    return new Headers(init);
  } else if (getRuntime().id === 'node') {
    // Node.js environment without Headers
    const headers = new NodeHeadersPolyfill();

    // Process initialization data if provided
    if (init) {
      if (init instanceof Map || init instanceof NodeHeadersPolyfill) {
        // Handle Map-like initialization
        for (const [key, value] of init.entries()) {
          headers.set(key, value);
        }
      } else if (Array.isArray(init)) {
        // Handle array of header entries
        for (const [key, value] of init) {
          headers.set(key, value);
        }
      } else {
        // Handle record/object initialization
        for (const [key, value] of Object.entries(init)) {
          headers.set(key, value);
        }
      }
    }

    return headers;
  } else {
    notReached('Unsupported runtime');
  }
}

/**
 * A polyfill implementation of the web standard Headers interface for Node.js
 * environments. This class extends Map<string, string> to provide a
 * standards-compliant Headers implementation that can be used interchangeably
 * with the web standard Headers class.
 *
 * Use the GoatHeaders type when you need to work with headers in a
 * cross-platform way:
 * ```typescript
 * function handleHeaders(headers: GoatHeaders) {
 *   // Works with both web standard Headers and NodeHeadersPolyfill
 *   headers.set('Content-Type', 'application/json');
 * }
 * ```
 */
export class NodeHeadersPolyfill extends Map<string, string> {
  /**
   * Appends a new value to an existing header or sets it if it doesn't exist.
   * This matches the behavior of the web standard Headers.append() method.
   *
   * @param k - The header name to append to
   * @param v - The value to append
   */
  append(k: string, v: string) {
    const existing = super.get(k);
    if (existing) {
      super.set(k, existing + ', ' + v);
    } else {
      super.set(k, v);
    }
  }

  /**
   * Returns the header value for the given name, or `null` if not set.
   * Matches the web standard `Headers.get()` return type (`string | null`),
   * which conflicts with `Map.get()` (`string | undefined`). The `any`
   * return type bridges this mismatch — all callers use truthy checks.
   */
  // deno-lint-ignore no-explicit-any
  override get(k: string): any {
    return super.get(k) ?? null;
  }

  /**
   * Sets a header value, overwriting any existing value.
   * This matches the behavior of the web standard Headers.set() method.
   *
   * @param k - The header name to set
   * @param v - The value to set
   * @returns This Headers object for method chaining
   */
  override set(k: string, v: string): this {
    super.set(k, v);
    return this;
  }
}

/**
 * Minimal Node.js IncomingMessage type for our usage
 */
export type MinimalNodeIncomingMessage = {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  method: string;
  socket?: {
    encrypted?: boolean;
    remoteAddress?: string;
  };
  // Node.js IncomingMessage is async iterable for body
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
};

/**
 * Minimal Node.js ServerResponse type for our usage
 */
export type MinimalNodeServerResponse = {
  statusCode: number;
  headersSent?: boolean;
  setHeader(key: string, value: string): void;
  write(chunk: Uint8Array | string): boolean;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  once?(event: string, listener: (...args: unknown[]) => void): void;
  end(chunk?: Uint8Array | string): void;
  destroy(error?: Error): void;
};

/**
 * A cross-platform request wrapper that provides a consistent interface for
 * handling HTTP requests across different runtimes (Deno, Node.js HTTP/1.1,
 * Node.js HTTP/2).
 *
 * This class normalizes the differences between:
 * - Deno/web standard Request
 * - Node.js HTTP/1.1 IncomingMessage
 * - Node.js HTTP/2 Http2ServerRequest
 *
 * It provides a web-standard interface with properties like url, method,
 * headers, and body, along with helper methods for common operations.
 * @group HTTP
 */
export class GoatRequest {
  /** The original request object from the runtime */
  private _native:
    | Request
    | NodeHttp1Request
    | NodeHttp2Request
    | MinimalNodeIncomingMessage;
  /** The normalized request URL including scheme, authority and path */
  public url!: string;
  /** The HTTP method (GET, POST, etc) */
  public method!: string;
  /** The request headers in web-standard Headers format */
  public headers!: GoatHeaders;
  /** The request body as a ReadableStream */
  public body!: ReadableStream<Uint8Array> | null;

  /**
   * Creates a new GoatRequest instance from a runtime-specific request object
   * @param req The original request object from Deno or Node.js
   * @throws Error if running in an unsupported runtime
   */
  constructor(
    req:
      | Request
      | NodeHttp1Request
      | NodeHttp2Request
      | MinimalNodeIncomingMessage,
  ) {
    if (isWebRequest(req)) {
      // Deno/web: just use the native Request
      this._native = req;
      this.url = req.url;
      this.method = req.method;
      this.headers = req.headers;
      this.body = req.body;
    } else if (getRuntime().id === 'node') {
      this._native = req;
      let scheme: string, authority: string, path: string;
      if (isNodeHttp2Request(req)) {
        // Node.js http2: wrap the http2.Http2ServerRequest
        const h = req.headers;
        scheme = (h[':scheme'] as string) || 'http';
        authority = (h[':authority'] as string) || (h['host'] as string) ||
          'localhost';
        path = (h[':path'] as string) || req.url || '/';
      } else if (isNodeHttp1Request(req)) {
        // Node.js http1: http.IncomingMessage
        const h = (req as NodeHttp1Request).headers;
        scheme = (req as NodeHttp1Request).socket &&
            (req as NodeHttp1Request).socket!.encrypted
          ? 'https'
          : 'http';
        authority = (h['host'] as string) || 'localhost';
        path = (req as NodeHttp1Request).url || '/';
      } else {
        notReached('Unknown Node.js request type');
      }
      this.url = `${scheme}://${authority}${path}`;
      this.method = typeof req.method === 'string' ? req.method : 'GET';
      let headers: GoatHeaders;
      if (typeof Headers !== 'undefined') {
        headers = new Headers();
      } else {
        headers = new NodeHeadersPolyfill();
      }
      const rawHeaders = req.headers && typeof req.headers === 'object'
        ? req.headers
        : {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (v !== undefined) {
          headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        }
      }
      this.headers = headers;
      // For both http1 and http2, the body is the request stream
      // Use MinimalNodeIncomingMessage for Node
      this.body = (req as MinimalNodeIncomingMessage)[Symbol.asyncIterator]
        ? req as unknown as ReadableStream<Uint8Array>
        : null;
    } else {
      throw new Error('Unsupported runtime for GoatRequest');
    }
  }

  /**
   * Reads and parses the request body as JSON
   * @returns The parsed JSON data
   */
  // deno-lint-ignore no-explicit-any
  async json(): Promise<any> {
    if (getRuntime().id !== 'node') {
      return (this._native as Request).json();
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.body!) {
        chunks.push(chunk);
      }
      const Buffer = await getBuffer();
      const buf = Buffer.concat(chunks).toString('utf8');
      return JSON.parse(buf);
    }
  }

  /**
   * Reads the request body as text
   * @returns The body content as a string
   */
  async text(): Promise<string> {
    if (getRuntime().id !== 'node') {
      return (this._native as Request).text();
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.body!) {
        chunks.push(chunk);
      }
      const Buffer = await getBuffer();
      return Buffer.concat(chunks).toString('utf8');
    }
  }

  /**
   * Gets the original request object from the runtime
   * @returns The native request object
   */
  get raw():
    | Request
    | NodeHttp1Request
    | NodeHttp2Request
    | MinimalNodeIncomingMessage {
    return this._native;
  }
}

// Unified address abstraction for all runtimes
export type HttpRemoteAddr = { hostname: string };

/**
 * Define a minimal local ServeHandlerInfo type for compatibility
 * Always uses the unified HttpRemoteAddr abstraction.
 * @group HTTP
 */
export type ServeHandlerInfo = {
  remoteAddr: HttpRemoteAddr;
  /** Settles when response delivery ends, including a client disconnect. */
  completed: Promise<void>;
};

/** Status sent for requests rejected while the server drains. */
export const SERVICE_UNAVAILABLE_STATUS = 503;
/** Body sent for requests rejected while the server drains. */
export const SERVICE_UNAVAILABLE_BODY = 'Service Unavailable';
/** Header telling clients not to reuse a socket that is about to close. */
export const SERVICE_UNAVAILABLE_CONNECTION = 'close';

/**
 * The one 503 used by every drain gate: the web handler path and the raw Node
 * response path. WHY shared: a client must not be able to tell which runtime
 * rejected the request.
 */
export function serviceUnavailableResponse(): Response {
  return new Response(SERVICE_UNAVAILABLE_BODY, {
    status: SERVICE_UNAVAILABLE_STATUS,
    headers: { connection: SERVICE_UNAVAILABLE_CONNECTION },
  });
}

/** Default graceful drain budget for {@link MinimalHttpServer.stop}. */
export const DEFAULT_STOP_TIMEOUT_MS = 10_000;

/** Options for {@link MinimalHttpServer.stop}. */
export interface HttpServerStopOptions {
  /**
   * Skip the drain and close open connections immediately. Use on process
   * termination paths where waiting is not an option. Does not cancel handlers.
   */
  readonly force?: boolean;
  /**
   * Drain budget, default 10s. Expiry closes connections, not app handlers.
   * Bounds the drain, not the final listener close.
   */
  readonly timeoutMs?: number;
}

/**
 * Tracks in-flight requests so stop() can drain them before closing sockets.
 *
 * WHY: neither runtime can force-close a listener after starting its native
 * graceful shutdown (Deno takes the server handle; Node's close() has no
 * abort). Draining first keeps the force fallback available on both runtimes.
 * New requests are rejected with 503 once stop begins, so a busy server still
 * reaches zero in-flight work.
 */
class RequestDrain {
  private _active = 0;
  private _accepting = true;
  private _forced = false;
  private readonly _waiters = new Set<(drained: boolean) => void>();

  get accepting(): boolean {
    return this._accepting;
  }

  get forced(): boolean {
    return this._forced;
  }

  async track<T>(
    completed: Promise<void>,
    handler: () => Promise<T>,
  ): Promise<T> {
    ++this._active;
    // Observe rejection immediately; disconnects must still wait for the handler.
    const responseDone = completed.then(() => {}, () => {});
    try {
      return await handler();
    } finally {
      // Capture this tracker so a restart cannot receive an old request's end.
      void responseDone.then(() => this.end());
    }
  }

  private end(): void {
    if (this._active === 0) return;
    --this._active;
    if (this._active > 0) return;
    for (const waiter of this._waiters) waiter(true);
  }

  stopAccepting(): void {
    this._accepting = false;
  }

  /** Escalates an in-flight graceful stop to the force path. */
  force(): void {
    this._forced = true;
    this._accepting = false;
    for (const waiter of this._waiters) waiter(false);
  }

  /** Resolves true when drained, false when the timeout expired first. */
  wait(timeoutMs: number): Promise<boolean> {
    if (this._active === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const finish = (drained: boolean) => {
        clearTimeout(timer);
        this._waiters.delete(finish);
        resolve(drained);
      };
      this._waiters.add(finish);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }
}

/** Logs a drain timeout. The caller still force-closes; this is not fatal. */
function logDrainTimeout(timeoutMs: number): void {
  log({
    severity: 'WARNING',
    error: 'StopTimeout',
    message: `HTTP server stop drain timed out after ${timeoutMs}ms; ` +
      'closing remaining connections',
  });
}

/** Closes the drain and waits for active requests within the time budget. */
async function beginDrain(
  drain: RequestDrain,
  options: HttpServerStopOptions,
): Promise<boolean> {
  drain.stopAccepting();
  const timeoutMs = options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const drained = options.force ? false : await drain.wait(timeoutMs);
  if (!options.force && !drained && !drain.forced) {
    logDrainTimeout(timeoutMs);
  }
  return drained;
}

/** Surfaces a rejected background stop instead of dropping the promise. */
export function logStopFailure(error: unknown): void {
  log({
    severity: 'ERROR',
    error: 'ServerStopFailed',
    message: `HTTP server stop failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
    trace: error instanceof Error ? error.stack : undefined,
  });
}

/**
 * Stops the server when `signal` aborts. Callers must handle a signal that is
 * already aborted before calling this: firing the stop synchronously would
 * queue it behind the start that is wiring it.
 */
function wireStopSignal(
  signal: AbortSignal | undefined,
  isCurrent: () => boolean,
  stop: () => Promise<void>,
): void {
  if (!signal) return;
  signal.addEventListener('abort', () => {
    // A restart may own the server now; ignore this signal for that listener.
    if (isCurrent()) void stop().catch(logStopFailure);
  }, { once: true });
}

/**
 * Awaits a previous teardown, then clears it. WHY: a start must not race the
 * old teardown. Clears even on rejection so the slot cannot stay poisoned; the
 * rejection still propagates to this caller.
 */
export async function awaitPendingStop(
  pending: Promise<void> | undefined,
  clear: () => void,
): Promise<void> {
  if (!pending) return;
  try {
    await pending;
  } finally {
    clear();
  }
}

/**
 * Clears a pending-stop slot when a teardown rejects, then rethrows. WHY: the
 * stop caller must see the failure, but a later start must be able to retry.
 */
export function clearPendingOnReject(
  pending: Promise<void>,
  clear: () => void,
): Promise<void> {
  return pending.catch((error) => {
    clear();
    throw error;
  });
}

/**
 * Interrupts an active drain when a force stop is queued behind a restart.
 *
 * WHY: the lifecycle gate defers a stop until the in-flight start settles, so
 * without this the force waits for the handler or the graceful budget. While a
 * teardown is pending, the drain field holds that teardown's drain: a start
 * clears the pending stop before it installs a new drain.
 */
function escalatePendingStop(
  pending: Promise<void> | undefined,
  drain: RequestDrain,
): void {
  if (pending) drain.force();
}

/**
 * FIFO lifecycle gate shared by the server classes.
 *
 * WHY: every start and stop must run alone, in call order. A stop() that
 * skipped ahead of a queued start would observe a not-yet-started server,
 * return early, and leave the caller believing the listener is closed while
 * the start goes on to bind it. Concurrent start() calls still share one bind,
 * because a second bind would only fail on the port.
 *
 * The first op of an idle gate runs synchronously, so callers observe the
 * state change (for example the cleared port) before stop() returns.
 */
export class StartStopGate {
  /** Non-rejecting tail of the queue. Undefined when no op is pending. */
  private _tail?: Promise<void>;
  /** Identifies the newest chain, so only it may clear the tail. */
  private _chain = 0;
  /** The in-flight start, shared by concurrent start() callers. */
  private _starting?: Promise<void>;

  /** Runs `start` once; concurrent callers share the in-flight promise. */
  start(start: () => Promise<void>): Promise<void> {
    const inFlight = this._starting;
    if (inFlight) return inFlight;
    const started = this._push(start);
    this._starting = started;
    const clear = () => {
      if (this._starting === started) this._starting = undefined;
    };
    void started.then(clear, clear);
    return started;
  }

  /** Runs `stop` after every earlier op settled, success or failure. */
  stop(stop: () => Promise<void>): Promise<void> {
    return this._push(stop);
  }

  /** Queues one op behind the current tail, or runs it now when idle. */
  private _push(op: () => Promise<void>): Promise<void> {
    const previous = this._tail;
    if (!previous) {
      let run: Promise<void>;
      try {
        run = op();
      } catch (error) {
        run = Promise.reject(error);
      }
      this._track(run);
      return run;
    }
    // WHY the rejection handler: a failed op must not block the ops behind it,
    // while its own caller must still see the failure.
    const run = previous.then(op, op);
    this._track(run);
    return run;
  }

  private _track(run: Promise<void>): void {
    // WHY released in the settle callback itself: the slot must read idle by
    // the time the op's own caller resumes, so its next stop() runs at once
    // instead of queuing a microtask behind an already finished chain.
    const chain = ++this._chain;
    this._tail = run.then(
      () => this._release(chain),
      () => this._release(chain),
    );
  }

  private _release(chain: number): void {
    // A later op may already own the slot; only the newest chain clears it.
    if (this._chain === chain) this._tail = undefined;
  }
}

/**
 * Minimal cross-platform HTTP server abstraction for GoatDB.
 *
 * This interface and implementation allow the server to be started and stopped
 * in a platform-agnostic way.
 */
export interface MinimalHttpServer {
  start(
    handler: (req: GoatRequest, info: ServeHandlerInfo) => Promise<Response>,
    port: number,
    signal?: AbortSignal,
  ): Promise<void>;
  /**
   * Stops the server. Idempotent; port and address read as undefined immediately.
   *
   * Default is graceful: the listener stays open while in-flight requests run,
   * new requests receive 503, and open connections close once the drain
   * finishes. Pass `force: true` to close immediately, or `timeoutMs` to bound
   * the drain. `timeoutMs` does not bound the final listener close. Repeated
   * calls share one teardown; a later `force` escalates only while the drain is
   * pending, while `timeoutMs` is fixed by the first call. A `force` interrupts
   * a pending drain even when the stop is queued behind a restart. Resolves
   * once the listener is closed. A stop() racing an in-flight start() resolves only
   * after that start settles and the listener is closed. Forced or timed-out
   * stops cannot cancel application handlers; these can continue after stop
   * resolves.
   */
  stop(options?: HttpServerStopOptions): Promise<void>;
  readonly port?: number;
  readonly address?: { hostname: string; port: number };
}

/**
 * Shared start/stop lifecycle for the runtime-specific servers.
 *
 * WHY: draining, stop idempotency, the 503 gate and signal wiring do not
 * depend on the runtime, so one owner keeps Deno and Node shutdown behavior
 * from drifting. The runtime differences stay behind three hooks: bind a
 * listener, close it, and report port/address from it.
 *
 * The listener handle is opaque here. Clearing it is what makes `port` and
 * `address` read undefined from the moment `stop()` starts.
 */
export abstract class BaseHttpServer<L> implements MinimalHttpServer {
  private _listener?: L;
  private _started = false;
  /** In-flight stop, so repeated stop() calls share one teardown. */
  private _stopPromise?: Promise<void>;
  private readonly _lifecycle = new StartStopGate();
  /** In-flight request tracker; replaced by each start. */
  protected _drain: RequestDrain = new RequestDrain();

  /** The bound listener, or undefined before start and from stop() onward. */
  protected get listener(): L | undefined {
    return this._listener;
  }

  start(
    handler: (req: GoatRequest, info: ServeHandlerInfo) => Promise<Response>,
    port: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return this._lifecycle.start(() => this._start(handler, port, signal));
  }

  stop(options: HttpServerStopOptions = {}): Promise<void> {
    // WHY: the lifecycle gate may queue this stop behind a restart, so force
    // must interrupt the active teardown now; the queued stop still closes the
    // restarted listener.
    if (options.force) escalatePendingStop(this._stopPromise, this._drain);
    return this._lifecycle.stop(() => this._requestStop(options));
  }

  private async _start(
    handler: (req: GoatRequest, info: ServeHandlerInfo) => Promise<Response>,
    port: number,
    signal?: AbortSignal,
  ): Promise<void> {
    // WHY: a restart must not bind the port while the old teardown still
    // drains requests and closes databases.
    await awaitPendingStop(this._stopPromise, () => {
      this._stopPromise = undefined;
    });
    if (this._started) return;
    this._drain = new RequestDrain();
    const listener = await this._bind(handler, port);
    this._listener = listener;
    this._started = true;
    // WHY: a signal that aborted before or during the bind must leave no
    // listener behind by the time start() resolves, so tear down inline
    // instead of queuing a stop behind this start.
    if (signal?.aborted) {
      await this._requestStop({});
      return;
    }
    wireStopSignal(
      signal,
      () => this._listener === listener,
      () => this.stop(),
    );
  }

  private _requestStop(options: HttpServerStopOptions): Promise<void> {
    const listener = this._listener;
    if (!listener) {
      // A later force must be able to escalate the active graceful teardown.
      if (options.force) this._drain.force();
      return this._stopPromise ?? Promise.resolve();
    }
    this._listener = undefined;
    this._started = false;
    // Capture the drain. A restart must not swap it under the active teardown.
    const drain = this._drain;
    const stopped = clearPendingOnReject(
      this._closeAfterDrain(listener, drain, options),
      () => {
        this._stopPromise = undefined;
      },
    );
    this._stopPromise = stopped;
    return stopped;
  }

  private async _closeAfterDrain(
    listener: L,
    drain: RequestDrain,
    options: HttpServerStopOptions,
  ): Promise<void> {
    const drained = await beginDrain(drain, options);
    await this._close(listener, options.force === true || !drained);
  }

  /** Binds a listener. Must reject on failure and leave nothing behind. */
  protected abstract _bind(
    handler: (req: GoatRequest, info: ServeHandlerInfo) => Promise<Response>,
    port: number,
  ): Promise<L>;

  /**
   * Closes the listener. `force` means the drain was skipped or timed out, so
   * live connections must be cut. Resolves once the port is released.
   */
  protected abstract _close(listener: L, force: boolean): Promise<void>;
}

/** A bound Deno listener and the controller that aborts its connections. */
type DenoListener = {
  readonly server: Deno.HttpServer;
  readonly controller: AbortController;
};

/**
 * Deno implementation of the MinimalHttpServer abstraction.
 */
export class DenoHttpServer extends BaseHttpServer<DenoListener> {
  private readonly _options: HttpServerOptions;

  constructor(options: HttpServerOptions = {}) {
    super();
    this._options = options;
  }

  protected async _bind(
    handler: (req: GoatRequest, info: ServeHandlerInfo) => Promise<Response>,
    port: number,
  ): Promise<DenoListener> {
    const controller = new AbortController();
    let onListen!: () => void;
    const listening = new Promise<void>((resolve) => {
      onListen = resolve;
    });
    // WHY no explicit Deno.ServeTcpOptions annotation: the npm build
    // type-checks against a minimal Deno stub that lacks that member.
    const serveOptions = {
      port,
      onListen,
      signal: controller.signal,
    };
    const onRequest = (req: Request, info: Deno.ServeHandlerInfo) => {
      if (!this._drain.accepting) {
        return Promise.resolve(serviceUnavailableResponse());
      }
      // Map Deno's info to the unified abstraction. remoteAddr is
      // NetAddr | UnixAddr; only the network variant has a hostname.
      const remoteAddr: HttpRemoteAddr = {
        hostname: 'hostname' in info.remoteAddr
          ? info.remoteAddr.hostname
          : 'localhost',
      };
      return this._drain.track(
        info.completed,
        () =>
          handler(new GoatRequest(req), {
            remoteAddr,
            completed: info.completed,
          }),
      );
    };

    const server = this._options.https
      ? Deno.serve({ ...serveOptions, ...this._options.https }, onRequest)
      : Deno.serve(serveOptions, onRequest);
    try {
      // WHY: a failed bind (for example a port already in use) never calls
      // onListen and surfaces only by rejecting `finished`. Without this race
      // start() would hang instead of reporting the failure.
      await Promise.race([
        listening,
        server.finished.then(() => {
          throw new Error('HTTP server closed before it started listening');
        }),
      ]);
    } catch (error) {
      await server.shutdown().catch(() => {});
      throw error;
    }
    return { server, controller };
  }

  protected async _close(
    { server, controller }: DenoListener,
    force: boolean,
  ): Promise<void> {
    if (force) {
      controller.abort();
    } else {
      // WHY: shutdown() lets Deno flush responses and close connections
      // gracefully. abort() would cancel them and can drop a response that
      // is already queued for the client.
      await server.shutdown();
    }
    // WHY: `finished` resolves after the OS listener socket is dropped, which
    // is the only point at which the port stops accepting connections.
    await server.finished;
  }

  get port(): number | undefined {
    const addr = this.listener?.server.addr;
    // Handle both network and Unix addresses
    return addr && 'port' in addr ? addr.port : undefined;
  }

  get address(): { hostname: string; port: number } | undefined {
    const addr = this.listener?.server.addr;
    if (!addr || !('port' in addr) || !('hostname' in addr)) return undefined;
    return { hostname: addr.hostname, port: addr.port };
  }
}

/** A bound Node listener and the error logger attached to it after listen. */
type NodeListener = {
  readonly server: import('node:http').Server;
  readonly onError: (error: Error) => void;
};

/**
 * Node.js implementation of the MinimalHttpServer abstraction.
 * This class provides a Node.js-specific implementation of the HTTP server.
 */
export class NodeHttpServer extends BaseHttpServer<NodeListener> {
  /** Cached reference to the Node.js Buffer implementation */
  private _Buffer?: typeof import('node:buffer').Buffer;
  private readonly _options: HttpServerOptions;

  constructor(options: HttpServerOptions = {}) {
    super();
    this._options = options;
  }

  /**
   * Handles an incoming Node.js request by converting it to a GoatRequest,
   * invoking the handler, and streaming the response back.
   */
  private async _handleRequest(
    req: MinimalNodeIncomingMessage,
    res: MinimalNodeServerResponse,
    handler: (req: GoatRequest, info: ServeHandlerInfo) => Promise<Response>,
  ): Promise<void> {
    if (!this._drain.accepting) {
      writeServiceUnavailable(res);
      return;
    }
    try {
      const goatReq = new GoatRequest(req);
      const hostname = req.socket?.remoteAddress ?? '';
      let completedResolve!: () => void;
      const completed = new Promise<void>((resolve) => {
        completedResolve = resolve;
      });
      if (res.once) {
        res.once('finish', completedResolve);
        res.once('close', completedResolve);
      } else {
        completedResolve();
      }
      const info: ServeHandlerInfo = {
        remoteAddr: { hostname },
        completed,
      };
      const response = await this._drain.track(
        completed,
        () => handler(goatReq, info),
      );
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value != null) {
              const chunk = value instanceof Uint8Array && this._Buffer
                ? this._Buffer.from(value)
                : value;
              const ok = res.write(chunk as Uint8Array | string);
              if (!ok && res.once) {
                await new Promise<void>((r) => res.once!('drain', () => r()));
              }
            }
          }
        } catch (e) {
          await reader.cancel().catch(() => {});
          throw e;
        }
        reader.releaseLock();
        res.end();
      } else {
        res.end();
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const connectionError = code === 'ECONNRESET' || code === 'EPIPE' ||
        code === 'ECONNABORTED';
      if (!connectionError) {
        log({
          severity: 'ERROR',
          error: 'UncaughtServerError',
          message: `Request handling error: ${
            err instanceof Error ? err.message : String(err)
          }`,
          trace: err instanceof Error ? err.stack : undefined,
        });
      }
      try {
        if (res.headersSent) {
          // If the client connection was destroyed (force/timeout stop), do
          // not send a terminating chunk — that would make a truncated
          // response look complete. Destroy the response instead.
          if (connectionError) {
            res.destroy();
          } else {
            res.end();
          }
        } else {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      } catch {
        // Socket already destroyed — nothing to do
      }
    }
  }

  protected async _bind(
    handler: (req: GoatRequest, info: ServeHandlerInfo) => Promise<Response>,
    port: number,
  ): Promise<NodeListener> {
    // Load required Node.js modules
    const { Buffer } = await getNodeBufferModule();
    this._Buffer = Buffer;

    const onRequest = (
      req: MinimalNodeIncomingMessage,
      res: MinimalNodeServerResponse,
    ) => this._handleRequest(req, res, handler);

    let server: import('node:http').Server;
    if (this._options.https) {
      const https = await import('node:https');
      server = https.createServer(
        {
          key: this._options.https.key,
          cert: this._options.https.cert,
        },
        (req, res) =>
          onRequest(
            req as MinimalNodeIncomingMessage,
            res as unknown as MinimalNodeServerResponse,
          ),
      );
    } else {
      const { createServer } = await getNodeHttp();
      server = createServer((req, res) =>
        onRequest(
          req as MinimalNodeIncomingMessage,
          res as unknown as MinimalNodeServerResponse,
        )
      );
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const onBindError = (error: Error) => {
          server.removeListener('error', onBindError);
          reject(error);
        };
        server.on('error', onBindError);
        server.listen(port, () => {
          server.removeListener('error', onBindError);
          resolve();
        });
      });
    } catch (error) {
      // WHY: a failed bind leaves the server object and the request handler
      // attached. Clear both so a retry starts from a clean state and no
      // stray listener can log against a discarded server.
      if (server.listening) server.close();
      server.removeAllListeners();
      throw error;
    }

    const onError = (error: Error) => {
      log({
        severity: 'ERROR',
        error: 'HttpServerError',
        message: `HTTP server error: ${error.message}`,
        trace: error.stack,
      });
    };
    server.on('error', onError);
    return { server, onError };
  }

  protected async _close(
    { server, onError }: NodeListener,
    force: boolean,
  ): Promise<void> {
    server.removeListener('error', onError);
    const closed = new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
    // Node 24 close() already closes idle keep-alive sockets. Only active
    // sockets need an explicit destroy on force or timeout.
    if (force) server.closeAllConnections?.();
    await closed;
  }

  get port(): number | undefined {
    const addr = this.listener?.server.address();
    return addr && typeof addr !== 'string' ? addr.port : undefined;
  }

  get address(): { hostname: string; port: number } | undefined {
    const addr = this.listener?.server.address();
    if (!addr || typeof addr === 'string') return undefined;
    return {
      hostname: addr.address || 'localhost',
      port: addr.port,
    };
  }
}

/** Writes the shared 503 to a raw Node response. */
function writeServiceUnavailable(res: MinimalNodeServerResponse): void {
  res.statusCode = SERVICE_UNAVAILABLE_STATUS;
  res.setHeader('Connection', SERVICE_UNAVAILABLE_CONNECTION);
  res.end(SERVICE_UNAVAILABLE_BODY);
}

/** @group HTTP */
export interface HttpServerOptions {
  /** HTTPS configuration */
  https?: {
    key: string;
    cert: string;
  };
}

/** @group HTTP */
export type HttpServerInstance = DenoHttpServer | NodeHttpServer;

/**
 * Factory function to create the appropriate HTTP server implementation
 * depending on the runtime (Deno or Node.js).
 *
 * Uses the RuntimeAdapter registry to determine the current runtime.
 * Browser environments do not support HTTP server creation and will throw.
 * @group HTTP
 */
export function createHttpServer(
  options: HttpServerOptions = {},
): HttpServerInstance {
  const runtime = getRuntime();
  if (runtime.id === 'deno') {
    return new DenoHttpServer(options);
  } else if (runtime.id === 'node') {
    return new NodeHttpServer(options);
  } else {
    throw new Error(`Unsupported runtime for HTTP server: ${runtime.id}`);
  }
}
