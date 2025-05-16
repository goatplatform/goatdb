import type { ServerServices } from './server.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import { GoatRequest } from './http-compat.ts';

export function getRequestPath<T extends string = string>(req: GoatRequest): T {
  return new URL(req.url).pathname.toLowerCase() as T;
}

/**
 * Returns the base URL for the current application.
 *
 * @param services The services of the current server instance.
 * @returns A fully qualified base URL.
 */
export function getBaseURL<US extends Schema>(
  services: ServerServices<US>,
): string {
  if (services.buildInfo.debugBuild) {
    return 'http://localhost:8080';
  }
  return services.domain.resolveOrg(services.db.orgId);
}
