---
id: server-logic
title: Server-Side Logic
sidebar_position: 11
slug: /server-logic
---

# Server-Side Logic

Server-side logic lets you add custom HTTP endpoints and middleware to the GoatDB server for webhooks, integrations, and request processing that must run server-side.

## When to Use Server-Side Logic

Most application logic in GoatDB runs on every peer through [authorization rules](/docs/authorization) and [schemas](/docs/schema). Reserve server-side logic for things that *must* happen on the server:

| Need | Solution | Why |
|------|----------|-----|
| Access control | [Authorization rules](/docs/authorization) | Runs on every peer |
| Data validation | [Schema](/docs/schema) | Enforced everywhere |
| Webhook receivers | Server endpoint | External services need a stable URL |
| Request filtering/logging | Server middleware | Only the server sees raw HTTP |
| Background data processing | Server setup | Needs trusted DB access |

:::tip

Prefer authorization rules and schema validation over server-side logic. They run on every peer and don't require a server round-trip.

:::

## The Request Pipeline

When the server receives an HTTP request, it processes it through this pipeline:

1. **Domain resolution** — The server maps the request hostname to an organization ID.
2. **Service lookup** — A [ServerServices](/api/GoatDB/Server/interfaces/ServerServices) instance is created or retrieved for that organization, providing `db`, `logger`, `email`, and configuration.
3. **Endpoint matching** — Endpoints are checked in registration order. The first endpoint whose `filter()` returns `true` handles the request.
4. **Middleware `shouldProcess()`** — Before the matched endpoint runs, each middleware's `shouldProcess()` is called. If any returns a `Response`, it short-circuits the endpoint.
5. **Endpoint `processRequest()`** — The matched endpoint produces a `Response`.
6. **Middleware `didProcess()`** — Each middleware's `didProcess()` can inspect or replace the response.
7. **Response** — The final response is sent to the client.

If no endpoint matches, `shouldProcess()` is skipped and `didProcess()` runs on the default 404 response.

:::info Default endpoints

GoatDB registers built-in endpoints for health checks, authentication, sync, CORS, and static assets **before** any user-registered endpoints. Since the first matching `filter()` wins, your endpoints cannot shadow these defaults. To take full control, pass `disableDefaultEndpoints: true` in [ServerOptions](/api/GoatDB/Server/interfaces/ServerOptions).

:::

## Writing an Endpoint

An endpoint implements [Endpoint](/api/GoatDB/Server/interfaces/Endpoint) with two methods: `filter` decides whether to handle a request, and `processRequest` produces the response.

The examples below use these application schemas. Replace them with your own:

```typescript
import { DataRegistry } from '@goatdb/goatdb';

const kUserSchema = {
  ns: 'user',
  version: 1,
  fields: {
    name: { type: 'string', required: true },
  },
} as const;

const kEventSchema = {
  ns: 'event',
  version: 1,
  fields: {
    type: { type: 'string', required: true },
    data: { type: 'richtext' },
  },
} as const;

DataRegistry.default.registerSchema(kUserSchema);
DataRegistry.default.registerSchema(kEventSchema);
```

The generic parameter on `Endpoint<US>` and `Middleware<US>` is the **user schema** — the same schema type passed to `Server<US>`. It flows through to `ServerServices<US>` so your endpoints get type-safe access to user data.

This example receives a webhook POST, parses the JSON body, and writes to GoatDB:

```typescript
import type { Endpoint, GoatRequest, ServeHandlerInfo, ServerServices } from '@goatdb/goatdb/server';

class WebhookEndpoint implements Endpoint<typeof kUserSchema> {
  filter(
    _services: ServerServices<typeof kUserSchema>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
  ): boolean {
    return req.method === 'POST' &&
      new URL(req.url).pathname === '/api/webhook';
  }

  async processRequest(
    services: ServerServices<typeof kUserSchema>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
  ): Promise<Response> {
    const payload = await req.json();
    const db = services.db;
    db.create('/data/events/new', kEventSchema, {
      type: payload.type,
      data: payload.data,
    });
    await db.flushAll();
    return new Response('OK', { status: 200 });
  }
}
```

:::tip Error handling

Return explicit `Response` objects for controlled HTTP errors (e.g., `new Response('Forbidden', { status: 403 })`). Unhandled exceptions produce a generic `500 Internal Server Error`.

:::

## Writing Middleware

A middleware implements [Middleware](/api/GoatDB/Server/interfaces/Middleware). Both methods are optional — implement only the hooks you need.

This example logs every request after processing:

```typescript
import type { Middleware, ServerServices } from '@goatdb/goatdb/server';
import type { GoatRequest, ServeHandlerInfo } from '@goatdb/goatdb/server';

class LoggingMiddleware implements Middleware<typeof kUserSchema> {
  didProcess(
    services: ServerServices<typeof kUserSchema>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
    resp: Response,
  ): Promise<Response> {
    console.log(`${req.method} ${req.url} → ${resp.status}`);
    return Promise.resolve(resp);
  }
}
```

A `shouldProcess` middleware can short-circuit requests. Return a `Response` to block the request, or `undefined` to let it through:

```typescript
class ApiKeyMiddleware implements Middleware<typeof kUserSchema> {
  async shouldProcess(
    _services: ServerServices<typeof kUserSchema>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
  ): Promise<Response | undefined> {
    if (new URL(req.url).pathname.startsWith('/api/')) {
      const apiKey = Deno.env.get('API_KEY');
      if (!apiKey || req.headers.get('x-api-key') !== apiKey) {
        return new Response('Unauthorized', { status: 401 });
      }
    }
    return undefined; // Continue to endpoint
  }
}
```

## Registering with the Server

### Production

In your server entry point, register endpoints and middleware on the [Server](/api/GoatDB/Server/classes/Server) instance before calling `start()`:

```typescript
import { Server } from '@goatdb/goatdb/server';

const server = new Server({
  // ... your server options
});

// Register before start()
server.registerEndpoint(new WebhookEndpoint());
server.registerMiddleware(new LoggingMiddleware());

await server.start();
```

### Development with startDebugServer

When using [`startDebugServer`](/api/GoatDB/Server/Build/functions/startDebugServer), use the `setup` callback. It runs after the database is initialized but before HTTP listening begins:

```typescript
import { startDebugServer } from '@goatdb/goatdb/server/build';

await startDebugServer({
  path: 'server-data',
  buildDir: 'build',
  jsPath: 'client/main.tsx',
  setup(server) {
    server.registerEndpoint(new WebhookEndpoint());
    server.registerMiddleware(new LoggingMiddleware());
  },
});
```

:::warning

Register endpoints and middleware before `start()` (or inside the `setup` callback). Registration order determines evaluation order.

:::

## Accessing Server Services

Every endpoint and middleware method receives a [ServerServices](/api/GoatDB/Server/interfaces/ServerServices) object. Key properties:

| Property | Type | Description |
|----------|------|-------------|
| `services.db` | [GoatDB](/api/GoatDB/classes/GoatDB) | Fully initialized database instance |
| `services.orgId` | `string` | The resolved organization ID |
| `services.logger` | `Logger` | Server logger |
| `services.domain` | `DomainConfig` | Domain and organization configuration |
| `services.email` | `EmailService<US>` | Email sending service |

The `db` instance is ready to use — no need to call `readyPromise()`. All [ServerOptions](/api/GoatDB/Server/interfaces/ServerOptions) properties are also available on the services object.
