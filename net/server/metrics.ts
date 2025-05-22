import { log, type LogStream } from '../../logging/log.ts';
import type { Middleware, ServerServices } from './server.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import type { GoatRequest, ServeHandlerInfo } from './http-compat.ts';

/**
 * Middleware that logs HTTP request metrics after processing.
 *
 * This middleware captures and logs HTTP status codes and request details
 * for monitoring and analytics purposes. It runs after request processing
 * is complete and logs metrics to the configured output streams.
 */
export class MetricsMiddleware<US extends Schema> implements Middleware<US> {
  /**
   * Creates a new metrics middleware instance.
   *
   * @param outputStreams - Optional array of log streams to write metrics to
   */
  constructor(readonly outputStreams?: readonly LogStream[]) {}

  /**
   * Logs HTTP request metrics after the request has been processed.
   *
   * @param services - Server services for the current organization
   * @param req - The HTTP request that was processed
   * @param _info - Server handler info (unused)
   * @param resp - The HTTP response that was generated
   * @returns The original response unchanged
   */
  didProcess(
    services: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
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
