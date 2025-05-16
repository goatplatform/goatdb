import { log, type LogStream } from '../../logging/log.ts';
import type { Middleware, ServerServices } from './server.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import type { GoatRequest } from './http-compat.ts';

export class MetricsMiddleware<US extends Schema> implements Middleware<US> {
  constructor(readonly outputStreams?: readonly LogStream[]) {}

  didProcess(
    services: ServerServices<US>,
    req: GoatRequest,
    _info: Deno.ServeHandlerInfo,
    resp: Response,
  ): Promise<Response> {
    log(
      {
        severity: 'METRIC',
        name: 'HttpStatusCode',
        unit: 'Count',
        value: resp.status,
        url: req.url,
        method: req.method,
        orgId: services.orgId,
      },
      this.outputStreams,
    );
    return Promise.resolve(resp);
  }
}

// export class PrometheusMetricsEndpoint<US extends Schema>
//   implements Endpoint<US> {
//   filter(
//     services: ServerServices<US>,
//     req: GoatRequest,
//     info: Deno.ServeHandlerInfo,
//   ): boolean {
//     if (req.method !== 'GET') {
//       return false;
//     }
//     return getRequestPath(req) === '/metrics';
//   }

//   processRequest(
//     services: ServerServices<US>,
//     req: GoatRequest,
//     info: Deno.ServeHandlerInfo,
//   ): Promise<Response> {
//     const logStream = services.prometheusLogStream;
//     const metrics = logStream.getMetrics();
//     return Promise.resolve(
//       new Response(metrics, {
//         headers: {
//           'content-type': 'text/plain; version=0.0.4; charset=utf-8',
//         },
//       }),
//     );
//   }
// }
