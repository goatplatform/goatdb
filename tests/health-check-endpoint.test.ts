import { HealthCheckEndpoint } from '../net/server/health.ts';
import { TEST } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import type { Schema } from '../cfds/base/schema.ts';

export default function setupHealthCheckEndpointTest(): void {
  // Minimal test schema
  const TestSchema: Schema = {
    ns: 'test',
    version: 1,
    fields: { foo: { type: 'string', required: true } },
  };

  function makeServices(overrides: any = {}) {
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
      ...overrides,
    };
  }

  function makeRequest(path: string, method = 'GET') {
    return { method, url: `http://localhost${path}`, headers: new Headers() };
  }

  function makeInfo() {
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
      assertTrue(endpoint.filter(services as any, req as any, info as any));
      const resp = await endpoint.processRequest(
        services as any,
        req as any,
        info as any,
      );
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
    assertTrue(!endpoint.filter(services as any, postReq as any, info as any));
    const putReq = makeRequest('/healthy', 'PUT');
    assertTrue(!endpoint.filter(services as any, putReq as any, info as any));
  });

  TEST('HealthCheckEndpoint', 'filter rejects wrong path', () => {
    const endpoint = new HealthCheckEndpoint<typeof TestSchema>();
    const services = makeServices();
    const info = makeInfo();
    const req = makeRequest('/not-healthy', 'GET');
    assertTrue(!endpoint.filter(services as any, req as any, info as any));
  });

  TEST('HealthCheckEndpoint', 'filter is case-insensitive for path', () => {
    const endpoint = new HealthCheckEndpoint<typeof TestSchema>();
    const services = makeServices();
    const info = makeInfo();
    const req = makeRequest('/HeAlThY', 'GET');
    assertTrue(endpoint.filter(services as any, req as any, info as any));
  });
}
