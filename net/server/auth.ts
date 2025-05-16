import {
  decodeSignature,
  type EncodedSession,
  encodeSession,
  type OwnedSession,
  type Session,
  SESSION_CRYPTO_KEY_GEN_PARAMS,
  sessionIdFromSignature,
  sessionToItem,
  signData,
  verifyData,
  verifyRequestSignature,
} from '../../db/session.ts';
import { uniqueId } from '../../base/common.ts';
import { deserializeDate, kDayMs, kSecondMs } from '../../base/date.ts';
import { assert } from '../../base/error.ts';
import { Item } from '../../cfds/base/item.ts';
import type { HTTPMethod } from '../../logging/metrics.ts';
import type { Endpoint, ServerServices } from './server.ts';
import { getBaseURL, getRequestPath } from './utils.ts';
import {
  kSchemaUserStats,
  type Schema,
  type SchemaTypeUserStats,
} from '../../cfds/base/schema.ts';
import { normalizeEmail } from '../../base/string.ts';
import type { ReadonlyJSONObject } from '../../base/interfaces.ts';
import { accessDenied } from '../../cfds/base/errors.ts';
import { copyToClipboard } from '../../base/development.ts';
import { sleep } from '../../base/time.ts';
import type { GoatDB } from '../../db/db.ts';
import { itemPathGetPart } from '../../db/path.ts';
import type { ManagedItem } from '../../db/managed-item.ts';
import { GoatRequest } from './http-compat.ts';

// Polyfill global crypto in Node.js
// deno-lint-ignore no-explicit-any
if (
  typeof globalThis.crypto === 'undefined' && typeof process !== 'undefined' &&
  process.versions && process.versions.node
) {
  // @ts-ignore
  globalThis.crypto = require('node:crypto').webcrypto;
}

export const kAuthEndpointPaths = [
  '/auth/session',
  '/auth/send-login-email',
  '/auth/temp-login',
] as const;
export type AuthEndpointPath = (typeof kAuthEndpointPaths)[number];

export type GenericAuthError = 'AccessDenied';
export type CreateSessionError = 'MissingPublicKey' | 'InvalidPublicKey';
export type LoginError = 'MissingEmail' | 'MissingSignature';

export type AuthError = GenericAuthError | CreateSessionError | LoginError;

export interface TemporaryLoginToken extends ReadonlyJSONObject {
  readonly u: string; // User key
  readonly s: string; // Session ID
  readonly ts: number; // Creation timestamp
  readonly sl: string; // A random salt to ensure uniqueness
}

export class AuthEndpoint<US extends Schema> implements Endpoint<US> {
  filter(
    _services: ServerServices<US>,
    req: GoatRequest,
    _info: Deno.ServeHandlerInfo,
  ): boolean {
    const path = getRequestPath<AuthEndpointPath>(req);
    if (!kAuthEndpointPaths.includes(path)) {
      return false;
    }
    const method = req.method as HTTPMethod;
    switch (path) {
      case '/auth/session':
        return method === 'POST' || method === 'PATCH';

      case '/auth/send-login-email':
        return method === 'POST';

      case '/auth/temp-login':
        return method === 'GET';
    }
    return false;
  }

  processRequest(
    services: ServerServices<US>,
    req: GoatRequest,
    _info: Deno.ServeHandlerInfo,
  ): Promise<Response> {
    const path = getRequestPath<AuthEndpointPath>(req);
    const method = req.method as HTTPMethod;
    switch (path) {
      case '/auth/session':
        if (method === 'POST') {
          return this.createNewSession(services, req);
        }
        break;

      case '/auth/send-login-email':
        return this.sendTemporaryLoginEmail(services, req);

      case '/auth/temp-login':
        return this.loginWithToken(services, req);
    }

    return Promise.resolve(
      new Response('Unknown request', {
        status: 400,
      }),
    );
  }

