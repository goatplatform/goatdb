/**
 * Tests for the NodeHttpServer implementation.
 *
 * Verifies that the Node.js HTTP server correctly handles requests, responses,
 * headers, status codes, and graceful shutdown via AbortSignal.
 * These tests are skipped on non-Node.js runtimes.
 */

import { TEST } from './mod.ts';
import { assertEquals, assertExists, assertTrue } from './asserts.ts';
import { isNode } from '../base/common.ts';
import { GoatRequest, NodeHttpServer, type ServeHandlerInfo } from '../net/server/http-compat.ts';

export default function setupNodeHttpServerTests() {
  TEST('NodeHttpServer', 'GET request returns response body', async () => {
    if (!isNode()) return;
    const server = new NodeHttpServer();
    try {
      await server.start(
        async (_req: GoatRequest, _info: ServeHandlerInfo) =>
          new Response('hello', { status: 200 }),
        0,
      );
      const url = `http://localhost:${server.port}`;
      const res = await fetch(url);
      assertEquals(res.status, 200, 'status should be 200');
      const body = await res.text();
      assertEquals(body, 'hello', 'body should match');
    } finally {
      server.stop();
    }
  });

  TEST('NodeHttpServer', 'POST body is readable in handler', async () => {
    if (!isNode()) return;
    const server = new NodeHttpServer();
    try {
      await server.start(
        async (req: GoatRequest, _info: ServeHandlerInfo) => {
          const body = await req.text();
          return new Response(body, { status: 200 });
        },
        0,
      );
      const url = `http://localhost:${server.port}`;
      const res = await fetch(url, {
        method: 'POST',
        body: 'echo this',
      });
      const text = await res.text();
      assertEquals(text, 'echo this', 'echoed body should match sent body');
    } finally {
      server.stop();
    }
  });

  TEST('NodeHttpServer', 'response headers are sent over wire', async () => {
    if (!isNode()) return;
    const server = new NodeHttpServer();
    try {
      await server.start(
        async (_req: GoatRequest, _info: ServeHandlerInfo) =>
          new Response('ok', {
            status: 200,
            headers: { 'x-custom': 'test-value' },
          }),
        0,
      );
      const url = `http://localhost:${server.port}`;
      const res = await fetch(url);
      await res.text();
      assertEquals(
        res.headers.get('x-custom'),
        'test-value',
        'custom response header should be present',
      );
    } finally {
      server.stop();
    }
  });

  TEST('NodeHttpServer', 'status 404 is transmitted', async () => {
    if (!isNode()) return;
    const server = new NodeHttpServer();
    try {
      await server.start(
        async (_req: GoatRequest, _info: ServeHandlerInfo) =>
          new Response('not found', { status: 404 }),
        0,
      );
      const url = `http://localhost:${server.port}`;
      const res = await fetch(url);
      await res.text();
      assertEquals(res.status, 404, 'status should be 404');
    } finally {
      server.stop();
    }
  });

  TEST('NodeHttpServer', 'AbortSignal stops the server', async () => {
    if (!isNode()) return;
    const server = new NodeHttpServer();
    const ac = new AbortController();
    try {
      await server.start(
        async (_req: GoatRequest, _info: ServeHandlerInfo) => new Response('alive'),
        0,
        ac.signal,
      );
      assertTrue(server.port !== undefined && server.port > 0, 'server should have a valid port before abort');
      ac.abort();
      // ac.abort() fires the 'abort' listener synchronously, calling stop().
      // Node.js sets server.address() to null as soon as server.close() is called,
      // so server.port is undefined immediately — no await needed.
      assertTrue(server.port === undefined, 'server.port must be undefined after abort');
    } finally {
      server.stop(); // idempotent safety cleanup
    }
  });

  TEST('NodeHttpServer', 'address returns hostname and port', async () => {
    if (!isNode()) return;
    const server = new NodeHttpServer();
    try {
      await server.start(
        async (_req: GoatRequest, _info: ServeHandlerInfo) => new Response('ok'),
        0,
      );
      const addr = server.address;
      assertExists(addr, 'address should be defined after start');
      assertTrue(addr.port > 0, 'port should be positive');
      assertExists(addr.hostname, 'hostname should be defined');
    } finally {
      server.stop();
    }
  });
}
