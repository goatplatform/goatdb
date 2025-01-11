import { walk, exists } from '@std/fs';
import { extname } from '@std/path';
import { Endpoint, ServerServices } from './server.ts';
import { getRequestPath } from './utils.ts';
import { JSONObject, ReadonlyJSONObject } from '../../base/interfaces.ts';
import { decodeBase64, encodeBase64 } from '@std/encoding';

const STATIC_ASSETS_CACHE_DURATION_SEC = 86400;

// export const kEntryPointsNames = [APP_ENTRY_POINT, '__file_worker'] as const;
// export type EntryPointName = (typeof kEntryPointsNames)[number];
// export const EntryPointDefault: EntryPointName = APP_ENTRY_POINT;

// export const EntryPointIndex: Record<EntryPointName, string> = {
//   APP_ENTRY_POINT: 'src/index.tsx',
//   __file_worker: 'json-log.worker.ts',
// };

export const APP_ENTRY_POINT = 'web-app';

export type ContentType =
  | 'image/svg+xml'
  | 'image/png'
  | 'image/jpeg'
  | 'image/jpeg'
  | 'application/json'
  | 'text/javascript'
  | 'text/html'
  | 'text/css'
  | 'application/wasm';

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

const kValidFileExtensions = Object.keys(ContentTypeMapping);

export interface Asset {
  data: Uint8Array;
  contentType: ContentType;
}

export type StaticAssets = Record<string, Asset>;

export class StaticAssetsEndpoint implements Endpoint {
  filter(
    services: ServerServices,
    req: Request,
    info: Deno.ServeHandlerInfo,
  ): boolean {
    return req.method === 'GET';
  }

  processRequest(
    services: ServerServices,
    req: Request,
    info: Deno.ServeHandlerInfo,
  ): Promise<Response> {
    if (!services.staticAssets) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    const path = getRequestPath(req);
    const asset =
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
  prefix?: string,
): Promise<Record<string, Asset>> {
  const result: Record<string, Asset> = {};
  if (!(await exists(dir))) {
    return result;
  }
  for await (const { path } of walk(dir, {
    includeDirs: false,
    includeSymlinks: false,
    followSymlinks: false,
    exts: kValidFileExtensions,
  })) {
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

export function staticAssetsToJS(assets: StaticAssets): ReadonlyJSONObject {
  const result: JSONObject = {};
  for (const [path, asset] of Object.entries(assets)) {
    result[path] = {
      data: encodeBase64(asset.data),
      contentType: asset.contentType,
    };
  }
  return result;
}

export function staticAssetsFromJS(
  encodedAssets: ReadonlyJSONObject,
): StaticAssets {
  const result: StaticAssets = {};
  for (const [path, asset] of Object.entries(encodedAssets)) {
    result[path] = {
      data: decodeBase64((asset as ReadonlyJSONObject).data as string),
      contentType: (asset as ReadonlyJSONObject).contentType as ContentType,
    };
  }
  return result as StaticAssets;
}