  private async createNewSession(
    services: ServerServices<US>,
    req: GoatRequest,
  ): Promise<Response> {
    let publicKey: CryptoKey | undefined;
    try {
      const body = await req.json();
      const jwk = body.publicKey;
      if (typeof jwk !== 'object') {
        return responseForError('MissingPublicKey');
      }
      publicKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        SESSION_CRYPTO_KEY_GEN_PARAMS,
        true,
        ['verify'],
      );
    } catch (_e: unknown) {
      return responseForError('InvalidPublicKey');
    }
    if (!publicKey) {
      return responseForError('MissingPublicKey');
    }
    const sessionId = uniqueId();
    const session: Session = {
      publicKey,
      id: sessionId,
      expiration: deserializeDate(Date.now() + 30 * kDayMs),
    };
    await persistSession(services, session);
    const encodedSession = await encodeSession(session);
    // Let updates time to propagate to replicas
    if (services.buildInfo.debugBuild !== true) {
      await sleep(1 * kSecondMs);
    }
    const resp = new Response(
      JSON.stringify({
        session: encodedSession,
        roots: await fetchEncodedRootSessions(services.db),
      }),
    );
    resp.headers.set('Content-Type', 'application/json');
    return resp;
  }

  private async sendTemporaryLoginEmail(
    services: ServerServices<US>,
    req: GoatRequest,
  ): Promise<Response> {
    const body = await req.json();
    const email = normalizeEmail(body.email);
    if (typeof email !== 'string') {
      return responseForError('MissingEmail');
    }

    const sig = body.signature;
    if (typeof sig !== 'string') {
      return responseForError('MissingSignature');
    }

    const requestingSessionId = sessionIdFromSignature(sig);
    if (!requestingSessionId) {
      return responseForError('AccessDenied');
    }

    const requestingSession = await fetchSessionById(
      services,
      requestingSessionId,
    );
    if (!requestingSession) {
      return responseForError('AccessDenied');
    }

    // Make sure a session doesn't try to change its owner
    if (requestingSession.owner !== undefined) {
      return responseForError('AccessDenied');
    }

    // Verify it's actually this session who generated the request
    if (!verifyData(requestingSession, sig, email)) {
      return responseForError('AccessDenied');
    }

    const userItem = await fetchUserByEmail(services, email);

    // Unconditionally generate the signed token so this call isn't vulnerable
    // to timing attacks.
    // TODO (ofri): Rate limit this call
    const signedToken = await signData(
      services.db.settings.currentSession,
      undefined,
      {
        u: itemPathGetPart(userItem?.path, 'item') || '',
        s: requestingSessionId,
        ts: Date.now(),
        sl: uniqueId(),
      },
    );

    if (!userItem || userItem.isDeleted || userItem.get('email') !== email) {
      return responseForError('AccessDenied');
    }

    const clickURL = `${getBaseURL(services)}/auth/temp-login?t=${signedToken}`;
    if (services.buildInfo.debugBuild) {
      const copied = await copyToClipboard(clickURL);
      console.log(
        `Login URL${copied ? ' (copied to clipboard)' : ''}: ${clickURL}`,
      );
    }
    // Only send the mail if a user really exists. We send the email
    // asynchronously both for speed and to avoid timing attacks.
    if (userItem !== undefined) {
      services.email.send({
        type: 'Login',
        magicLink: clickURL,
        to: email,
      });
    }
    return new Response('OK', { status: 200 });
  }

  private async loginWithToken(
    services: ServerServices<US>,
    req: GoatRequest,
  ): Promise<Response> {
    const encodedToken = new URL(req.url).searchParams.get('t');
    if (!encodedToken) {
      return this.redirectHome(services);
    }
    try {
      const signature = decodeSignature<TemporaryLoginToken>(encodedToken);
      const signerId = signature.sessionId;
      // Verify we have a signer
      if (!signerId) {
        return this.redirectHome(services);
      }
      // Verify that root signed this request and that the signature is valid
      const signerSession = await fetchSessionById(services, signerId);
      if (
        !signerSession ||
        signerSession.owner !== 'root' || // Only root may sign login tokens
        !(await verifyData(signerSession, signature))
      ) {
        return this.redirectHome(services);
      }
      // Make sure this is a known user
      const userKey = signature.data.u;
      const usersRepo = await services.db.open('/sys/users');
      const entry = usersRepo.valueForKey(userKey);
      if (!entry || entry[0].isNull) {
        return this.redirectHome(services);
      }
      // Find the session item and make sure it exists
      const sessionsRepo = await services.db.open('/sys/sessions');
      const session = (await services.db.getTrustPool()).getSession(
        signature.data.s,
      );
      if (!session) {
        return this.redirectHome(services);
      }
      // Ensure this session isn't already attached to a user
      if (session.owner !== undefined) {
        return this.redirectHome(services);
      }
      // Link the session to its new owner
      session.owner = userKey;
      sessionsRepo.setValueForKey(
        session.id,
        await sessionToItem(session, services.db.registry),
        sessionsRepo.headForKey(session.id),
      );
      // Update user stats
      const statsRepo = await services.db.open('/sys/stats');
      const statsEntry = statsRepo.valueForKey<
        SchemaTypeUserStats
      >(userKey);
      const statsItem = statsEntry
        ? statsEntry[0].clone()
        : new Item<SchemaTypeUserStats>({
          schema: kSchemaUserStats,
          data: {},
        });
      const now = new Date();
      statsItem.set('lastLoggedIn', now);
      if (!statsItem.has('firstLoggedIn')) {
        statsItem.set('firstLoggedIn', now);
      }
      statsRepo.setValueForKey(userKey, statsItem, statsEntry && statsEntry[1]);
      // Let the updated data time to replicate
      if (services.buildInfo.debugBuild !== true) {
        await sleep(1 * kSecondMs);
      }
      return this.redirectHome(services);
    } catch (_: unknown) {
      return this.redirectHome(services);
    }
  }

  private redirectHome(services: ServerServices<US>): Response {
    return new Response(null, {
      status: 307,
      headers: {
        Location: getBaseURL(services),
      },
    });
  }
}

