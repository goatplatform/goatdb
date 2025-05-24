import * as path from '@std/path';
import type { Dictionary } from '../../base/collections/dict.ts';
import {
  log,
  type Logger,
  type LogStream,
  newLogger,
  setGlobalLoggerStreams,
} from '../../logging/log.ts';
import type { HTTPMethod } from '../../logging/metrics.ts';
import { StaticAssetsEndpoint } from './static-assets.ts';
import { AuthEndpoint } from './auth.ts';
import { HealthCheckEndpoint } from './health.ts';
import { MetricsMiddleware } from './metrics.ts';
import { BaseService } from './service.ts';
import { CORSEndpoint, CORSMiddleware } from './cors.ts';
import { ServerError } from '../../cfds/base/errors.ts';
import { getGoatConfig } from '../../server/config.ts';
import { GoatDB } from '../../db/db.ts';
import { SyncEndpoint } from './sync.ts';
import type { DBInstanceConfig } from '../../db/db.ts';
import type { BuildInfo } from '../../server/build-info.ts';
import { type EmailConfig, EmailService } from './email.ts';
import type { StaticAssets } from '../../system-assets/system-assets.ts';
import type { Schema } from '../../cfds/base/schema.ts';
import type { ManagedItem } from '../../db/managed-item.ts';
import {
  createHttpServer,
  type GoatRequest,
  type HttpServerInstance,
  type ServeHandlerInfo,
} from './http-compat.ts';

/**
 * Information about a user attempting to log in for the first time.
 * Used by the autoCreateUser function to determine if a new account should be
 * created.
 */
export type AutoCreateUserInfo = {
  /**
   * The email address provided during login attempt.
   * Optional since some login flows may not require an email.
   */
  email?: string;
};

export type DomainConfig = {
  /**
   * Given an organization id, this function is responsible for resolving it
   * to the correct URL. It enables a single server instance to serve multiple
   * organizations in a multi-tenant deployment.
   *
   * A typical easy implementation is to place each organization under its own
   * sub-path or sub-domain of the main service.
   *
   * @param orgId The organization id to resolve.
   * @returns A fully qualified URL for this organization.
   */
  resolveOrg: (orgId: string) => string;
  /**
   * Given a domain name, this function is responsible for extracting the
   * organization id. This is the reverse operation of resolveDomain - it takes
   * a fully qualified domain and returns the organization id that would have
   * generated that domain.
   *
   * @param domain The domain name to parse
   * @returns The organization id embedded in this domain
   */
  resolveDomain: (domain: string) => string;
};

/**
 * A server represents a logical DB with some additional configuration options.
 */
export interface ServerOptions<US extends Schema> extends DBInstanceConfig {
  /**
   * The directory under which all server data will be stored.
   * This includes database files, logs, and other persistent data.
   */
  path: string;
  /**
   * Info about the build process.
   */
  buildInfo: BuildInfo;
  /**
   * Configuration for mapping custom domains to organizations and vice versa.
   * This enables multi-tenant deployments where each organization can have its
   * own domain or subdomain. For example:
   * - org1.example.com -> maps to organization "org1"
   * - org2.example.com -> maps to organization "org2"
   * The mapping is bidirectional - domains can be resolved to org IDs and
   * org IDs can be resolved to their domains.
   */
  domain: DomainConfig;
  /**
   * The port the server will listen to. Defaults to 8080.
   */
  port?: number;
  /**
   * Optional array of log streams. All of the server binary's outputs will be
   * directed to these streams.
   */
  logStreams?: LogStream[];
  /**
   * Compiled static assets the server will serve.
   */
  staticAssets?: StaticAssets;
  /**
   * Path to deno.json. Defaults to 'deno.json' inside the current directory.
   */
  denoJson?: string;
  /**
   * Configuration for the email service. Can use either SMTP or AWS SES via
   * {@link https://nodemailer.com/|NodeMailer}.
   *
   * Example SMTP configuration (see {@link https://nodemailer.com/smtp/}):
   * ```ts
   * {
   *   host: "smtp.gmail.com",
   *   port: 587,
   *   secure: true,
   *   auth: {
   *     user: "user@gmail.com",
   *     pass: "app-specific-password"
   *   },
   *   debugEmails: true, // Enable email sending in development
   *   from: "system@my.domain.com",
   * }
   * ```
   *
   * Example Amazon SES configuration (see {@link https://nodemailer.com/ses/}):
   * ```ts
   * import { SendRawEmailCommand, SES } from "npm:@aws-sdk/client-ses";
   *
   * {
   *   SES: {
   *     ses: new SES({ region: "us-east-1" }),
   *     aws: { SendRawEmailCommand },
   *   },
   *   debugEmails: true, // Enable email sending in development
   *   from: "system@my.domain.com",
   * }
   * ```
   */
  emailConfig?: EmailConfig;
  /**
   * A hook that's used during email-based authentication flows to look up or create users.
   * This function is called when a user attempts to log in with an email address.
   *
   * Implementing this hook allows you to:
   * - Integrate with external user management systems
   * - Implement custom user lookup logic
   * - Lazily create users when they first authenticate
   * - Apply organization-specific policies for user creation
   *
   * If not provided, the system won't handle email-based authentication and authorization.
   *
   * @param db The database instance
   * @param email The normalized email address of the user attempting to authenticate
   * @returns The user item if found or created, or undefined to deny access
   */
  fetchUserByEmail?: (
    db: GoatDB<US>,
    email: string,
  ) => Promise<ManagedItem<US> | undefined> | ManagedItem<US> | undefined;
  /**
   * The application name to use in emails and other user-facing content.
   * If not provided, a default name will be used.
   */
  appName?: string;
  /**
   * If true, disables all default endpoints and middlewares (health, auth, static, etc).
   */
  disableDefaultEndpoints?: boolean;
}

