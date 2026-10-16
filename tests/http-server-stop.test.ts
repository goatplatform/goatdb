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

function stopTwice(server: MinimalHttpServer): void {
  server.stop();
  server.stop();
  assertEquals(server.port, undefined, 'port must clear after stop');
  assertEquals(server.address, undefined, 'address must clear after stop');
}

async function startAndRead(server: MinimalHttpServer): Promise<number> {
  await server.start(() => Promise.resolve(new Response('ok')), 0);
  const port = server.port;
  if (port === undefined) throw new Error('Started server must expose its port');
  const response = await fetch(`http://127.0.0.1:${port}`);
  assertEquals(await response.text(), 'ok', 'body should match');
  return port;
}

function connectionRefused(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', (error: Error & { code?: string }) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(true);
      else reject(error);
    });
    socket.setTimeout(250, () => {
      socket.destroy();
      reject(new Error(`Connection probe timed out on port ${port}`));
    });
  });
}

async function assertConnectionRefused(port: number): Promise<void> {
  // stop() is synchronous; listener closure can finish on a later event-loop turn.
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    if (await connectionRefused(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Stopped server still accepts connections on port ${port}`);
}

export default function setupHttpServerStop() {
  TEST('HttpServerStop', 'stop is idempotent and closes its listener', async () => {
    const server = createServer();
    try {
      const port = await startAndRead(server);
      stopTwice(server);
      await assertConnectionRefused(port);
    } finally {
      server.stop();
    }
  });
  TEST('HttpServerStop', 'stop before start is safe', () => {
    stopTwice(createServer());
  });
}
