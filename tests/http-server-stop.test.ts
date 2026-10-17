/** Real-socket shutdown contract for both server runtimes. */
import { createConnection } from 'node:net';
import { TEST } from './mod.ts';
import { assertEquals } from './asserts.ts';
import { getRuntime } from '../base/runtime/index.ts';
import {
  DenoHttpServer,
  type MinimalHttpServer,
  NodeHttpServer,
} from '../net/server/http-compat.ts';

function createServer(): MinimalHttpServer {
  return getRuntime().id === 'node'
    ? new NodeHttpServer()
    : new DenoHttpServer();
}

async function stopTwice(server: MinimalHttpServer): Promise<void> {
  const firstStop = server.stop();
  const secondStop = server.stop();
  assertEquals(server.port, undefined, 'port must clear when stop starts');
  assertEquals(
    server.address,
    undefined,
    'address must clear when stop starts',
  );
  await Promise.all([firstStop, secondStop]);
}

async function startAndRead(
  server: MinimalHttpServer,
  listenPort = 0,
): Promise<number> {
  await server.start(() => Promise.resolve(new Response('ok')), listenPort);
  const port = server.port;
  if (port === undefined) {
    throw new Error('Started server must expose its port');
  }
  const response = await fetch(`http://127.0.0.1:${port}`, {
    // WHY: Deno < 2.9 reuses pooled keep-alive sockets across a server
    // restart and fails the next request (denoland/deno#17754). This test
    // checks listener release, not client-pool recovery.
    headers: { connection: 'close' },
  });
  assertEquals(await response.text(), 'ok', 'body should match');
  return port;
}

/** True means refused, false means connected, undefined means still pending. */
function connectionRefused(port: number): Promise<boolean | undefined> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    // WHY: Windows can leave a connect to a just-closed listener pending past
    // any single-probe timeout; that is not a hard failure, just "retry".
    const timer = setTimeout(() => settle(undefined), 250);
    const settle = (result: boolean | undefined | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    socket.once('connect', () => settle(false));
    socket.once('error', (error: Error & { code?: string }) => {
      settle(error.code === 'ECONNREFUSED' ? true : error);
    });
  });
}

async function assertConnectionRefused(port: number): Promise<void> {
  // A closed listener can remain pending on Windows; retry only pending probes.
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    const refused = await connectionRefused(port);
    if (refused === true) return;
    if (refused === false) {
      throw new Error(`Stopped server accepted a connection on port ${port}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Stopped server did not refuse connections on port ${port}`);
}

export default function setupHttpServerStop() {
  TEST(
    'HttpServerStop',
    'stop is idempotent and closes its listener',
    async () => {
      const server = createServer();
      try {
        const port = await startAndRead(server);
        await stopTwice(server);
        await assertConnectionRefused(port);
      } finally {
        await server.stop();
      }
    },
  );
  TEST(
    'HttpServerStop',
    'awaited stop permits immediate same-port restart',
    async () => {
      const server = createServer();
      try {
        const port = await startAndRead(server);
        await stopTwice(server);
        assertEquals(await startAndRead(server, port), port);
        await stopTwice(server);
      } finally {
        await server.stop();
      }
    },
  );
  TEST(
    'HttpServerStop',
    'probe reports a live listener as not refused',
    async () => {
      const server = createServer();
      try {
        const port = await startAndRead(server);
        // Guard the retry loop against a false pass: a listener that is still
        // open must never look refused.
        assertEquals(
          await connectionRefused(port),
          false,
          'a live listener must not look refused',
        );
      } finally {
        await server.stop();
      }
    },
  );
  TEST('HttpServerStop', 'stop before start is safe', async () => {
    await stopTwice(createServer());
  });
}
