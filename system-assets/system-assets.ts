import { encodeBase64 } from '@std/encoding/base64';
import { decodeBase64 } from '../base/buffer.ts';
import type { JSONObject, ReadonlyJSONObject } from '../base/interfaces.ts';
import { type ContentType } from './content-type.ts';
import kEncodedSystemAssets from './assets.json' with {
  type: 'json',
};

export type { ContentType } from './content-type.ts';

/** @group Static Assets */
export interface Asset {
  data: Uint8Array;
  contentType: ContentType;
}

/** @group Static Assets */
export type StaticAssets = Record<string, Asset>;

/** @group Static Assets */
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

/** @group Static Assets */
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

export const kStaticAssetsSystem = staticAssetsFromJS(kEncodedSystemAssets);
