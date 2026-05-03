/** @group Static Assets */
export type ContentType =
  | 'image/svg+xml'
  | 'image/png'
  | 'image/jpeg'
  | 'application/json'
  | 'text/javascript'
  | 'text/html'
  | 'text/css'
  | 'application/wasm'
  | 'application/octet-stream'
  | 'font/woff'
  | 'font/woff2'
  | 'font/ttf'
  | 'image/gif'
  | 'image/webp';

export const ContentTypeMapping: Record<string, ContentType> = {
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
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  gif: 'image/gif',
  webp: 'image/webp',
};
