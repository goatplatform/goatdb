import { getRuntime } from '../../base/runtime/index.ts';
import { assert, notReached } from '../../base/error.ts';

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
  override set(k: string, v: string) {
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
  get raw() {
    return this._native;
  }
}

// Unified address abstraction for all runtimes
export type HttpRemoteAddr = { hostname: string };

/**
 * Define a minimal local ServeHandlerInfo type for compatibility
 * Always uses the unified HttpRemoteAddr abstraction.
 */
export type ServeHandlerInfo = {
  remoteAddr: HttpRemoteAddr;
  /** Resolves when the response is fully sent. Natively supported in Deno; pre-resolved stub in Node.js. */
  completed: Promise<void>;
};

/**
 * Minimal cross-platform HTTP server abstraction for GoatDB.
 *
 * This interface and implementation allow the server to be started and stopped
 * in a platform-agnostic way. Currently, only the Deno implementation is provided.
 */
export interface MinimalHttpServer {
  start(
    handler: (req: GoatRequest, info: ServeHandlerInfo) => Promise<Response>,
    port: number,
    signal?: AbortSignal,
  ): Promise<void>;
  stop(): void;
  readonly port?: number;
  readonly address?: { hostname: string; port: number };
}

/**
 * Deno implementation of the MinimalHttpServer abstraction.
 */
export class DenoHttpServer implements MinimalHttpServer {
  private _abortController?: AbortController;
  private _server?: Deno.HttpServer;
  private _started: boolean = false;
  private _options: HttpServerOptions;

  constructor(options: HttpServerOptions = {}) {
    this._options = options;
  }

  start(
    handler: (
      req: GoatRequest,
      info: ServeHandlerInfo,
    ) => Promise<Response>,
    port: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this._started) {
      return Promise.resolve();
    }
    this._abortController = new AbortController();
    if (signal) {
      signal.addEventListener(
        'abort',
        () => this._abortController!.abort(),
        { once: true },
      );
    }
    const combinedSignal = this._abortController.signal;
    let resolve: () => void;
    const started = new Promise<void>((res) => {
      resolve = res;
    });
    // Use HTTPS or HTTP based on configuration
    const serveOptions: any = {
      port,
      onListen() {
        resolve();
      },
      signal: combinedSignal,
    };

    // Add TLS options if HTTPS is configured
    if (this._options.https) {
      serveOptions.key = this._options.https.key;
      serveOptions.cert = this._options.https.cert;
    }

    this._server = Deno.serve(
      serveOptions,
      (req: Request, info: Deno.ServeHandlerInfo) => {
        // Map Deno's info to the unified abstraction
        const remoteAddr: HttpRemoteAddr = {
          hostname: (info.remoteAddr as any).hostname ?? 'localhost',
        };
        return handler(new GoatRequest(req), {
          remoteAddr,
          completed: info.completed,
        });
      },
    );
    this._started = true;
    return started;
  }

  stop(): void {
    this._abortController?.abort();
    this._started = false;
  }

  get port(): number | undefined {
    if (!this._server) return undefined;
    const addr = this._server.addr;
    // Handle both network and Unix addresses
    if ('port' in addr) {
      return addr.port;
    }
    return undefined;
  }

  get address(): { hostname: string; port: number } | undefined {
    if (!this._server) return undefined;
    const addr = this._server.addr;
    // Handle both network and Unix addresses
    if ('port' in addr && 'hostname' in addr) {
      return {
        hostname: addr.hostname,
        port: addr.port,
      };
    }
    return undefined;
  }
}

/**
 * Node.js implementation of the MinimalHttpServer abstraction.
 * This class provides a Node.js-specific implementation of the HTTP server.
 */