export async function persistSession<US extends Schema>(
  services: ServerServices<US>,
  session: Session | OwnedSession,
): Promise<void> {
  const repo = await services.db.open('/sys/sessions');
  const record = await sessionToItem(session, services.db.registry);
  await repo.setValueForKey(session.id, record, undefined);
  await services.db.flush('/sys/sessions');
}

export async function fetchEncodedRootSessions<US extends Schema>(
  db: GoatDB<US>,
): Promise<EncodedSession[]> {
  const result: EncodedSession[] = [];
  const trustPool = await db.getTrustPool();
  const now = new Date();
  for (const session of trustPool.roots) {
    if (session.expiration < now) {
      continue;
    }
    assert(session.owner === 'root');
    result.push(await encodeSession(session));
  }
  return result;
}

async function fetchUserByEmail<US extends Schema>(
  services: ServerServices<US>,
  email: string,
): Promise<ManagedItem<US> | undefined> {
  return await services.fetchUserByEmail?.(services.db, email);
  // email = normalizeEmail(email);
  // // This query acts as a persistent index over user emails:
  // // 1. It maintains a sorted list of all users by email
  // // 2. The query stays active and automatically updates as users are
  // //    added/modified
  // // 3. Results are cached and immediately available after initial load
  // // 4. Since email is the sort field, binary search is used for O(log n)
  // //    lookups
  // // 5. Query caching allows efficient resume after suspend/close
  // const query = services.db.query({
  //   schema: services.db.schemaManager.userSchema,
  //   source: '/sys/users',
  //   sortBy: 'email',
  // });
  // // Wait for the query to finish loading
  // await query.loadingFinished();
  // const user = query.find('email', email);
  // if (user) {
  //   return user as unknown as ManagedItem<US>;
  // }
  // // Lazily create users when needed
  // if (services.autoCreateUser && services.autoCreateUser({ email })) {
  //   const result = services.db.create(
  //     '/sys/users',
  //     services.db.schemaManager.userSchema,
  //     {
  //       email: email,
  //     },
  //   ) as unknown as ManagedItem<US>;
  //   await services.db.flush('/sys/users');
  //   return result;
  // }
  // return undefined;
}

export async function fetchSessionById<US extends Schema>(
  services: ServerServices<US>,
  sessionId: string,
): Promise<Session | undefined> {
  const tp = await services.db.getTrustPool();
  const session = tp.getSession(sessionId);
  return session;
}

export function fetchUserById<US extends Schema>(
  services: ServerServices<US>,
  userId: string,
): Item<US> | undefined {
  const entry = services.db
    .repository('/sys/users')!
    .valueForKey<US>(userId);
  return entry && entry[0];
}

function responseForError(err: AuthError): Response {
  let status = 400;
  if (err === 'AccessDenied') {
    status = 403;
  }
  return new Response(JSON.stringify({ error: err }), {
    status,
  });
}

export type Role = 'user' | 'anonymous';

export async function requireSignedUser<
  US extends Schema,
>(
  services: ServerServices<US>,
  requestOrSignature: GoatRequest | Request | string,
  role?: Role,
): Promise<
  [
    userId: string | null,
    userItem: Item<US> | undefined,
    userSession: Session,
  ]
> {
  const signature = typeof requestOrSignature === 'string'
    ? requestOrSignature
    : requestOrSignature.headers.get('x-goat-sig');

  if (!signature) {
    throw accessDenied();
  }
  const signerSession = await fetchSessionById(
    services,
    sessionIdFromSignature(signature),
  );
  if (signerSession === undefined) {
    throw accessDenied();
  }
  if (!(await verifyRequestSignature(signerSession, signature))) {
    throw accessDenied();
  }
  const userId = signerSession.owner;
  if (userId === 'root') {
    return ['root', undefined, signerSession];
  }
  // Anonymous access
  if (userId === undefined) {
    if (role === 'anonymous') {
      return [null, Item.nullItem(services.db.registry), signerSession];
    }
    throw accessDenied();
  }
  const userItem = fetchUserById<US>(services, userId);
  if (userItem === undefined) {
    throw accessDenied();
  }
  if (userItem.isDeleted) {
    throw accessDenied();
  }
  return [userId, userItem, signerSession];
}
