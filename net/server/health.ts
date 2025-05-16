import { Endpoint, ServerServices } from './server.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import { GoatRequest } from './http-compat.ts';

export class HealthCheckEndpoint<US extends Schema> implements Endpoint<US> {
  filter(
    server: ServerServices<US>,
    req: GoatRequest,
    info: Deno.ServeHandlerInfo,
  ): boolean {
    if (req.method !== 'GET') {
      return false;
    }
    const path = new URL(req.url).pathname.toLowerCase();
    return path === '/healthy';
  }

  processRequest(
    server: ServerServices<US>,
    req: GoatRequest,
    info: Deno.ServeHandlerInfo,
  ): Promise<Response> {
    return Promise.resolve(
      new Response('OK', {
        status: 200,
        headers: {
          'Cache-control': 'no-store',
        },
      }),
    );
  }
}
