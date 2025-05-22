import type { Endpoint, Middleware, ServerServices } from './server.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import { GoatRequest } from './http-compat.ts';
import type { ServeHandlerInfo } from './http-compat.ts';

export class CORSMiddleware<US extends Schema> implements Middleware<US> {
  didProcess(
    services: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
    resp: Response,
  ): Promise<Response> {
    resp.headers.set(
      'access-control-allow-origin',
      services.domain.resolveOrg(services.orgId),
    );
    resp.headers.set('access-control-allow-methods', req.method || '*');
    resp.headers.set('access-control-allow-headers', '*');
    return Promise.resolve(resp);
  }
}

export class CORSEndpoint<US extends Schema> implements Endpoint<US> {
  filter(
    _services: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
  ): boolean {
    return req.method === 'OPTIONS';
  }

  processRequest(
    _services: ServerServices<US>,
    _req: GoatRequest,
    _info: ServeHandlerInfo,
  ): Promise<Response> {
    return Promise.resolve(new Response(null));
  }
}
