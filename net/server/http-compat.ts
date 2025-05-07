// GoatRequest: a thin abstraction over Deno/web Request and Node.js http2.Http2ServerRequest
// Usage: Use GoatRequest everywhere instead of the global Request for cross-environment compatibility.

// Deno or browser environment: just use the native Request
// Node.js: provide a wrapper for http2.Http2ServerRequest

// Detect environment
import { isDeno, isNode } from '../../base/common.ts';

// Helper to get Buffer in Node.js
let _Buffer: any = undefined;
async function getBuffer(): Promise<any> {
  if (!isNode()) throw new Error('Buffer is only available in Node.js');
  if (_Buffer) return _Buffer;
  // Dynamically import node:buffer module
  const mod = await import('node:buffer');
  _Buffer = mod.Buffer;
  return _Buffer;
}

// Helper to get Headers in Node.js (not used, so removed)

export class GoatRequest {
  private _native: Request | any; // Deno/web Request or Node.js http2.Http2ServerRequest
  public url: string;
  public method: string;
  public headers: Headers;
  public body: ReadableStream<Uint8Array> | null;

  constructor(req: Request | any) {
    if (isDeno()) {
      // Deno/web: just use the native Request
      this._native = req;
      this.url = req.url;
      this.method = req.method;
      this.headers = req.headers;
      this.body = req.body;
    } else if (isNode()) {
      this._native = req;
      // Detect if this is http2 (has pseudo-headers) or http1 (IncomingMessage)
      const isHttp2 = req.headers &&
        (':scheme' in req.headers || ':authority' in req.headers ||
          ':path' in req.headers);
      let scheme: string, authority: string, path: string;
      if (isHttp2) {
        // Node.js http2: wrap the http2.Http2ServerRequest
        scheme = req.headers[':scheme'] || 'http';
        authority = req.headers[':authority'] || req.headers['host'] ||
          'localhost';
        path = req.headers[':path'] || req.url || '/';
      } else {
        // Node.js http1: http.IncomingMessage
        scheme = req.socket && req.socket.encrypted ? 'https' : 'http';
        authority = req.headers['host'] || 'localhost';
        path = req.url || '/';
      }
      this.url = `${scheme}://${authority}${path}`;
      this.method = req.method;
      // Convert Node.js headers to web Headers
      let HeadersCtor: typeof Headers;
      if (typeof Headers !== 'undefined') {
        HeadersCtor = Headers;
      } else {
        // Fallback: minimal polyfill (not standards-compliant)
        HeadersCtor = class extends Map {
          append(k: string, v: string) {
            this.set(k, v);
          }
          override set(k: string, v: string) {
            super.set(k, v);
            return this;
          }
          override get(k: string) {
            return super.get(k);
          }
        } as any;
      }
      this.headers = new HeadersCtor();
      for (const [k, v] of Object.entries(req.headers)) {
        if (!k.startsWith(':')) {
          if (Array.isArray(v)) {
            for (const vv of v) this.headers.append(k, vv);
          } else if (v != null) {
            this.headers.set(k, v as string);
          }
        }
      }
      // For both http1 and http2, the body is the request stream
      this.body = req;
    } else {
      throw new Error('Unsupported runtime for GoatRequest');
    }
  }

  // Helper: get JSON body (like Request.json())
  async json(): Promise<any> {
    if (!isNode()) {
      return this._native.json();
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.body as any) {
        chunks.push(chunk);
      }
      const Buffer = await getBuffer();
      const buf = Buffer.concat(chunks).toString('utf8');
      return JSON.parse(buf);
    }
  }

  // Helper: get text body (like Request.text())
  async text(): Promise<string> {
    if (!isNode()) {
      return this._native.text();
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.body as any) {
        chunks.push(chunk);
      }
      const Buffer = await getBuffer();
      return Buffer.concat(chunks).toString('utf8');
    }
  }

  // Helper: get the original request (for advanced use)
  get raw() {
    return this._native;
  }
}

// Usage in Deno: new GoatRequest(request)
// Usage in Node.js: new GoatRequest(http2Request)
