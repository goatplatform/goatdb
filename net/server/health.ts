import { Endpoint, ServerServices } from './server.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import { GoatRequest, ServeHandlerInfo } from './http-compat.ts';

export class HealthCheckEndpoint<US extends Schema, Addr = { hostname: string }>
  implements Endpoint<US> {
  filter(
    server: ServerServices<US>,
    req: GoatRequest,
    info: ServeHandlerInfo,
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
    info: ServeHandlerInfo,
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
