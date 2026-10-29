/** Real-socket shutdown contract for both server runtimes. */
import {
  DEFAULT_STOP_TIMEOUT_MS,
  MAX_STOP_TIMEOUT_MS,
  Server,
} from '../server.ts';
import {
  awaitPendingStop,
  createHttpServer,
  GoatRequest,
  type HttpServerStopOptions,
  type MinimalHttpServer,
  StartStopGate,
} from '../net/server/http-compat.ts';
import { DataRegistry } from '../cfds/base/data-registry.ts';
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import { generateBuildInfo } from '../base/build-info.ts';
import { getRuntime } from '../base/runtime/index.ts';

import { clientOrigin } from './http-test-utils.ts';

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function bounded<T>(pending: Promise<T>, timeoutMs = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Socket test timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function requirePort(server: { readonly port?: number }): number {
  const port = server.port;
  if (port === undefined) {
    throw new Error('Started server must expose its port');
  }
  return port;
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
  const port = requirePort(server);
  const response = await fetch(clientOrigin(server), {
    // WHY: Deno < 2.9 reuses pooled keep-alive sockets across a server
    // restart and fails the next request (denoland/deno#17754). This test
    // checks the shutdown contract, not client-pool recovery.
    headers: { connection: 'close' },
  });
  assertEquals(await response.text(), 'ok', 'body should match');
  return port;
}

/** Fails the fetch; used to prove that a connection was torn down. */
async function expectRejected(pending: Promise<Response>): Promise<void> {
  const outcome = await pending.then(
    () => 'resolved',
    () => 'rejected',
  );
  assertEquals(outcome, 'rejected', 'request must be cut off by stop()');
}

function request(server: MinimalHttpServer, signal?: AbortSignal) {
  return fetch(clientOrigin(server), {
    headers: { connection: 'close' },
    signal,
  });
}

/** True when a bind failed because another listener holds the port. */
function isAddressInUse(error: unknown): boolean {
  return error instanceof Error &&
    /address already in use|AddrInUse|EADDRINUSE/i.test(String(error));
}

/** Starts `server` on `port`, retrying while the old listener drains. */
async function startWhenFree(
  server: MinimalHttpServer,
  port: number,
): Promise<void> {
  await bounded((async () => {
    while (true) {
      try {
        await server.start(() => Promise.resolve(new Response('ok')), port);
        return;
      } catch (error) {
        if (!isAddressInUse(error)) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  })());
}

/** Starts a server on a fixed port, retrying while the old listener drains. */
async function rebind(port: number): Promise<MinimalHttpServer> {
  const server = createHttpServer();
  try {
    await startWhenFree(server, port);
    return server;
  } catch (error) {
    await server.stop({ force: true });
    throw error;
  }
}

function streamingBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      controller.enqueue(new TextEncoder().encode('first'));
    },
  });
  return {
    body,
    finish() {
      controller.enqueue(new TextEncoder().encode('last'));
      controller.close();
    },
  };
}

async function firstChunk(response: Response) {
  const reader = response.body!.getReader();
  const chunk = await bounded(reader.read());
  assertEquals(new TextDecoder().decode(chunk.value), 'first');
  assertEquals(chunk.done, false, 'response must still be streaming');
  return reader;
}

async function interruptedStream(options: HttpServerStopOptions) {
  const server = createHttpServer();
  const stream = streamingBody();
  try {
    await server.start(() => Promise.resolve(new Response(stream.body)), 0);
    const reader = await firstChunk(await bounded(request(server)));
    const remaining = reader.read().then(
      (result) => ({ type: 'done', result } as const),
      (error) => ({ type: 'error', error } as const),
    );
    await bounded(server.stop(options));
    const outcome = await bounded(remaining);
    // Node.js resolves done on abrupt close; Deno rejects. Both must settle
    // because stop() cut the partial response.
    assertTrue(
      outcome.type === 'error' ||
        (outcome.result.done && outcome.result.value === undefined),
      'partial stream must settle after force/timeout stop',
    );
  } finally {
    await server.stop({ force: true });
  }
}

