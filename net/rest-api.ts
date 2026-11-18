import {
  decodeSession,
  type EncodedSession,
  generateRequestSignature,
  type OwnedSession,
  type Session,
  signData,
} from '../db/session.ts';
import { kSecondMs } from '../base/date.ts';
import type { JSONValue, ReadonlyJSONObject } from '../base/interfaces.ts';
import { serviceUnavailable, timeout } from '../cfds/base/errors.ts';
import { getGoatConfig } from '../base/config.ts';
import { getCrypto } from '../base/common.ts';

export async function createNewSession(
  publicKey: CryptoKey,
  serverUrl?: string,
): Promise<[Session | undefined, Session[] | undefined]> {
  try {
    const url = serverUrl ? `${serverUrl}/auth/session` : '/auth/session';
    const resp = await sendJSONToURL(url, undefined, {
      publicKey: (await getCrypto().subtle.exportKey(
        'jwk',
        publicKey,
      )) as ReadonlyJSONObject,
    });
    if (resp.status !== 200) {
      return [undefined, undefined];
    }
    const body = JSON.parse(resp.body) as ReadonlyJSONObject;
    const encodedRoots = body.roots as EncodedSession[];
    const roots: Session[] = [];
    for (const e of encodedRoots) {
      roots.push(await decodeSession(e));
    }
    return [await decodeSession(body.session as EncodedSession), roots];
  } catch (_err: unknown) {
    return [undefined, undefined];
  }
}

export async function sendLoginEmail(
  session: OwnedSession,
  email: string,
): Promise<boolean> {
  try {
    const resp = await sendJSONToEndpoint('/auth/send-login-email', undefined, {
      email,
      signature: await signData(session, email),
    });
    return resp.status === 200;
  } catch (_err: unknown) {
    return false;
  }
}

export function getBaseURL(): string {
  const serverURL = getGoatConfig().serverURL;
  return serverURL || `${location.protocol}//${location.host}`;
}

export function getOrganizationId(): string {
  const config = getGoatConfig();
  return config.orgId || 'localhost';
}

function urlForEndpoint(endpoint: string): string {
  if (endpoint[0] === '/') {
    endpoint = endpoint.substring(1);
  }
  return `${getBaseURL()}/${endpoint}`;
}

export function sendJSONToEndpoint(
  endpoint: string,
  session: OwnedSession | undefined,
  json: ReadonlyJSONObject,
): Promise<JSONResponse> {
  return sendJSONToURL(urlForEndpoint(endpoint), session, json);
}

export interface JSONResponse {
  status: number;
  body: string;
}

/** Builds request headers, signing the request once when a session is given. */
async function buildRequestHeaders(
  sessionOrSignature: OwnedSession | undefined | string,
  orgId: string | undefined,
): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let signature = sessionOrSignature;
  if (signature !== undefined) {
    if (typeof signature !== 'string') {
      signature = await generateRequestSignature(signature);
    }
    headers['x-goat-sig'] = signature;
  }
  if (orgId) {
    headers['x-org-id'] = orgId;
  }
  return headers;
}

export async function sendJSONToURL(
  url: string,
  sessionOrSignature: OwnedSession | undefined | string,
  json: JSONValue,
  orgId?: string,
  timeoutMs = 5 * kSecondMs,
  signal?: AbortSignal,
): Promise<JSONResponse> {
  const headers = await buildRequestHeaders(sessionOrSignature, orgId);
  // One controller drives both timeout and external cancellation, so the
  // fetch has a single abort path with an explicit reason (fetch itself masks
  // it as a generic AbortError).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeout()), timeoutMs);
  const onExternalAbort = () => controller.abort(serviceUnavailable());
  // Registering after an already-aborted signal would never fire; abort now.
  if (signal?.aborted) {
    onExternalAbort();
  } else {
    signal?.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(json),
      signal: controller.signal,
    });
    // Keep the timeout/abort armed until the body is consumed.
    return { status: resp.status, body: await resp.text() };
  } catch (e) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
