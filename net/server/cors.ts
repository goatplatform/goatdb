import type { Endpoint, Middleware, ServerServices } from './server.ts';

export class CORSMiddleware implements Middleware {
  didProcess(
    services: ServerServices,
    req: Request,
    _info: Deno.ServeHandlerInfo,
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

export class CORSEndpoint implements Endpoint {
  filter(
    _services: ServerServices,
    req: Request,
    _info: Deno.ServeHandlerInfo,
  ): boolean {
    return req.method === 'OPTIONS';
  }

  processRequest(
    _services: ServerServices,
    _req: Request,
    _info: Deno.ServeHandlerInfo,
  ): Promise<Response> {
    return Promise.resolve(new Response(null));
  }
}
