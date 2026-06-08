import type { ServerServices } from './server.ts';
import type { SendMailOptions, Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type SESTransport from 'nodemailer/lib/ses-transport/index.js';

// Lazy nodemailer — defers npm resolution until email is actually sent,
// avoiding @deno/loader WASM initialization in contexts that never send email.
type NodemailerModule = typeof import('nodemailer') & {
  default?: Pick<typeof import('nodemailer'), 'createTransport'>;
};

let _nodemailer: typeof import('nodemailer') | undefined;
async function getNodemailer(): Promise<typeof import('nodemailer')> {
  if (!_nodemailer) {
    const specifier = 'nodemailer';
    _nodemailer = await import(specifier);
  }
  return _nodemailer!;
}
import { BaseService } from './service.ts';
import type { EmailType } from '../../logging/metrics.ts';
import {
  DefaultEmailBuilder,
  type EmailBuilder,
  type EmailInfo,
} from '../../db/emails.ts';
import { Schema } from '../../cfds/base/schema.ts';

/**
 * Configuration type for NodeMailer transport options.
 * Can be either SMTP or Amazon SES configuration.
 */
export type NodeMailerConfig =
  | SMTPTransport.Options
  | SESTransport.Options;

/**
 * Configuration type for SMTP email service.
 * Combines NodeMailerConfig with additional debug options.
 *
 * @property debugEmails - When true, enables sending of emails on development
 *                        machines. When false or undefined, email sending is
 *                        disabled. Defaults to false.
 */
export type EmailConfig = NodeMailerConfig & {
  /**
   * The e-mail address of the sender. All e-mail addresses can be plain
   * `sender@server.com` or formatted `Sender Name <sender@server.com>`, see
   * [here](https://nodemailer.com/message/) for details.
   */
  from: string;

  /**
   * Optional email builder instance for constructing email content.
   * Defaults to DefaultEmailBuilder.
   */
  builder?: EmailBuilder;

  /**
   * When true, enables sending of emails on development machines.
   * When false or undefined, email sending is disabled on development machines.
   * Defaults to false.
   */
  debugEmails?: boolean;

  /**
   * An e-mail address that will appear on the Sender: field
   */
  sender?: string;

  /**
   * Comma separated list or an array of recipients e-mail addresses that will
   * appear on the Cc: field
   */
  cc?: string | string[] | undefined;

  /**
   * Comma separated list or an array of recipients e-mail addresses that will
   * appear on the Bcc: field
   */
  bcc?: string | string[] | undefined;

  /**
   * Comma separated list or an array of e-mail addresses that will appear on
   * the Reply-To: field
   */
  replyTo?: string | string[] | undefined;

  /**
   * Optional custom transporter factory. When provided, used instead of
   * `nodemailer.createTransport()`. Useful for testing — inject a mock
   * transporter without monkey-patching the nodemailer module.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createTransport?: (config: Record<string, any>) => Transporter;
};

/**
 * Interface for email message configuration.
 * Extends SendMailOptions with additional email type tracking.
 *
 * @property emailType - Optional type identifier for the email being sent.
 *                      Used for metrics tracking and logging.
 */
export interface EmailMessage extends SendMailOptions {
  emailType?: EmailType;
}

/**
 * Error type indicating email service initialization failed.
 * This branded marker is primarily useful inside the email service and its
 * tests, where initialization failures must be distinguished from send-time
 * failures in logs.
 */
export type EmailInitError = Error & { emailInitFailed: true };

/**
 * Type guard for {@link EmailInitError}.
 * Returns true only for Errors explicitly branded with `emailInitFailed: true`.
 */
export function isEmailInitError(err: unknown): err is EmailInitError {
  return err instanceof Error &&
    (err as { emailInitFailed?: unknown }).emailInitFailed === true;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function asEmailInitError(err: unknown): EmailInitError {
  const error = toError(err) as EmailInitError;
  error.emailInitFailed = true;
  return error;
}

export class EmailService<US extends Schema>
  extends BaseService<ServerServices<US>> {
  private readonly _config: EmailConfig | undefined;
  private _transporter: import('nodemailer').Transporter | undefined;
  private _initPromise: Promise<void> | undefined;
  private _emailLogger: import('../../logging/log.ts').Logger | undefined;

  constructor(config?: EmailConfig) {
    super();
    this._config = config;
  }

  override async setup(services: ServerServices<US>): Promise<void> {
    await super.setup(services);
    this._emailLogger = services.logger;
  }

  async send(info: EmailInfo): Promise<boolean> {
    // No config — email disabled
    if (!this._config) {
      return false;
    }

    try {
      // Lazy init transporter on first send. Sentinel promise deduplicates
      // concurrent callers so only one createTransport fires. Cleared on
      // rejection so transient failures don't permanently poison the service.
      if (!this._transporter) {
        if (!this._initPromise) {
          this._initPromise = (async () => {
            if (this._config!.createTransport) {
              this._transporter = this._config!.createTransport(this._config!);
            } else {
              const nm = await getNodemailer();
              const nodemailer = nm as NodemailerModule;
              // CJS/ESM interop: dynamic import may expose createTransport
              // under .default depending on the module resolution strategy.
              const createTransport = nodemailer.default?.createTransport ||
                nodemailer.createTransport;
              this._transporter = createTransport(this._config!);
            }
          })().catch((err) => {
            this._initPromise = undefined;
            throw asEmailInitError(err);
          });
        }
        await this._initPromise;
      }

      const builder = (this._config.builder ||
        DefaultEmailBuilder) as unknown as EmailBuilder<US>;
      const msg = {
        from: this._config.from,
        sender: this._config.sender,
        cc: this._config.cc,
        bcc: this._config.bcc,
        replyTo: this._config.replyTo,
        ...builder(info, this.services),
      };
      const success = await this._transporter!.sendMail(msg);
      if (success) {
        (this._emailLogger ?? this.services.logger).log({
          severity: 'METRIC',
          name: 'EmailSent',
          value: 1,
          unit: 'Count',
          type: info.type,
        });
      } else {
        (this._emailLogger ?? this.services.logger).log({
          severity: 'INFO',
          error: 'EmailSendFailed',
          type: info.type,
        });
      }
      return success;
    } catch (err: unknown) {
      const error = toError(err);
      (this._emailLogger ?? this.services.logger).log({
        severity: 'ERROR',
        error: isEmailInitError(error) ? 'EmailInitFailed' : 'EmailSendFailed',
        type: info.type,
        trace: error.stack,
      });
      return false;
    }
  }
}