/**
 * The services object is accessible to all endpoints and middlewares of the
 * server. Several services instances exist in the server. First a base instance
 * corresponding to the root level of the server's data dir. Second, an
 * organization specific services and DB instance is created inside the root
 * data dir so all organization data is contained in a single DB/directory on
 * disk.
 */
export interface ServerServices<US extends Schema> extends ServerOptions<US> {
  readonly orgId: string;
  readonly db: GoatDB<US>;
  readonly logger: Logger;
  readonly email: EmailService<US>;
}

/**
 * An Endpoint catches a request using its filter, and generates an appropriate
 * response for the request. For every incoming request, all Endpoints are
 * searched until the first filter hit is found. Thus, the order of Endpoint
 * registration determines the search order.
 *
 * In order to fulfill their job, Endpoints can consume Services offered by the
 * server. See `BaseService` below.
 */
export interface Endpoint<US extends Schema> {
  filter(
    services: ServerServices<US>,
    req: GoatRequest,
    info: ServeHandlerInfo,
  ): boolean;
  processRequest(
    services: ServerServices<US>,
    req: GoatRequest,
    info: ServeHandlerInfo,
  ): Promise<Response>;
}

/**
 * A middleware runs before and/or after the selected endpoint. A middleware
 * may either block the request entirely (to enforce permissions, etc) or modify
 * the response after the endpoint finished execution.
 *
 * Note that all registered middlewares get a chance to run for each request.
 * Execution order follows registration order, just like endpoints.
 */
export interface Middleware<US extends Schema> {
  shouldProcess?: (
    services: ServerServices<US>,
    req: GoatRequest,
    info: ServeHandlerInfo,
  ) => Promise<Response | undefined>;
  didProcess?: (
    services: ServerServices<US>,
    req: GoatRequest,
    info: ServeHandlerInfo,
    resp: Response,
  ) => Promise<Response>;
}