async function interruptedRequest(options: HttpServerStopOptions) {
  const server = createHttpServer();
  const started = deferred();
  const release = deferred();
  try {
    await server.start(async () => {
      started.resolve();
      await release.promise;
      return new Response('late');
    }, 0);
    const pending = request(server);
    void pending.catch(() => {});
    await bounded(started.promise);
    await bounded(server.stop(options));
    await expectRejected(pending);
  } finally {
    release.resolve();
    await server.stop({ force: true });
  }
}

async function createStopTestServer(
  serverPath: string,
  registry: DataRegistry,
  getPort: () => number,
  resolveDomain: (url: string) => string = () => 'localhost',
  port = 0,
) {
  const buildInfo = await generateBuildInfo(
    path.join(getRuntime().getCWD(), 'deno.json'),
  );
  return new Server({
    registry,
    path: serverPath,
    port,
    buildInfo,
    disableDefaultEndpoints: true,
    // WHY: port 0 needs a custom domain. The default resolveOrg captures the
    // port at construction.
    domain: {
      resolveOrg: () => `http://localhost:${getPort()}`,
      resolveDomain,
    },
  });
}

export default function setupHttpServerStop() {
  TEST(
    'HttpServerStop',
    'disconnect does not finish an active handler',
    async () => {
      const server = createHttpServer();
      const started = deferred();
      const release = deferred();
      const abort = new AbortController();
      let finished = false;
      try {
        await server.start(async () => {
          started.resolve();
          await release.promise;
          finished = true;
          return new Response('late');
        }, 0);
        const origin = clientOrigin(server);
        const pending = request(server, abort.signal);
        const disconnected = expectRejected(pending);
        await bounded(started.promise);
        abort.abort();
        await bounded(disconnected);
        const stopping = server.stop().then(() => {
          assertTrue(finished, 'stop must wait for the disconnected handler');
        });
        const arrivals = await bounded(
          fetch(origin, {
            headers: { connection: 'close' },
          }),
        );
        assertEquals(arrivals.status, 503);
        await arrivals.text();
        release.resolve();
        await bounded(stopping);
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'graceful stop delivers the complete stream',
    async () => {
      const server = createHttpServer();
      const stream = streamingBody();
      try {
        await server.start(() => Promise.resolve(new Response(stream.body)), 0);
        const origin = clientOrigin(server);
        const reader = await firstChunk(await bounded(request(server)));
        let stopped = false;
        const stopping = server.stop().then(() => {
          stopped = true;
        });
        const rejected = await bounded(
          fetch(origin),
        );
        assertEquals(rejected.status, 503);
        await rejected.text();
        assertEquals(stopped, false, 'stop must wait for the response body');
        stream.finish();
        const tail = await bounded(reader.read());
        assertEquals(new TextDecoder().decode(tail.value), 'last');
        assertEquals((await bounded(reader.read())).done, true);
        await bounded(stopping);
      } finally {
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'timeout interrupts a partial stream',
    () => interruptedStream({ timeoutMs: 50 }),
  );
  TEST(
    'HttpServerStop',
    'force interrupts a partial stream',
    () => interruptedStream({ force: true }),
  );

  TEST(
    'HttpServerStop',
    'stop is idempotent and releases the port',
    async () => {
      const server = createHttpServer();
      try {
        const port = await startAndRead(server);
        await stopTwice(server);
        // A closed listener is provable by binding the port again. Do not
        // probe a closed port: Windows reports refusal only after its SYN
        // retransmission budget (~2s), which turns the test into an OS-timing
        // assertion instead of a server-contract assertion.
        const rebound = await rebind(port);
        try {
          assertEquals(rebound.port, port, 'same port must be reusable');
          const response = await bounded(request(rebound));
          assertEquals(await response.text(), 'ok');
        } finally {
          await rebound.stop({ force: true });
        }
      } finally {
        await server.stop();
      }
    },
  );

  TEST(
    'HttpServerStop',
    'graceful stop drains in-flight requests and rejects new ones',
    async () => {
      const server = createHttpServer();
      const started = deferred();
      const release = deferred();
      try {
        await server.start(async () => {
          started.resolve();
          await release.promise;
          return new Response('ok');
        }, 0);
        const origin = clientOrigin(server);
        const first = fetch(origin, {
          headers: { connection: 'close' },
        });
        void first.catch(() => {});
        await started.promise;

        const stopping = server.stop();

        const duringDrain = await fetch(origin, {
          headers: { connection: 'close' },
        });
        assertEquals(duringDrain.status, 503, 'new requests must be rejected');
        assertEquals(await duringDrain.text(), 'Service Unavailable');

        release.resolve();
        const response = await first;
        assertEquals(response.status, 200, 'in-flight request must finish');
        assertEquals(await response.text(), 'ok');
        await stopping;
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'graceful stop force-closes requests that exceed the drain timeout',
    () => interruptedRequest({ timeoutMs: 50 }),
  );

  TEST(
    'HttpServerStop',
    'force stop skips the drain',
    () => interruptedRequest({ force: true }),
  );

  TEST(
    'HttpServerStop',
    'force escalates an in-flight graceful stop',
    async () => {
      const server = createHttpServer();
      const started = deferred();
      const release = deferred();
      try {
        await server.start(async () => {
          started.resolve();
          await release.promise;
          return new Response('late');
        }, 0);
        const pending = request(server);
        void pending.catch(() => {});
        await bounded(started.promise);

        const graceful = server.stop();
        const forced = server.stop({ force: true });
        await bounded(Promise.all([graceful, forced]));
        await expectRejected(pending);
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'rejected requests carry connection close',
    async () => {
      const server = createHttpServer();
      const started = deferred();
      const release = deferred();
      try {
        await server.start(async () => {
          started.resolve();
          await release.promise;
          return new Response('late');
        }, 0);
        const origin = clientOrigin(server);
        const pending = request(server);
        void pending.catch(() => {});
        await bounded(started.promise);
        const stopping = server.stop();
        const rejected = await bounded(
          fetch(origin, {
            headers: { connection: 'close' },
          }),
        );
        assertEquals(rejected.status, 503);
        assertTrue(
          rejected.headers.get('connection')?.includes('close') ?? false,
          'rejection must tell clients not to reuse the socket',
        );
        await rejected.text();
        release.resolve();
        await bounded(stopping);
        await pending.catch(() => {});
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'graceful stop closes idle keep-alive connections',
    async () => {
      const server = createHttpServer();
      try {
        await server.start(() => Promise.resolve(new Response('ok')), 0);
        // Deliberately keep-alive: stop() must close idle sockets itself.
        const response = await fetch(clientOrigin(server));
        assertEquals(await response.text(), 'ok');
        // Bound below the drain budget: a pass through the timeout path fails.
        await bounded(server.stop({ timeoutMs: 10_000 }));
        assertEquals(server.port, undefined);
      } finally {
        await server.stop({ force: true });
      }
    },
  );

  TEST('HttpServerStop', 'stop before start is safe', async () => {
    const server = createHttpServer();
    await stopTwice(server);
    await server.stop({ force: true });
  });

  TEST('HttpServerStop', 'default stop timeout is 10s', () => {
    assertEquals(
      DEFAULT_STOP_TIMEOUT_MS,
      10_000,
      'default drain budget must be 10s',
    );
  });

  TEST(
    'HttpServerStop',
    'same instance can restart after stop',
    async () => {
      const server = createHttpServer();
      try {
        await startAndRead(server);
        await server.stop();
        await startAndRead(server);
      } finally {
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'start waits for an in-flight stop',
    async () => {
      const server = createHttpServer();
      const started = deferred();
      const release = deferred();
      try {
        await server.start(async () => {
          started.resolve();
          await release.promise;
          return new Response('first');
        }, 0);
        const first = request(server);
        await bounded(started.promise);

        const stopping = server.stop({ timeoutMs: 5000 });
        const restarting = server.start(
          () => Promise.resolve(new Response('second')),
          0,
        );
        release.resolve();

        const firstResponse = await bounded(first);
        assertEquals(await firstResponse.text(), 'first');
        await bounded(stopping);
        await bounded(restarting);
        const second = await bounded(request(server));
        assertEquals(await second.text(), 'second');
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'force stop does not cancel the handler',
    async () => {
      const server = createHttpServer();
      const started = deferred();
      const release = deferred();
      const handlerDone = deferred();
      let handlerFinished = false;
      try {
        await server.start(async () => {
          started.resolve();
          await release.promise;
          handlerFinished = true;
          handlerDone.resolve();
          return new Response('late');
        }, 0);
        const pending = request(server);
        void pending.catch(() => {});
        await bounded(started.promise);
        // If force waited for the drain, this would block on the held handler.
        await bounded(server.stop({ force: true }));
        assertEquals(
          handlerFinished,
          false,
          'force stop must resolve while the handler still runs',
        );

        release.resolve();
        await bounded(handlerDone.promise);
        assertTrue(handlerFinished, 'handler must finish after release');
        await pending.catch(() => {});
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'Server.stop rejects new requests while handlers retain database access',
    async (ctx) => {
      // WHY: ctx.tempDir auto-cleans. Manual ./server-test-* dirs littered
      // the repo root on prior runs.
      const serverPath = await ctx.tempDir('server-stop');
      let actualPort = 0;
      const schema = {
        ns: 'shutdown-test',
        version: 1,
        fields: { value: { type: 'string', required: true } },
      } as const;
      const registry = new DataRegistry();
      registry.registerSchema(schema);
      const server = await createStopTestServer(
        serverPath,
        registry,
        () => actualPort,
      );
      const started = deferred();
      const release = deferred();
      server.registerEndpoint({
        filter() {
          return true;
        },
        async processRequest({ db }) {
          started.resolve();
          await release.promise;
          const item = db.create('/data/shutdown/item', schema, {
            value: 'ok',
          });
          await db.flushAll();
          return new Response(item.get('value'));
        },
      });
      try {
        await server.start();
        actualPort = requirePort(server);
        const base = `${clientOrigin(server)}/x`;
        const inFlight = fetch(base, {
          headers: { connection: 'close' },
        });
        void inFlight.catch(() => {});
        await started.promise;

        const healthBefore = await bounded(server.processRequest(
          new GoatRequest(new Request('http://AWSALB/healthy')),
          {
            remoteAddr: { hostname: 'localhost' },
            completed: Promise.resolve(),
          },
        ));
        assertEquals(
          healthBefore.status,
          200,
          'health checks must pass before shutdown',
        );

        // The HTTP adapter rejects arrivals while the active handler drains.
        const stopping = server.stop({ timeoutMs: 10_000 });

        const rejected = await fetch(base, {
          headers: { connection: 'close' },
        });
        assertEquals(
          rejected.status,
          503,
          'new requests must be rejected during shutdown',
        );
        await rejected.text();

        const health = await bounded(server.processRequest(
          new GoatRequest(new Request('http://AWSALB/healthy')),
          {
            remoteAddr: { hostname: 'localhost' },
            completed: Promise.resolve(),
          },
        ));
        assertEquals(
          health.status,
          503,
          'health checks must be rejected during drain',
        );

        // A restart must wait for the old teardown before it opens the DBs.
        const restarting = server.start();
        release.resolve();
        const done = await inFlight;
        assertEquals(done.status, 200, 'in-flight request must finish');
        assertEquals(await done.text(), 'ok');
        await stopping;
        await restarting;

        actualPort = requirePort(server);
        const after = await fetch(`${clientOrigin(server)}/x`, {
          headers: { connection: 'close' },
        });
        assertEquals(after.status, 200, 'restarted server must serve');
        assertEquals(await after.text(), 'ok');
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'stop() racing start() closes the restarted listener',
    async () => {
      const server = createHttpServer();
      const ok = () => Promise.resolve(new Response('ok'));
      const started = deferred();
      const release = deferred();
      const blocking = async () => {
        started.resolve();
        await release.promise;
        return new Response('ok');
      };
      try {
        await server.start(blocking, 0);
        requirePort(server);
        const inFlight = request(server);
        void inFlight.catch(() => {});
        await bounded(started.promise);

        // The graceful stop waits for the handler, so the restart awaits it.
        const parking = server.stop({ timeoutMs: 10_000 });
        const restarting = server.start(ok, 0);
        // WHY: without a start guard this stop() sees no listener yet, returns
        // immediately, and the restart keeps the server running.
        const racingStop = server.stop({ force: true });
        release.resolve();
        await inFlight.catch(() => {});
        await bounded(Promise.all([parking, restarting, racingStop]));

        assertEquals(
          server.port,
          undefined,
          'racing stop must close the restarted listener',
        );
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'force interrupts a drain queued behind a restart',
    async () => {
      const server = createHttpServer();
      const ok = () => Promise.resolve(new Response('ok'));
      const started = deferred();
      const release = deferred();
      const blocking = async () => {
        started.resolve();
        await release.promise;
        return new Response('ok');
      };
      try {
        await server.start(blocking, 0);
        const inFlight = request(server);
        void inFlight.catch(() => {});
        await bounded(started.promise);

        // The restart queues the forced stop behind the graceful teardown.
        const parking = server.stop({ timeoutMs: 30_000 });
        const restarting = server.start(ok, 0);
        // WHY: the handler stays pending, so only immediate escalation can
        // free the teardown before the graceful budget expires.
        await bounded(server.stop({ force: true }), 2000);
        assertEquals(
          server.port,
          undefined,
          'the forced stop must close the restarted listener',
        );
        await expectRejected(inFlight);
        await bounded(Promise.all([parking, restarting]));
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'Server.stop during start leaves no running listener',
    async (ctx) => {
      const serverPath = await ctx.tempDir('server-stop-race');
      let actualPort = 0;
      const server = await createStopTestServer(
        serverPath,
        new DataRegistry(),
        () => actualPort,
      );
      const started = deferred();
      const release = deferred();
      server.registerEndpoint({
        filter() {
          return true;
        },
        async processRequest() {
          started.resolve();
          await release.promise;
          return new Response('ok');
        },
      });
      try {
        await server.start();
        actualPort = requirePort(server);
        const inFlight = fetch(`${clientOrigin(server)}/x`, {
          headers: { connection: 'close' },
        });
        void inFlight.catch(() => {});
        await bounded(started.promise);

        // The graceful stop waits for the handler, so the restart awaits it.
        const parking = server.stop({ timeoutMs: 10_000 });
        const restarting = server.start();
        // WHY: this used to return before start() resumed, leaving the server
        // bound while the caller believed it had stopped.
        const racingStop = server.stop({ force: true });
        release.resolve();
        await inFlight.catch(() => {});
        await bounded(Promise.all([parking, restarting, racingStop]));

        assertEquals(
          server.port,
          undefined,
          'racing stop must close the restarted listener',
        );

        // The raced restart must not wedge the services for a later start.
        await bounded(server.start());
        actualPort = requirePort(server);
        const after = await fetch(`${clientOrigin(server)}/x`, {
          headers: { connection: 'close' },
        });
        assertEquals(after.status, 200, 'server must still start after race');
        await after.text();
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'Server.stop force interrupts a drain queued behind a restart',
    async (ctx) => {
      const serverPath = await ctx.tempDir('server-stop-force-race');
      let actualPort = 0;
      const server = await createStopTestServer(
        serverPath,
        new DataRegistry(),
        () => actualPort,
      );
      const started = deferred();
      const release = deferred();
      server.registerEndpoint({
        filter() {
          return true;
        },
        async processRequest() {
          started.resolve();
          await release.promise;
          return new Response('late');
        },
      });
      try {
        await server.start();
        actualPort = requirePort(server);
        const inFlight = fetch(`${clientOrigin(server)}/x`, {
          headers: { connection: 'close' },
        });
        void inFlight.catch(() => {});
        await bounded(started.promise);

        // The restart queues the forced stop behind the graceful teardown.
        const parking = server.stop({ timeoutMs: 30_000 });
        const restarting = server.start();
        // WHY: the handler stays pending, so force must escalate now instead
        // of waiting for the restart queue to reach it.
        await bounded(server.stop({ force: true }), 2000);
        assertEquals(
          server.port,
          undefined,
          'the forced stop must close the restarted listener',
        );
        await expectRejected(inFlight);
        await bounded(Promise.all([parking, restarting]));
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'ALB health check matches parsed host and path',
    async (ctx) => {
      const serverPath = await ctx.tempDir('server-health');
      let resolvedUrl: string | undefined;
      const server = await createStopTestServer(
        serverPath,
        new DataRegistry(),
        () => 0,
        (url) => {
          resolvedUrl = url;
          return 'localhost';
        },
      );
      const info = {
        remoteAddr: { hostname: 'localhost' },
        completed: Promise.resolve(),
      };
      // WHY: Request normalizes host case and drops default ports. Mutate the
      // normalized URL so the check sees the string Node builds from Host.
      const requestFor = (url: string) => {
        const req = new GoatRequest(new Request('http://placeholder.invalid/'));
        req.url = url;
        return req;
      };
      try {
        await server.start();
        const cases: Array<{ url: string; status: number; resolved?: string }> =
          [
            { url: 'http://AWSALB:80/healthy?probe=1', status: 200 },
            { url: 'http://awsalb:8080/healthy', status: 200 },
            { url: 'https://awsalb/healthy', status: 200 },
            {
              url: 'http://awsalb/HEALTHY',
              status: 404,
              resolved: 'http://awsalb/HEALTHY',
            },
            {
              url: 'http://otherhost/healthy',
              status: 404,
              resolved: 'http://otherhost/healthy',
            },
            {
              url: 'http://awsalb/healthy/',
              status: 404,
              resolved: 'http://awsalb/healthy/',
            },
            {
              url: 'http://awsalb/not-healthy',
              status: 404,
              resolved: 'http://awsalb/not-healthy',
            },
            {
              url: 'not a valid url',
              status: 404,
              resolved: 'not a valid url',
            },
          ];
        for (const { url, status, resolved } of cases) {
          resolvedUrl = undefined;
          const response = await server.processRequest(requestFor(url), info);
          assertEquals(response.status, status, url);
          assertEquals(resolvedUrl, resolved, `resolution for ${url}`);
        }
      } finally {
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'a pre-aborted start signal leaves no listener',
    async () => {
      const server = createHttpServer();
      const ac = new AbortController();
      try {
        ac.abort();
        await bounded(server.start(
          () => Promise.resolve(new Response('ok')),
          0,
          ac.signal,
        ));
        assertEquals(
          server.port,
          undefined,
          'a pre-aborted signal must release the port at once',
        );
        assertEquals(
          server.address,
          undefined,
          'a pre-aborted signal must release the address at once',
        );
        await bounded(server.stop());
        await bounded(server.start(
          () => Promise.resolve(new Response('ok')),
          0,
        ));
        const response = await bounded(request(server));
        assertEquals(await response.text(), 'ok');
      } finally {
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'awaitPendingStop clears the slot when teardown rejects',
    async () => {
      const failure = new Error('teardown failed');
      let cleared = false;
      let outcome: unknown;
      try {
        await awaitPendingStop(Promise.reject(failure), () => {
          cleared = true;
        });
      } catch (error) {
        outcome = error;
      }
      assertTrue(cleared, 'a rejected teardown must clear the pending slot');
      assertTrue(outcome === failure, 'the teardown error must propagate');
    },
  );

  TEST(
    'HttpServerStop',
    'Server.stop force escalates an in-flight stop',
    async (ctx) => {
      const serverPath = await ctx.tempDir('server-stop-force');
      let actualPort = 0;
      const server = await createStopTestServer(
        serverPath,
        new DataRegistry(),
        () => actualPort,
      );
      const started = deferred();
      const release = deferred();
      server.registerEndpoint({
        filter() {
          return true;
        },
        async processRequest() {
          started.resolve();
          await release.promise;
          return new Response('late');
        },
      });
      try {
        await server.start();
        actualPort = requirePort(server);
        const pending = fetch(`${clientOrigin(server)}/x`, {
          headers: { connection: 'close' },
        });
        void pending.catch(() => {});
        await started.promise;

        const graceful = server.stop();
        const forced = server.stop({ force: true });
        await bounded(Promise.all([graceful, forced]));
        await expectRejected(pending);
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'restart ignores the previous start signal and honors the current one',
    async () => {
      const server = createHttpServer();
      const stale = new AbortController();
      const fresh = new AbortController();
      try {
        await server.start(
          () => Promise.resolve(new Response('ok')),
          0,
          stale.signal,
        );
        await server.stop();
        await server.start(
          () => Promise.resolve(new Response('ok')),
          0,
          fresh.signal,
        );
        const port = requirePort(server);
        stale.abort();
        // Abort dispatch is synchronous. The stale listener must not stop the
        // restart, so the port stays bound.
        assertEquals(
          server.port,
          port,
          'stale signal must not stop the restart',
        );
        const response = await bounded(request(server));
        assertEquals(await response.text(), 'ok');
        fresh.abort();
        assertEquals(
          server.port,
          undefined,
          'the current signal must stop the restarted listener',
        );
      } finally {
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'aborting the start signal alone releases the listener',
    async () => {
      const server = createHttpServer();
      const ac = new AbortController();
      try {
        await server.start(
          () => Promise.resolve(new Response('ok')),
          0,
          ac.signal,
        );
        const port = requirePort(server);
        ac.abort();
        const rebound = await rebind(port);
        try {
          assertEquals(server.port, undefined, 'abort must clear the port');
        } finally {
          await rebound.stop({ force: true });
        }
      } finally {
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'lifecycle gate runs ops in call order',
    async () => {
      const gate = new StartStopGate();
      const order: string[] = [];
      const releaseStop = deferred();
      const started = gate.start(() => {
        order.push('start');
        return Promise.resolve();
      });
      const stopping = gate.stop(async () => {
        order.push('stop:begin');
        await releaseStop.promise;
        order.push('stop:end');
      });
      await started;
      // WHY: this start lands while the stop is pending. It must wait for the
      // teardown, otherwise it binds a listener the pending stop never sees.
      const restarting = gate.start(() => {
        order.push('restart');
        return Promise.resolve();
      });
      releaseStop.resolve();
      await Promise.all([stopping, restarting]);
      assertEquals(order.join(','), 'start,stop:begin,stop:end,restart');
    },
  );

  TEST(
    'HttpServerStop',
    'lifecycle gate runs the next op after a rejection',
    async () => {
      const gate = new StartStopGate();
      const failure = new Error('teardown failed');
      let ran = false;
      const failing = gate.stop(() => Promise.reject(failure));
      const next = gate.stop(() => {
        ran = true;
        return Promise.resolve();
      });
      const outcome = await failing.then(() => 'resolved', () => 'rejected');
      assertEquals(outcome, 'rejected', 'the failing op must report its error');
      await next;
      assertTrue(ran, 'a rejected op must not block the queue');
    },
  );

  TEST(
    'HttpServerStop',
    'invalid drain budgets are rejected and leave the listener bound',
    async () => {
      const server = createHttpServer();
      try {
        await server.start(() => Promise.resolve(new Response('ok')), 0);
        const port = requirePort(server);
        const invalid = [
          MAX_STOP_TIMEOUT_MS + 1,
          -1,
          Number.NaN,
          1.5,
          Number.POSITIVE_INFINITY,
        ];
        for (const timeoutMs of invalid) {
          const outcome = await server.stop({ timeoutMs }).then(
            () => 'resolved',
            (error: unknown) => error,
          );
          assertTrue(
            outcome instanceof RangeError,
            `timeoutMs ${timeoutMs} must reject with a RangeError`,
          );
        }
        assertEquals(
          server.port,
          port,
          'a rejected budget must leave the listener bound',
        );
        const response = await bounded(request(server));
        assertEquals(await response.text(), 'ok', 'server must still serve');
      } finally {
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'the maximum drain budget still waits for an active request',
    async () => {
      const server = createHttpServer();
      const started = deferred();
      const release = deferred();
      try {
        await server.start(async () => {
          started.resolve();
          await release.promise;
          return new Response('ok');
        }, 0);
        const pending = request(server);
        void pending.catch(() => {});
        await bounded(started.promise);
        // WHY the max budget: a 32-bit timer overflow would fire in about a
        // millisecond and cut this request instead of waiting for it.
        const stopping = server.stop({ timeoutMs: MAX_STOP_TIMEOUT_MS });
        release.resolve();
        const response = await bounded(pending);
        assertEquals(await response.text(), 'ok');
        await bounded(stopping);
        assertEquals(server.port, undefined, 'stop must close the listener');
      } finally {
        release.resolve();
        await server.stop({ force: true });
      }
    },
  );

  TEST('HttpServerStop', 'a zero drain budget is valid', async () => {
    const server = createHttpServer();
    try {
      await server.start(() => Promise.resolve(new Response('ok')), 0);
      await bounded(server.stop({ timeoutMs: 0 }));
      assertEquals(server.port, undefined, 'stop must close the listener');
    } finally {
      await server.stop({ force: true });
    }
  });

  TEST(
    'HttpServerStop',
    'Server.stop rejects an invalid drain budget before touching state',
    async (ctx) => {
      const serverPath = await ctx.tempDir('server-stop-budget');
      let actualPort = 0;
      const server = await createStopTestServer(
        serverPath,
        new DataRegistry(),
        () => actualPort,
      );
      server.registerEndpoint({
        filter: () => true,
        processRequest: () => Promise.resolve(new Response('ok')),
      });
      try {
        await server.start();
        actualPort = requirePort(server);
        const outcome = await server.stop({ timeoutMs: -1 }).then(
          () => 'resolved',
          (error: unknown) => error,
        );
        assertTrue(
          outcome instanceof RangeError,
          'an invalid budget must reject with a RangeError',
        );
        assertEquals(
          server.port,
          actualPort,
          'a rejected budget must leave the server bound',
        );
        const response = await bounded(fetch(
          `${clientOrigin(server)}/x`,
          { headers: { connection: 'close' } },
        ));
        assertEquals(response.status, 200, 'server must still serve');
        await response.text();
      } finally {
        await server.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'a bind failure reports the error and leaves the port free to retry',
    async () => {
      const holder = createHttpServer();
      const contender = createHttpServer();
      const ok = () => Promise.resolve(new Response('ok'));
      try {
        await holder.start(ok, 0);
        const port = requirePort(holder);
        const outcome = await contender.start(ok, port).then(
          () => 'resolved',
          (error: unknown) => error,
        );
        assertTrue(
          isAddressInUse(outcome),
          `the second bind must reject with a busy-port error, got ${outcome}`,
        );
        assertEquals(
          contender.port,
          undefined,
          'a failed bind must expose no port',
        );
        assertEquals(
          contender.address,
          undefined,
          'a failed bind must expose no address',
        );

        await holder.stop({ force: true });
        // WHY: retry on the same instance proves the failed bind left no
        // half-open listener or stale error handler behind.
        await startWhenFree(contender, port);
        assertEquals(contender.port, port, 'the retry must bind the port');
        const response = await bounded(request(contender));
        assertEquals(await response.text(), 'ok');
      } finally {
        await holder.stop({ force: true });
        await contender.stop({ force: true });
      }
    },
  );

  TEST(
    'HttpServerStop',
    'Server.start rolls back when the listener cannot bind',
    async (ctx) => {
      const contenderPath = await ctx.tempDir('server-start-rollback');
      const holder = createHttpServer();
      let contenderPort = 0;
      await holder.start(() => Promise.resolve(new Response('busy')), 0);
      const port = requirePort(holder);
      // WHY: constructed on the busy port, so start() hits the real bind path.
      const contender = await createStopTestServer(
        contenderPath,
        new DataRegistry(),
        () => contenderPort,
        () => 'localhost',
        port,
      );
      contenderPort = port;
      contender.registerEndpoint({
        filter: () => true,
        processRequest: () => Promise.resolve(new Response('ok')),
      });
      try {
        const outcome = await contender.start().then(
          () => 'resolved',
          (error: unknown) => error,
        );
        assertTrue(
          isAddressInUse(outcome),
          `start must surface the bind error, got ${outcome}`,
        );
        assertEquals(
          contender.port,
          undefined,
          'a failed start must expose no port',
        );

        await holder.stop({ force: true });
        // WHY: a half-committed start used to make this retry a no-op, so the
        // server reported success while nothing listened.
        await contender.start();
        const response = await bounded(fetch(
          `${clientOrigin(contender)}/x`,
          { headers: { connection: 'close' } },
        ));
        assertEquals(response.status, 200, 'the retry must serve');
        await response.text();
      } finally {
        await holder.stop({ force: true });
        await contender.stop({ force: true });
      }
    },
  );
}
