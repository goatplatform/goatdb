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
import type { DBConfig } from '../../db/db.ts';
import type { BuildInfo } from '../../server/build-info.ts';
import { type EmailConfig, EmailService } from './email.ts';
import type { StaticAssets } from '../../system-assets/system-assets.ts';

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
export interface ServerOptions extends DBConfig {
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
   * A function that determines whether a user should be automatically created
   * on first login attempt. If this function returns true, a new user account
   * will be created when an unrecognized email attempts to log in. This can
   * be used to:
   *
   * - Enable public registration by returning true for all emails
   * - Enforce organization policies by checking email domains
   * - Restrict registration to specific email patterns or lists
   *
   * If not provided or if the function returns false, only pre-existing users
   * will be able to log in.
   *
   * @param info Information about the user attempting to log in
   * @returns true to allow creating a new user account, false to deny
   */
  autoCreateUser?: (info: AutoCreateUserInfo) => boolean;
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
   * The application name to use in emails and other user-facing content.
   * If not provided, a default name will be used.
   */
  appName?: string;
}

/**
 * The services object is accessible to all endpoints and middlewares of the
 * server. Several services instances exist in the server. First a base instance
 * corresponding to the root level of the server's data dir. Second, an
 * organization specific services and DB instance is created inside the root
 * data dir so all organization data is contained in a single DB/directory on
 * disk.
 */
export interface ServerServices extends ServerOptions {
  readonly orgId: string;
  readonly db: GoatDB;
  readonly logger: Logger;
  readonly email: EmailService;
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
export interface Endpoint {
  filter(
    services: ServerServices,
    req: Request,
    info: Deno.ServeHandlerInfo,
  ): boolean;
  processRequest(
    services: ServerServices,
    req: Request,
    info: Deno.ServeHandlerInfo,
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
export interface Middleware {
  shouldProcess?: (
    services: ServerServices,
    req: Request,
    info: Deno.ServeHandlerInfo,
  ) => Promise<Response | undefined>;
  didProcess?: (
    services: ServerServices,
    req: Request,
    info: Deno.ServeHandlerInfo,
    resp: Response,
  ) => Promise<Response>;
}

/**
 * A simple abstraction around an HTTP server. The server is built using two
 * primitives: endpoints and middlewares.
 *
 * Endpoint:
 * ---------
 *
 * An endpoint catches a request using its filter, and generates an appropriate
 * response. For every incoming request, all endpoints are searched until the
 * first filter hit is found. Thus, the order of endpoint registration
 * determines the priority of all endpoints.
 *
 * Middleware:
 * -----------
 *
 * A middleware runs before and/or after the selected endpoint. A middleware
 * may either block the request entirely (to enforce permissions, etc) or modify
 * the response after the endpoint finished execution (to apply custom headers,
 * compression, etc).
 *
 * All registered middlewares get a chance to run for each request.
 * Execution order follows registration order, like endpoints.
 */
export class Server {
  private readonly _endpoints: Endpoint[];
  private readonly _middlewares: Middleware[];
  private readonly _baseOptions: ServerOptions;
  private readonly _servicesByOrg: Dictionary<string, ServerServices>;

  private _abortController: AbortController | undefined;
  private _httpServer?: Deno.HttpServer;

  constructor(options: ServerOptions) {
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
    // Monitoring
    if (options.logStreams) {
      this.registerMiddleware(new MetricsMiddleware(options.logStreams));
    }
    // Health check
    this.registerEndpoint(new HealthCheckEndpoint());
    // Auth
    this.registerEndpoint(new AuthEndpoint());
    // Stats
    // this.registerEndpoint(new StatsEndpoint());
    // Sync
    this.registerEndpoint(new SyncEndpoint());
    // CORS Support
    this.registerMiddleware(new CORSMiddleware());
    this.registerEndpoint(new CORSEndpoint());
    // Static Assets
    this.registerEndpoint(new StaticAssetsEndpoint());
    // Logs
    // this.registerEndpoint(new LogsEndpoint());
  }

  async servicesForOrganization(orgId: string): Promise<ServerServices> {
    let services = this._servicesByOrg.get(orgId);
    if (!services) {
      const dir = path.join(this._baseOptions.path, orgId);
      // Monitoring
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

      // Setup all services in the correct order of dependencies
      // Add any new service.setup() calls here
      await services.email.setup(services);
      // <<< End Services Setup >>>
      this._servicesByOrg.set(orgId, services);
    }
    return services;
  }

  registerEndpoint(ep: Endpoint): void {
    this._endpoints.push(ep as Endpoint);
  }

  registerMiddleware(mid: Middleware): void {
    this._middlewares.push(mid as Middleware);
  }

  orgIds(): Iterable<string> {
    return this._servicesByOrg.keys();
  }

  updateStaticAssets(assets: StaticAssets): void {
    this._baseOptions.staticAssets = assets;
    for (const services of this._servicesByOrg.values()) {
      services.staticAssets = assets;
    }
  }

  async processRequest(
    req: Request,
    info: Deno.ServeHandlerInfo,
  ): Promise<Response> {
    if (req.url === 'http://AWSALB/healthy') {
      return new Response(null, { status: 200 });
    }
    const orgId = this._baseOptions.domain.resolveDomain(req.url);
    if (!orgId) {
      log({
        severity: 'METRIC',
        name: 'HttpStatusCode',
        unit: 'Count',
        value: 404,
        url: req.url,
        method: req.method as HTTPMethod,
        message: `Organization ID not found. Hostname: ${
          new URL(req.url).hostname
        }`,
      });
      return new Response(null, {
        status: 404,
      });
    }

    const services = await this.servicesForOrganization(orgId);
    const middlewares = this._middlewares;
    for (const endpoint of this._endpoints) {
      if (endpoint.filter(services, req, info) === true) {
        try {
          let resp: Response | undefined;
          for (const m of middlewares) {
            if (m.shouldProcess) {
              resp = await m.shouldProcess(services, req, info);
              if (resp) {
                break;
              }
            }
          }
          if (!resp) {
            resp = await endpoint.processRequest(services, req, info);
          }
          for (const m of middlewares) {
            if (m.didProcess) {
              resp = await m.didProcess(services, req, info, resp);
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
              url: req.url,
              method: req.method as HTTPMethod,
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
            url: req.url,
            method: req.method as HTTPMethod,
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
        resp = await m.didProcess(services, req, info, resp);
      }
    }
    return resp;
  }

  async start(): Promise<void> {
    if (this._abortController) {
      return Promise.resolve();
    }
    for (const services of this._servicesByOrg.values()) {
      for (const v of Object.values(services)) {
        if (v instanceof BaseService) {
          await v.start();
        }
      }
    }
    log({
      severity: 'METRIC',
      name: 'ServerStarted',
      value: 1,
      unit: 'Count',
    });
    let resolve: () => void;
    const result = new Promise<void>((res) => {
      resolve = res;
    });
    this._abortController = new AbortController();
    this._httpServer = Deno.serve(
      {
        port: this._baseOptions.port,
        onListen() {
          resolve();
        },
        signal: this._abortController.signal,
      },
      this.processRequest.bind(this),
    );
    Deno.addSignalListener('SIGTERM', () => {
      Deno.exit(0);
    });
    return result;
  }
}
