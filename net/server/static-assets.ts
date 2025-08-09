import type { Endpoint, ServerServices } from './server.ts';
import { getRequestPath } from './utils.ts';
import { kStaticAssetsSystem } from '../../system-assets/system-assets.ts';
import { getGoatConfig } from '../../server/config.ts';
import type { VersionNumber } from '../../base/version-number.ts';
import type { GoatRequest } from './http-compat.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import type { ServeHandlerInfo } from './http-compat.ts';

export const APP_ENTRY_POINT = 'web-app';

const STATIC_ASSETS_CACHE_DURATION_SEC = 86400;

/**
 * Endpoint handler for serving static assets.
 *
 * This endpoint handles GET requests for static files like JavaScript bundles,
 * images, and HTML files. It supports both system assets and organization-specific
 * assets, with special handling for the main app bundle to inject configuration.
 */
export class StaticAssetsEndpoint<US extends Schema> implements Endpoint<US> {
  /**
   * Filters requests to only process GET methods.
   */
  filter(
    _services: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
  ): boolean {
    return req.method === 'GET';
  }

  /**
   * Processes requests for static assets.
   *
   * Handles the following cases:
   * - Returns 404 if no static assets are configured
   * - Looks up assets in system assets first, then org-specific assets
   * - Falls back to index.html if no specific asset is found
   * - Adds caching headers for image assets
   * - Injects configuration into the main app bundle
   */
  processRequest(
    services: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
  ): Promise<Response> {
    if (!services.staticAssets) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    const path = getRequestPath(req);
    const asset =
      kStaticAssetsSystem[path as keyof typeof kStaticAssetsSystem] ||
      services.staticAssets[path] || services.staticAssets['/index.html'];

    if (!asset) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    const headers: Record<string, string> = {
      'content-type': asset.contentType,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    };
    if (asset.contentType.startsWith('image/')) {
      headers[
        'cache-control'
      ] = `Cache-Control: public, max-age=${STATIC_ASSETS_CACHE_DURATION_SEC}`;
    }

    // Dynamically inject the config into the main app bundle
    if (path.endsWith('/app.js')) {
      const js = new TextDecoder().decode(asset.data);
      const config = generateConfigSnippet(
        getGoatConfig().version,
        services.domain.resolveOrg(services.orgId),
        services.orgId,
        getGoatConfig().debug,
        services.customConfig, // Pass custom config for injection
      );
      return Promise.resolve(
        new Response(config + js, {
          headers,
        }),
      );
    }

    return Promise.resolve(
      new Response(asset.data, {
        headers,
      }),
    );
  }
}

/**
 * Generates a JavaScript configuration snippet for the client-side application.
 *
 * This function creates a configuration object that is injected into the main
 * application bundle. It includes essential runtime configuration like version,
 * organization ID, and server URL, while removing sensitive server-side data.
 *
 * @param version - The current version number of the application
 * @param serverURL - The base URL of the server for this organization
 * @param orgId - The organization identifier
 * @param debug - Whether debug mode is enabled
 * @returns A JavaScript snippet that assigns the configuration to GoatDBConfig
 */
function generateConfigSnippet(
  version: VersionNumber,
  serverURL: string,
  orgId: string,
  debug: boolean,
  customConfig?: Record<string, unknown>,
): string {
  const config = {
    ...getGoatConfig(),
    ...customConfig, // Merge custom config
    debug,
    version,
    orgId,
  };
  delete config.clientData;
  delete config.serverData;
  if (serverURL) {
    config.serverURL = serverURL;
  }
  return `;\nglobalThis.GoatDBConfig = ${JSON.stringify(config)};\n;`;
}
