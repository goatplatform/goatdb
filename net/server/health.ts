import type { Endpoint, ServerServices } from './server.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import type { GoatRequest, ServeHandlerInfo } from './http-compat.ts';

/**
 * Endpoint that handles health check requests.
 *
 * This endpoint responds to GET requests at /healthy with a 200 OK response
 * to indicate the server is running and healthy. It's commonly used by
 * load balancers and monitoring systems to verify server availability.
 *
 * @template US - The user schema type
 */
export class HealthCheckEndpoint<US extends Schema> implements Endpoint<US> {
  filter(
    _server: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
  ): boolean {
    if (req.method !== 'GET') {
      return false;
    }
    const path = new URL(req.url).pathname.toLowerCase();
    return path === '/healthy';
  }

  processRequest(
    _server: ServerServices<US>,
    _req: GoatRequest,
    _info: ServeHandlerInfo,
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