/**
 * A simple abstraction around an HTTP server. The server is built using two
 * primitives: endpoints and middlewares.
 *
 * The generic parameter US defines the schema of User items throughout the
 * system. Pass your custom user schema to enable type-safe user management and
 * authorization. See @sessions.md and @authorization-rules.md for details on
 * user authentication and access control.
 *
 * # Usage Examples
 *
 * ## 1. Standalone Server
 *
 * ```ts
 * import { Server } from './net/server/server.ts';
 *
 * const server = new Server({
 *   // ...options
 * });
 *
 * await server.start();
 * // The server now listens for HTTP requests on the default port (8080).
 * ```
 *
 * ## 2. Integrating into an Existing Server
 *
 * If you want to use GoatDB's server as a handler within another HTTP server,
 * you can call `await server.processRequest(request, info)` directly:
 *
 * ```ts
 * import { Server } from './net/server/server.ts';
 *
 * const server = new Server({
 *   // ...options
 * });
 *
 * // Inside your own HTTP server handler:
 * async function handler(request: Request) {
 *   const info = { // ...ServeHandlerInfo... };
 *   return await server.processRequest(request, info);
 * }
 *
 * // Use `handler` in your custom server framework.
 * ```
 *
 * Endpoints:
 * ----------
 * Endpoints are the core request handlers that process specific HTTP requests.
 * Each endpoint has a filter that determines which requests it handles, and a
 * processRequest method that generates the response. Endpoints are executed in
 * registration order until the first matching endpoint is found.
 *
 * Middlewares:
 * -----------
 * Middlewares provide cross-cutting functionality that runs before and/or after
 * endpoint processing. They can:
 * - Block requests before they reach endpoints (e.g. for authentication)
 * - Modify responses after endpoints complete (e.g. adding headers)
 * - Log requests and responses
 * - Handle errors
 *
 * All registered middlewares run for each request in registration order.
 */
export class Server<US extends Schema> {
  private readonly _endpoints: Endpoint<US>[];
  private readonly _middlewares: Middleware<US>[];
  private readonly _baseOptions: ServerOptions<US>;
  private readonly _servicesByOrg: Dictionary<string, ServerServices<US>>;

  private _abortController: AbortController | undefined;
  private _httpServer?: HttpServerInstance;

  constructor(options: ServerOptions<US>) {
    this._endpoints = [];
    this._middlewares = [];
    getGoatConfig().serverData = this;
    this._servicesByOrg = new Map();
    setGlobalLoggerStreams(options.logStreams || []);
    if (!options.port) {
      options.port = 8080;
    }
    if (!options.orgId) {
      options.orgId = 'localhost';
    }
    this._baseOptions = options;
    if (!options.disableDefaultEndpoints) {
      // Monitoring
      if (options.logStreams) {
        this.registerMiddleware(new MetricsMiddleware<US>(options.logStreams));
      }
      // Health check
      this.registerEndpoint(new HealthCheckEndpoint<US>());
      // Auth
      this.registerEndpoint(new AuthEndpoint<US>());
      // Stats
      // this.registerEndpoint(new StatsEndpoint());
      // Sync
      this.registerEndpoint(new SyncEndpoint<US>());
      // CORS Support
      this.registerMiddleware(new CORSMiddleware<US>());
      this.registerEndpoint(new CORSEndpoint<US>());
      // Static Assets
      this.registerEndpoint(new StaticAssetsEndpoint<US>());
      // Logs
      // this.registerEndpoint(new LogsEndpoint());
    }
    this._httpServer = createHttpServer();
  }

  /**
   * Gets or creates server services for a given organization ID.
   *
   * This method manages the lifecycle of server services for each organization,
   * creating them on first access and caching them for subsequent requests.
   *
   * @param orgId - The organization identifier
   * @returns Promise resolving to the organization's server services
   */
  async servicesForOrganization(orgId: string): Promise<ServerServices<US>> {
    // Return cached services if they exist
    let services = this._servicesByOrg.get(orgId);
    if (!services) {
      // Create new services for this organization
      const dir = path.join(this._baseOptions.path, orgId);

      // Initialize services with base configuration
      services = {
        ...this._baseOptions,
        path: dir,
        orgId,
        db: new GoatDB({
          ...this._baseOptions,
          orgId,
          path: dir,
          debug: this._baseOptions.buildInfo.debugBuild,
        }),
        logger: newLogger(this._baseOptions.logStreams || []),
        email: new EmailService(this._baseOptions.emailConfig),
      };

      // Initialize service dependencies
      await services.email.setup(services);

      // Cache the services for future requests
      this._servicesByOrg.set(orgId, services);
    }
    return services;
  }

  /**
   * Registers an endpoint handler with the server.
   *
   * @param ep - The endpoint handler to register
   */
  registerEndpoint(ep: Endpoint<US>): void {
    this._endpoints.push(ep);
  }

  /**
   * Registers a middleware handler with the server.
   *
   * @param mid - The middleware handler to register
   */
  registerMiddleware(mid: Middleware<US>): void {
    this._middlewares.push(mid);
  }

