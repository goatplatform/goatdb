import { exists, walk } from '@std/fs';
import { extname } from '@std/path';
import type { Endpoint, ServerServices } from './server.ts';
import { getRequestPath } from './utils.ts';
import {
  type Asset,
  type ContentType,
  kStaticAssetsSystem,
} from '../../system-assets/system-assets.ts';

export const APP_ENTRY_POINT = 'web-app';

const STATIC_ASSETS_CACHE_DURATION_SEC = 86400;

const ContentTypeMapping: Record<string, ContentType> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  json: 'application/json',
  js: 'text/javascript',
  ts: 'text/javascript',
  html: 'text/html',
  css: 'text/css',
  wasm: 'application/wasm',
};

export class StaticAssetsEndpoint implements Endpoint {
  filter(
    _services: ServerServices,
    req: Request,
    _info: Deno.ServeHandlerInfo,
  ): boolean {
    return req.method === 'GET';
  }

  processRequest(
    services: ServerServices,
    req: Request,
    _info: Deno.ServeHandlerInfo,
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
    };
    if (asset.contentType.startsWith('image/')) {
      headers[
        'cache-control'
      ] = `Cache-Control: public, max-age=${STATIC_ASSETS_CACHE_DURATION_SEC}`;
    }
    return Promise.resolve(
      new Response(asset.data, {
        headers,
      }),
    );
  }
}

export async function compileAssetsDirectory(
  dir: string,
  filter?: (path: string) => boolean,
  prefix?: string,
): Promise<Record<string, Asset>> {
  const result: Record<string, Asset> = {};
  if (!(await exists(dir))) {
    return result;
  }
  for await (
    const { path } of walk(dir, {
      includeDirs: false,
      includeSymlinks: false,
      followSymlinks: false,
    })
  ) {
    if (filter && !filter(path)) {
      continue;
    }
    const origExt = extname(path);
    let ext = origExt.substring(1);
    if (ext === 'ts') {
      ext = 'js';
    }
    let key = path.substring(dir.length).toLowerCase();
    // Rewrite extension to match
    key = key.substring(0, key.length - origExt.length) + '.' + ext;
    if (prefix) {
      key = `${prefix}${key}`;
    }
    result[key] = {
      data: await Deno.readFile(path),
      contentType: ContentTypeMapping[ext] || 'application/octet-stream',
    };
  }
  return result;
}
