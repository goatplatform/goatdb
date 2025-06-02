import * as path from '@std/path';
import {
  type Endpoint,
  type Middleware,
  Server,
  type ServerOptions,
} from '../net/server/server.ts';
import {
  GoatRequest,
  type ServeHandlerInfo,
  createGoatHeaders,
  NodeHeadersPolyfill,
} from '../net/server/http-compat.ts';
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { generateBuildInfo } from '../server/build-info.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';
import { isDeno, isNode } from '../base/common.ts';

export default async function setupServerArchitectureTest() {
  // Minimal DomainConfig for single-org
  const domain = {
    resolveOrg: (orgId: string) => `http://localhost/${orgId}`,
    resolveDomain: (url: string) => {
      try {
        const u = new URL(url);
        return u.hostname === 'localhost' ? 'test-org' : '';
      } catch {
        return '';
      }
    },
  };

  const buildInfo = await generateBuildInfo(
    path.join((await FileImplGet()).getCWD(), 'deno.json'),
  );

  function makeServer(path: string) {
    const opts: ServerOptions<Schema> = {
      path,
      buildInfo,
      domain,
      orgId: 'test-org',
      registry: undefined as any, // Not used in these tests
      disableDefaultEndpoints: true,
    };
    return new Server<Schema>(opts);
  }

  TEST('ServerArchitecture', 'endpoint order and filter', async (ctx) => {
    const server = makeServer(await ctx.tempDir('endpoint-filter'));
    const calls: string[] = [];
    // Endpoint 1: matches only GET /foo
    const ep1: Endpoint<Schema> = {
      filter: (_s, req) => req.url.endsWith('/foo') && req.method === 'GET',
      processRequest: async () => {
        calls.push('ep1');
        return new Response('ep1', { status: 200 });
      },
    };
    // Endpoint 2: matches all
    const ep2: Endpoint<Schema> = {
      filter: () => true,
      processRequest: async () => {
        calls.push('ep2');
        return new Response('ep2', { status: 200 });
      },
    };
    server.registerEndpoint(ep1);
    server.registerEndpoint(ep2);
    // Should match ep1
    const req1 = new GoatRequest(
      new Request('http://localhost/foo', { method: 'GET' }),
    );
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp1 = await server.processRequest(req1, info);
    assertEquals(await resp1.text(), 'ep1');
    assertEquals(calls, ['ep1']);
    // Should match ep2 (not /foo)
    const req2 = new GoatRequest(
      new Request('http://localhost/bar', { method: 'GET' }),
    );
    const resp2 = await server.processRequest(req2, info);
    assertEquals(await resp2.text(), 'ep2');
    assertEquals(calls, ['ep1', 'ep2']);
  });

  TEST('ServerArchitecture', 'middleware blocks request', async (ctx) => {
    const server = makeServer(await ctx.tempDir('middleware-blocks'));
    let blocked = false;
    // Middleware that blocks all requests
    const mid: Middleware<Schema> = {
      shouldProcess: async () => {
        blocked = true;
        return new Response('blocked', { status: 403 });
      },
    };
    // Endpoint that would match
    const ep: Endpoint<Schema> = {
      filter: () => true,
      processRequest: async () =>
        new Response('should not run', { status: 200 }),
    };
    server.registerMiddleware(mid);
    server.registerEndpoint(ep);
    const req = new GoatRequest(
      new Request('http://localhost/any', { method: 'GET' }),
    );
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(await resp.text(), 'blocked');
    assertTrue(blocked);
  });

  TEST('ServerArchitecture', 'middleware modifies response', async (ctx) => {
    const server = makeServer(await ctx.tempDir('middleware-modifies'));
    // Middleware that adds a header
    const mid: Middleware<Schema> = {
      didProcess: async (_s, _r, _i, resp) => {
        const newResp = new Response(await resp.text(), {
          status: resp.status,
          headers: { ...Object.fromEntries(resp.headers), 'X-Test': 'yes' },
        });
        return newResp;
      },
    };
    // Endpoint that returns a response
    const ep: Endpoint<Schema> = {
      filter: () => true,
      processRequest: async () => new Response('ok', { status: 200 }),
    };
    server.registerMiddleware(mid);
    server.registerEndpoint(ep);
    const req = new GoatRequest(
      new Request('http://localhost/ok', { method: 'GET' }),
    );
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(await resp.text(), 'ok');
    assertEquals(resp.headers.get('X-Test'), 'yes');
  });

  TEST('ServerArchitecture', '404 and didProcess middleware', async (ctx) => {
    const server = makeServer(await ctx.tempDir('404-didprocess'));
    let didProcessCalled = false;
    // Middleware that marks didProcess
    const mid: Middleware<Schema> = {
      didProcess: async (_s, _r, _i, resp) => {
        didProcessCalled = true;
        return resp;
      },
    };
    server.registerMiddleware(mid);
    // No endpoints match
    const req = new GoatRequest(
      new Request('http://localhost/none', { method: 'GET' }),
    );
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(resp.status, 404);
    assertTrue(didProcessCalled);
  });

  TEST('ServerArchitecture', 'endpoint throws error', async (ctx) => {
    const server = makeServer(await ctx.tempDir('endpoint-throws'));
    // Endpoint that throws
    const ep: Endpoint<Schema> = {
      filter: () => true,
      processRequest: async () => {
        throw new Error('fail!');
      },
    };
    server.registerEndpoint(ep);
    const req = new GoatRequest(
      new Request('http://localhost/fail', { method: 'GET' }),
    );
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(resp.status, 500);
  });

  TEST('ServerArchitecture', 'orgId not found returns 404', async (ctx) => {
    const server = makeServer(await ctx.tempDir('orgid-404'));
    // Endpoint that would match if orgId was found
    const ep: Endpoint<Schema> = {
      filter: () => true,
      processRequest: async () =>
        new Response('should not run', { status: 200 }),
    };
    server.registerEndpoint(ep);
    // Use a URL that will not resolve to an orgId
    const req = new GoatRequest(
      new Request('http://notfound/any', { method: 'GET' }),
    );
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'notfound' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(resp.status, 404);
  });
  
  // --- createGoatHeaders tests ---
  TEST(
    'ServerArchitecture',
    'createGoatHeaders returns the correct implementation',
    () => {
      const headers = createGoatHeaders();
      
      // Verify the correct implementation is returned based on runtime
      if (isDeno() || (typeof globalThis !== 'undefined' && 'Headers' in globalThis)) {
        assertTrue(headers instanceof Headers, 'Should return Headers instance in Deno/browser');
      } else if (isNode()) {
        assertTrue(headers instanceof NodeHeadersPolyfill, 'Should return NodeHeadersPolyfill in Node.js');
      }
    },
  );

  TEST(
    'ServerArchitecture',
    'createGoatHeaders initializes with object literal',
    async () => {
      // Import the createGoatHeaders function
      const { createGoatHeaders } = await import('../net/server/http-compat.ts');
      
      const headers = createGoatHeaders({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token123',
      });
      
      assertEquals(
        headers.get('content-type'),
        'application/json',
        'Should initialize with content-type header',
      );
      assertEquals(
        headers.get('authorization'),
        'Bearer token123',
        'Should initialize with authorization header',
      );
    },
  );

  TEST(
    'ServerArchitecture',
    'createGoatHeaders initializes with array of entries',
    async () => {
      // Import the createGoatHeaders function
      const { createGoatHeaders } = await import('../net/server/http-compat.ts');
      
      const headers = createGoatHeaders([
        ['Content-Type', 'application/json'],
        ['X-API-Key', 'abc123'],
      ]);
      
      assertEquals(
        headers.get('content-type'),
        'application/json',
        'Should initialize with content-type header from array',
      );
      assertEquals(
        headers.get('x-api-key'),
        'abc123',
        'Should initialize with x-api-key header from array',
      );
    },
  );

  TEST(
    'ServerArchitecture',
    'createGoatHeaders initializes with existing headers',
    async () => {
      // Import the createGoatHeaders function
      const { createGoatHeaders } = await import('../net/server/http-compat.ts');
      
      // Create initial headers
      const initialHeaders = createGoatHeaders();
      initialHeaders.set('Content-Type', 'text/plain');
      initialHeaders.set('X-Custom', 'test-value');
      
      // Create new headers by extracting entries from existing headers
      const entries: [string, string][] = [];
      initialHeaders.forEach((value, key) => {
        entries.push([key, value]);
      });
      
      const headers = createGoatHeaders(entries);
      
      assertEquals(
        headers.get('content-type'),
        'text/plain',
        'Should copy content-type from existing headers',
      );
      assertEquals(
        headers.get('x-custom'),
        'test-value',
        'Should copy custom header from existing headers',
      );
    },
  );
}
