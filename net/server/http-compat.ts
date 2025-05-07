import { isNode } from '../../base/common.ts';
import { assert, notReached } from '../../base/error.ts';
import type { JSONValue } from '../../base/interfaces.ts';

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

let _Buffer: MinimalBuffer | undefined = undefined;
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
  assert(isNode(), 'Buffer is only available in Node.js');
  if (_Buffer) {
    return _Buffer;
  }
  // Dynamically import node:buffer module
  const mod = await import('node:buffer');
  _Buffer = mod.Buffer;
  return _Buffer as MinimalBuffer;
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
 * Polyfill for Headers that mimics standards-compliant behavior:
 * - append adds a new value (comma-separated)
 * - set overwrites
 * - get returns the first value (before the first comma), matching native Headers.get
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
    const existing = this.get(k);
    if (existing !== undefined) {
      super.set(k, existing + ',' + v);
    } else {
      super.set(k, v);
    }
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
  /**
   * Gets the first value of a header, matching the behavior of the web standard
   * Headers.get() method. For headers with multiple values (comma-separated),
   * returns only the first value.
   *
   * @param k - The header name to get
   * @returns The first value of the header, or undefined if the header doesn't exist
   */
  override get(k: string) {
    const val = super.get(k);
    if (val === undefined) return undefined;
    // Match native Headers.get: return first value before comma
    return val.split(',')[0];
  }
}

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
  private _native: Request | NodeHttp1Request | NodeHttp2Request;
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
  constructor(req: Request | NodeHttp1Request | NodeHttp2Request) {
    if (isWebRequest(req)) {
      // Deno/web: just use the native Request
      this._native = req;
      this.url = req.url;
      this.method = req.method;
      this.headers = req.headers;
      this.body = req.body;
    } else if (isNode()) {
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
      this.method = (req as NodeHttp1Request | NodeHttp2Request).method;
      let headers: GoatHeaders;
      if (typeof Headers !== 'undefined') {
        headers = new Headers();
      } else {
        headers = new NodeHeadersPolyfill();
      }
      const nodeHeaders = (req as NodeHttp1Request | NodeHttp2Request).headers;
      for (const [k, v] of Object.entries(nodeHeaders)) {
        if (!k.startsWith(':')) {
          if (Array.isArray(v)) {
            for (const vv of v) headers.append(k, vv);
          } else if (v != null) {
            headers.set(k, v as string);
          }
        }
      }
      this.headers = headers;
      // For both http1 and http2, the body is the request stream
      // We cannot type this.body as ReadableStream, but keep as any for Node
      this.body = req as any;
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
    if (!isNode()) {
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
    if (!isNode()) {
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
