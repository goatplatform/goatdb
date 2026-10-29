import type { MinimalHttpServer } from '../net/server/http-compat.ts';
import { assertExists } from './asserts.ts';

/** Capture before stop(): the public address clears when shutdown starts. */
export function clientOrigin(
  server: Pick<MinimalHttpServer, 'address'>,
): string {
  const address = server.address;
  assertExists(address, 'Started server must expose its listener address');
  // Match the bound family: IPv6 avoids foreign IPv4 SO_REUSEADDR listeners
  // on macOS, while IPv4-only hosts must not be sent to IPv6 loopback.
  const host = address.hostname.includes(':')
    ? `[${address.hostname === '::' ? '::1' : address.hostname}]`
    : '127.0.0.1';
  return `http://${host}:${address.port}`;
}
