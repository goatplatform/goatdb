import * as path from '@std/path';
import {
  type Endpoint,
  type Middleware,
  Server,
  type ServerOptions,
} from '../net/server/server.ts';
import type { ServeHandlerInfo } from '../net/server/http-compat.ts';
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { generateBuildInfo } from '../server/build-info.ts';
import { FileImplGet } from '../base/json-log/file-impl.ts';

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

  function makeServer() {
    const opts: ServerOptions<Schema> = {
      path: './tmp-server-test',
      buildInfo,
      domain,
      orgId: 'test-org',
      registry: undefined as any, // Not used in these tests
      disableDefaultEndpoints: true,
    };
    return new Server<Schema>(opts);
  }

  TEST('ServerArchitecture', 'endpoint order and filter', async () => {
    const server = makeServer();
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
    const req1 = new Request('http://localhost/foo', { method: 'GET' });
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp1 = await server.processRequest(req1, info);
    assertEquals(await resp1.text(), 'ep1');
    assertEquals(calls, ['ep1']);
    // Should match ep2 (not /foo)
    const req2 = new Request('http://localhost/bar', { method: 'GET' });
    const resp2 = await server.processRequest(req2, info);
    assertEquals(await resp2.text(), 'ep2');
    assertEquals(calls, ['ep1', 'ep2']);
  });

  TEST('ServerArchitecture', 'middleware blocks request', async () => {
    const server = makeServer();
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
    const req = new Request('http://localhost/any', { method: 'GET' });
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(await resp.text(), 'blocked');
    assertTrue(blocked);
  });

  TEST('ServerArchitecture', 'middleware modifies response', async () => {
    const server = makeServer();
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
    const req = new Request('http://localhost/ok', { method: 'GET' });
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(await resp.text(), 'ok');
    assertEquals(resp.headers.get('X-Test'), 'yes');
  });

  TEST('ServerArchitecture', '404 and didProcess middleware', async () => {
    const server = makeServer();
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
    const req = new Request('http://localhost/none', { method: 'GET' });
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(resp.status, 404);
    assertTrue(didProcessCalled);
  });

  TEST('ServerArchitecture', 'endpoint throws error', async () => {
    const server = makeServer();
    // Endpoint that throws
    const ep: Endpoint<Schema> = {
      filter: () => true,
      processRequest: async () => {
        throw new Error('fail!');
      },
    };
    server.registerEndpoint(ep);
    const req = new Request('http://localhost/fail', { method: 'GET' });
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(resp.status, 500);
  });

  TEST('ServerArchitecture', 'orgId not found returns 404', async () => {
    const server = makeServer();
    // Endpoint that would match if orgId was found
    const ep: Endpoint<Schema> = {
      filter: () => true,
      processRequest: async () =>
        new Response('should not run', { status: 200 }),
    };
    server.registerEndpoint(ep);
    // Use a URL that will not resolve to an orgId
    const req = new Request('http://notfound/any', { method: 'GET' });
    const info: ServeHandlerInfo = {
      remoteAddr: { hostname: 'notfound' },
      completed: Promise.resolve(),
    };
    const resp = await server.processRequest(req, info);
    assertEquals(resp.status, 404);
  });
}
