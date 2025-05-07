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
import { sleep } from '../base/time.ts';
import { timeout } from '../cfds/base/errors.ts';
import { getGoatConfig } from '../server/config.ts';
import { getCrypto } from '../base/common.ts';

export async function createNewSession(
  publicKey: CryptoKey,
): Promise<[Session | undefined, Session[] | undefined]> {
  try {
    const resp = await sendJSONToEndpoint('/auth/session', undefined, {
      publicKey: (await getCrypto().subtle.exportKey(
        'jwk',
        publicKey,
      )) as ReadonlyJSONObject,
    });
    if (resp.status !== 200) {
      return [undefined, undefined];
    }
    const body = await resp.json();
    const encodedRoots = body.roots as EncodedSession[];
    const roots: Session[] = [];
    for (const e of encodedRoots) {
      roots.push(await decodeSession(e));
    }
    return [await decodeSession(body.session), roots];
  } catch (_err: unknown) {
    debugger;
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
): Promise<Response> {
  return sendJSONToURL(urlForEndpoint(endpoint), session, json);
}

export async function sendJSONToURL(
  url: string,
  sessionOrSignature: OwnedSession | undefined | string,
  json: JSONValue,
  orgId?: string,
  timeoutMs = 5 * kSecondMs,
): Promise<Response> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (sessionOrSignature !== undefined) {
    if (typeof sessionOrSignature !== 'string') {
      sessionOrSignature = await generateRequestSignature(sessionOrSignature);
    }
    headers['x-goat-sig'] = sessionOrSignature;
  }
  if (orgId) {
    headers['x-org-id'] = orgId;
  }
  const abortController = new AbortController();
  const fetchPromise = fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(json),
    signal: abortController.signal,
  });
  let aborted = false;
  const timeoutPromise = (async () => {
    await sleep(timeoutMs);
    aborted = true;
    abortController.abort();
  })();
  await Promise.any([fetchPromise, timeoutPromise]);
  if (aborted) {
    throw timeout();
  }
  return await fetchPromise;
}
