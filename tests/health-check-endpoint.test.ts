import { HealthCheckEndpoint, kHealthCheckPath } from '../net/server/health.ts';
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import type { Schema } from '../cfds/base/schema.ts';
import type { ServerServices } from '../net/server/server.ts';
import {
  GoatRequest,
  type ServeHandlerInfo,
} from '../net/server/http-compat.ts';

export default function setupHealthCheckEndpointTest(): void {
  // Minimal test schema
  const TestSchema: Schema = {
    ns: 'test',
    version: 1,
    fields: { foo: { type: 'string', required: true } },
  };

  function makeServices(): ServerServices<Schema> {
    return {
      orgId: 'test-org',
      domain: {
        resolveOrg: (orgId: string) => `http://localhost/${orgId}`,
        resolveDomain: (url: string) => {
          try {
            const u = new URL(url);
            return u.hostname === 'localhost' ? 'test-org' : '';
          } catch {
            return '';
          }
        },
      },
      // This endpoint does not read database or service state.
    } as unknown as ServerServices<Schema>;
  }

  function makeRequest(path: string, method = 'GET'): GoatRequest {
    return new GoatRequest(new Request(`http://localhost${path}`, { method }));
  }

  function makeInfo(): ServeHandlerInfo {
    return {
      remoteAddr: { hostname: 'localhost' },
      completed: Promise.resolve(),
    };
  }

  TEST(
    'HealthCheckEndpoint',
    'GET /healthy returns 200 OK and OK body',
    async () => {
      const endpoint = new HealthCheckEndpoint<typeof TestSchema>();
      const services = makeServices();
      const req = makeRequest('/healthy', 'GET');
      const info = makeInfo();
      assertTrue(endpoint.filter(services, req, info));
      const resp = await endpoint.processRequest(services, req, info);
      assertEquals(resp.status, 200);
      assertEquals(await resp.text(), 'OK');
      assertEquals(resp.headers.get('cache-control'), 'no-store');
    },
  );

  TEST('HealthCheckEndpoint', 'filter rejects non-GET methods', () => {
    const endpoint = new HealthCheckEndpoint<typeof TestSchema>();
    const services = makeServices();
    const info = makeInfo();
    const postReq = makeRequest('/healthy', 'POST');
    assertTrue(!endpoint.filter(services, postReq, info));
    const putReq = makeRequest('/healthy', 'PUT');
    assertTrue(!endpoint.filter(services, putReq, info));
  });

  TEST('HealthCheckEndpoint', 'filter rejects wrong path', () => {
    const endpoint = new HealthCheckEndpoint<typeof TestSchema>();
    const services = makeServices();
    const info = makeInfo();
    const req = makeRequest('/not-healthy', 'GET');
    assertTrue(!endpoint.filter(services, req, info));
  });

  TEST('HealthCheckEndpoint', 'filter is case-insensitive for path', () => {
    const endpoint = new HealthCheckEndpoint<typeof TestSchema>();
    const services = makeServices();
    const info = makeInfo();
    const req = makeRequest('/HeAlThY', 'GET');
    assertTrue(endpoint.filter(services, req, info));
  });

  TEST(
    'HealthCheckEndpoint',
    'filter accepts the shared constant regardless of its literal case',
    () => {
      const endpoint = new HealthCheckEndpoint<typeof TestSchema>();
      const services = makeServices();
      const info = makeInfo();
      const req = makeRequest(kHealthCheckPath.toUpperCase(), 'GET');
      assertTrue(endpoint.filter(services, req, info));
    },
  );
}
