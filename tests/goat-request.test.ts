// Tests for GoatRequest abstraction (Deno/web and Node.js http2 compatibility)
import { GoatRequest } from '../net/server/http-compat.ts';
import { TEST } from './mod.ts';
import { assert } from '../base/error.ts';
import { isDeno, isNode } from '../base/common.ts';

export default function setupGoatRequestTest() {
  // --- Deno/web environment tests ---
  if (isDeno()) {
    TEST(
      'GoatRequest',
      'wraps native Request (Deno/web) with text()',
      async () => {
        const body = JSON.stringify({ foo: 'bar' });
        const req = new Request('https://example.com/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Test': 'yes' },
          body,
        });
        const goatReq = new GoatRequest(req);
        assert(
          goatReq.url === 'https://example.com/api',
          `url mismatch: got ${goatReq.url}`,
        );
        assert(goatReq.method === 'POST', 'method mismatch');
        assert(
          goatReq.headers.get('content-type') === 'application/json',
          'headers mismatch',
        );
        assert(await goatReq.text() === body, 'text() mismatch');
        assert(goatReq.raw === req, 'raw mismatch');
      },
    );
    TEST(
      'GoatRequest',
      'wraps native Request (Deno/web) with json()',
      async () => {
        const body = JSON.stringify({ foo: 'bar' });
        const req = new Request('https://example.com/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Test': 'yes' },
          body,
        });
        const goatReq = new GoatRequest(req);
        assert(
          goatReq.url === 'https://example.com/api',
          `url mismatch: got ${goatReq.url}`,
        );
        assert(goatReq.method === 'POST', 'method mismatch');
        assert(
          goatReq.headers.get('content-type') === 'application/json',
          'headers mismatch',
        );
        const json = await goatReq.json();
        assert(json.foo === 'bar', 'json() mismatch');
        assert(goatReq.raw === req, 'raw mismatch');
      },
    );
  }

  // --- Node.js http2-like mock test ---
  if (isNode()) {
    TEST('GoatRequest', 'wraps Node.js http2-style request', async () => {
      const { Buffer } = await import('node:buffer');
      // Minimal http2 request mock
      const mockReq = {
        method: 'PUT',
        headers: {
          ':scheme': 'https',
          ':authority': 'localhost:1234',
          ':path': '/node-api',
          'content-type': 'application/json',
          'x-test': 'node',
        },
        // Simulate a readable stream for body
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('{"hello":"node"}');
        },
      };
      const goatReq = new GoatRequest(mockReq);
      assert(
        goatReq.url === 'https://localhost:1234/node-api',
        `url mismatch: got ${goatReq.url}`,
      );
      assert(goatReq.method === 'PUT', 'method mismatch');
      assert(
        goatReq.headers.get('content-type') === 'application/json',
        'headers mismatch',
      );
      assert((await goatReq.text()) === '{"hello":"node"}', 'text() mismatch');
      const json = await goatReq.json();
      assert(json.hello === 'node', 'json() mismatch');
      assert(goatReq.raw === mockReq, 'raw mismatch');
    });

    // --- Node.js http1 IncomingMessage-style mock test ---
    TEST(
      'GoatRequest',
      'wraps Node.js http1 IncomingMessage-style request',
      async () => {
        const { Buffer } = await import('node:buffer');
        // Minimal http1 IncomingMessage mock
        const mockReq = {
          method: 'POST',
          headers: {
            'host': 'localhost:8080',
            'content-type': 'application/json',
            'x-test': 'node-http1',
          },
          url: '/http1-api',
          socket: { encrypted: false }, // Simulate http, not https
          // Simulate a readable stream for body
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('{"foo":"http1"}');
          },
        };
        const goatReq = new GoatRequest(mockReq);
        assert(
          goatReq.url === 'http://localhost:8080/http1-api',
          `url mismatch: got ${goatReq.url}`,
        );
        assert(goatReq.method === 'POST', 'method mismatch');
        assert(
          goatReq.headers.get('content-type') === 'application/json',
          'headers mismatch',
        );
        assert((await goatReq.text()) === '{"foo":"http1"}', 'text() mismatch');
        const json = await goatReq.json();
        assert(json.foo === 'http1', 'json() mismatch');
        assert(goatReq.raw === mockReq, 'raw mismatch');
      },
    );
  }
}