export class NodeHttpServer implements MinimalHttpServer {
  /** The underlying Node.js HTTP/HTTPS server instance */
  private _server?: import('node:http').Server | import('node:https').Server;
  /** Whether the server has been started */
  private _started: boolean = false;
  /** Cached reference to the Node.js Buffer implementation */
  private _Buffer?: typeof import('node:buffer').Buffer;
  /** HTTPS configuration options */
  private _options: HttpServerOptions;

  constructor(options: HttpServerOptions = {}) {
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
    try {
      const goatReq = new GoatRequest(req);
      const hostname = req.socket?.remoteAddress ?? '';
      const info: ServeHandlerInfo = {
        remoteAddr: { hostname },
        // Node.js stub — no native equivalent to Deno's info.completed
        completed: Promise.resolve(),
      };
      const response = await handler(goatReq, info);
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
      if (
        code !== 'ECONNRESET' && code !== 'EPIPE' && code !== 'ECONNABORTED'
      ) {
        console.error('Request handling error:', err);
      }
      try {
        if (res.headersSent) {
          res.end();
        } else {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      } catch {
        // Socket already destroyed — nothing to do
      }
    }
  }

  /**
   * Starts the HTTP server on the specified port.
   *
   * @param handler - The request handler function that processes incoming requests
   * @param port - The port number to listen on
   * @param signal - Optional AbortSignal for server shutdown
   * @returns A promise that resolves when the server is ready to accept connections
   */
  async start(
    handler: (
      req: GoatRequest,
      info: ServeHandlerInfo,
    ) => Promise<Response>,
    port: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this._started) {
      return;
    }

    // Load required Node.js modules
    const { Buffer } = await getNodeBufferModule();
    this._Buffer = Buffer;

    // Create and configure the HTTP/HTTPS server
    if (this._options.https) {
      const https = await import('node:https');
      this._server = https.createServer(
        {
          key: this._options.https.key,
          cert: this._options.https.cert,
        },
        (req, res) =>
          this._handleRequest(
            req as MinimalNodeIncomingMessage,
            res as unknown as MinimalNodeServerResponse,
            handler,
          ),
      );
    } else {
      const { createServer } = await getNodeHttp();
      this._server = createServer(
        (req, res) =>
          this._handleRequest(
            req as MinimalNodeIncomingMessage,
            res as unknown as MinimalNodeServerResponse,
            handler,
          ),
      );
    }

    // Start listening on specified port
    await new Promise<void>((resolve, reject) => {
      this._server!.on('error', reject);
      this._server!.listen(port, () => {
        this._server!.removeListener('error', reject);
        this._server!.on('error', (err: Error) => {
          console.error('HTTP server error:', err);
        });
        resolve();
      });
    });
    this._started = true;

    // Wire abort signal for graceful shutdown
    if (signal) {
      if (signal.aborted) {
        this.stop();
      } else {
        signal.addEventListener('abort', () => this.stop(), { once: true });
      }
    }
  }

  /**
   * Stops the HTTP server and cleans up resources.
   */
  stop(): void {
    if (this._server && 'closeAllConnections' in this._server) {
      (this._server as any).closeAllConnections();
    }
    this._server?.close();
    this._started = false;
  }

  get port(): number | undefined {
    if (!this._server) return undefined;
    const addr = (this._server as any).address();
    return addr ? addr.port : undefined;
  }

  get address(): { hostname: string; port: number } | undefined {
    if (!this._server) return undefined;
    const addr = (this._server as any).address();
    if (!addr) return undefined;
    return {
      hostname: addr.address || 'localhost',
      port: addr.port,
    };
  }
}

// Union type for all supported MinimalHttpServer implementations
export interface HttpServerOptions {
  /** HTTPS configuration */
  https?: {
    key: string;
    cert: string;
  };
}

export type HttpServerInstance = DenoHttpServer | NodeHttpServer;

/**
 * Factory function to create the appropriate HTTP server implementation
 * depending on the runtime (Deno or Node.js).
 *
 * Uses the RuntimeAdapter registry to determine the current runtime.
 * Browser environments do not support HTTP server creation and will throw.
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