  /**
   * Returns an iterable of all organization IDs that have services initialized.
   *
   * @returns An iterable of organization ID strings
   */
  orgIds(): Iterable<string> {
    return this._servicesByOrg.keys();
  }

  /**
   * Updates the static assets configuration for the server and all existing
   * organization services.
   *
   * This is primarily used by the live-reload debug server functionality to
   * update static assets without requiring a full server restart.
   *
   * @param assets - The new static assets configuration to apply
   */
  updateStaticAssets(assets: StaticAssets): void {
    this._baseOptions.staticAssets = assets;
    for (const services of this._servicesByOrg.values()) {
      services.staticAssets = assets;
    }
  }

  /**
   * Processes an incoming HTTP request through the server's middleware and
   * endpoint pipeline.
   *
   * @param req - The incoming HTTP request
   * @param info - Additional request information
   * @returns Promise resolving to the HTTP response
   */
  async processRequest(
    goatReq: GoatRequest,
    info: ServeHandlerInfo,
  ): Promise<Response> {
    if (goatReq.url === 'http://AWSALB/healthy') {
      return new Response(null, { status: 200 });
    }
    const orgId = this._baseOptions.domain.resolveDomain(goatReq.url);
    if (!orgId) {
      log({
        severity: 'METRIC',
        name: 'HttpStatusCode',
        unit: 'Count',
        value: 404,
        url: goatReq.url,
        method: goatReq.method as HTTPMethod,
        message: `Organization ID not found. Hostname: ${
          new URL(goatReq.url).hostname
        }`,
      });
      return new Response(null, {
        status: 404,
      });
    }

    const services = await this.servicesForOrganization(orgId);
    const middlewares = this._middlewares;
    for (const endpoint of this._endpoints) {
      if (endpoint.filter(services, goatReq, info) === true) {
        try {
          let resp: Response | undefined;
          for (const m of middlewares) {
            if (m.shouldProcess) {
              resp = await m.shouldProcess(services, goatReq, info);
              if (resp) {
                break;
              }
            }
          }
          if (!resp) {
            resp = await endpoint.processRequest(services, goatReq, info);
          }
          for (const m of middlewares) {
            if (m.didProcess) {
              resp = await m.didProcess(services, goatReq, info, resp);
            }
          }
          return resp;
        } catch (e: unknown) {
          if (e instanceof ServerError) {
            log({
              severity: 'ERROR',
              name: 'HttpStatusCode',
              unit: 'Count',
              value: e.code,
              url: goatReq.url,
              method: goatReq.method as HTTPMethod,
              error: e.message,
              trace: e.stack,
              orgId,
            });
            return new Response(null, {
              status: e.code,
            });
          }
          log({
            severity: 'ERROR',
            name: 'InternalServerError',
            unit: 'Count',
            value: 500,
            url: goatReq.url,
            method: goatReq.method as HTTPMethod,
            error: e instanceof Error ? e.message : String(e),
            trace: e instanceof Error ? e.stack : undefined,
            orgId,
          });
          return new Response(null, {
            status: 500,
          });
        }
      }
    }
    let resp = new Response(null, {
      status: 404,
    });
    for (const m of middlewares) {
      if (m.didProcess) {
        resp = await m.didProcess(services, goatReq, info, resp);
      }
    }
    return resp;
  }

  /**
   * Starts the server and all associated services.
   *
   * @returns Promise that resolves when server is fully started
   */
  async start(): Promise<void> {
    // Return early if server is already running
    if (this._abortController) {
      return Promise.resolve();
    }

    // Start all services for each org
    for (const services of this._servicesByOrg.values()) {
      for (const v of Object.values(services)) {
        if (v instanceof BaseService) {
          await v.start();
        }
      }
    }

    // Log server start metric
    log({
      severity: 'METRIC',
      name: 'ServerStarted',
      value: 1,
      unit: 'Count',
    });

    // Create promise to track server start
    let resolve: () => void = () => {};
    const result = new Promise<void>((res) => {
      resolve = res;
    });

    // Initialize abort controller and start HTTP server
    this._abortController = new AbortController();
    this._httpServer!.start(
      this.processRequest.bind(this),
      this._baseOptions.port!,
      this._abortController.signal,
    ).then(resolve);

    return result;
  }
}
