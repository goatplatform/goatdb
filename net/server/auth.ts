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
import type { GoatRequest } from './http-compat.ts';
import type { ServeHandlerInfo } from './http-compat.ts';

// Polyfill global crypto in Node.js
if (
  // deno-lint-ignore no-process-global
  typeof globalThis.crypto === 'undefined' && typeof process !== 'undefined' &&
  // deno-lint-ignore no-process-global
  process.versions && process.versions.node
) {
  globalThis.crypto = require('node:crypto').webcrypto;
}

/**
 * List of authentication endpoint paths supported by the AuthEndpoint class.
 * These paths handle different aspects of the authentication flow:
 * - /auth/session: Session creation and management
 * - /auth/send-login-email: Email-based login initiation
 * - /auth/temp-login: Temporary login token validation
 */
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

/**
 * Handles authentication-related HTTP endpoints including session management,
 * email-based login, and temporary login tokens.
 *
 * This endpoint implements three main authentication flows:
 * 1. Session creation and management (/auth/session)
 * 2. Email-based login (/auth/send-login-email)
 * 3. Temporary login token validation (/auth/temp-login)
 */
export class AuthEndpoint<US extends Schema> implements Endpoint<US> {
  /**
   * Filters incoming requests to determine if they should be handled by this
   * endpoint. Validates both the request path and HTTP method.
   */
  filter(
    _services: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
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

  /**
   * Processes requests and routes them to the appropriate handler based on the
   * request path and method.
   */
  processRequest(
    services: ServerServices<US>,
    req: GoatRequest,
    _info: ServeHandlerInfo,
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

  /**
   * Creates a new authentication session using the provided public key.
   * The session is valid for 30 days.
   */
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

  /**
   * Handles email-based login by:
   * 1. Validating the request signature
   * 2. Generating a temporary login token
   * 3. Sending a login email with the token
   */
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

    const userItem = await services.fetchUserByEmail?.(services.db, email);

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

  /**
   * Validates a temporary login token and links the session to a user.
   * Includes multiple security checks:
   * - Token signature verification
   * - Root session validation
   * - User existence verification
   * - Session ownership checks
   */
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

/**
 * Persists a session to the database.
 *
 * This function is used to save a session to the database. It is used to save
 * the session to the database.
 */
export async function persistSession<US extends Schema>(
  services: ServerServices<US>,
  session: Session | OwnedSession,
): Promise<void> {
  const repo = await services.db.open('/sys/sessions');
  const record = await sessionToItem(session, services.db.registry);
  await repo.setValueForKey(session.id, record, undefined);
  await services.db.flush('/sys/sessions');
}

/**
 * Fetches and encodes all valid root sessions from the trust pool.
 *
 * This function retrieves all root sessions from the database's trust pool,
 * filters out expired sessions, and encodes them for transmission. Root sessions
 * are special sessions that have elevated privileges in the system.
 *
 * @param db - The GoatDB instance to fetch sessions from
 * @returns Promise resolving to an array of encoded root sessions
 */
export async function fetchEncodedRootSessions<US extends Schema>(
  db: GoatDB<US>,
): Promise<EncodedSession[]> {
  const result: EncodedSession[] = [];
  const trustPool = await db.getTrustPool();
  const now = new Date();

  for (const session of trustPool.roots) {
    // Skip expired sessions
    if (session.expiration < now) {
      continue;
    }

    // Verify this is actually a root session
    assert(session.owner === 'root');

    // Encode and add to results
    result.push(await encodeSession(session));
  }

  return result;
}

/**
 * Fetches a session by its ID from the trust pool.
 *
 * @param services - The server services containing the database
 * @param sessionId - The ID of the session to fetch
 * @returns Promise resolving to the session if found, undefined otherwise
 */
export async function fetchSessionById<US extends Schema>(
  services: ServerServices<US>,
  sessionId: string,
): Promise<Session | undefined> {
  const tp = await services.db.getTrustPool();
  const session = tp.getSession(sessionId);
  if (!session) {
    return undefined;
  }
  if (session.expiration < new Date()) {
    return undefined;
  }
  return session;
}

/**
 * Fetches a user item by their ID from the system users repository.
 *
 * @param services - The server services containing the database
 * @param userId - The ID of the user to fetch
 * @returns The user item if found, undefined otherwise
 */
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

/**
 * Represents the role of a user in the system.
 * - 'user': A registered user with full access
 * - 'anonymous': An unauthenticated user with limited access
 */
export type Role = 'user' | 'anonymous';

/**
 * Requires a signed user for authentication and authorization.
 *
 * This function validates a request signature and retrieves the associated user
 * session. It supports different user roles including root, anonymous, and
 * regular users.
 *
 * @template US - The schema type for user items
 * @param services - The server services containing the database
 * @param requestOrSignature - Either a request object or a signature string
 * @param role - Optional role requirement ('user' or 'anonymous')
 * @returns A tuple containing [userId, userItem, userSession]
 * @throws {Error} If authentication fails or access is denied
 */
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
