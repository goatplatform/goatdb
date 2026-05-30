import type { ServerServices } from './server.ts';
import type { SendMailOptions } from 'nodemailer';
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

type EmailInitError = Error & { emailInitFailed: true };

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

  constructor(config?: EmailConfig) {
    super();
    this._config = config;
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
          this._initPromise = getNodemailer().then((nm) => {
            const nodemailer = nm as NodemailerModule;
            // CJS/ESM interop: dynamic import may expose createTransport
            // under .default depending on the module resolution strategy.
            const createTransport = nodemailer.default?.createTransport ||
              nodemailer.createTransport;
            this._transporter = createTransport(this._config!);
          }).catch((err) => {
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
      const success = await this._transporter.sendMail(msg);
      if (success) {
        this.services.logger.log({
          severity: 'METRIC',
          name: 'EmailSent',
          value: 1,
          unit: 'Count',
          type: info.type,
        });
      } else {
        this.services.logger.log({
          severity: 'INFO',
          error: 'EmailSendFailed',
          type: info.type,
        });
      }
      return success;
    } catch (err: unknown) {
      const error = toError(err);
      this.services.logger.log({
        severity: 'ERROR',
        error: 'emailInitFailed' in error && error.emailInitFailed
          ? 'EmailInitFailed'
          : 'EmailSendFailed',
        type: info.type,
        trace: error.stack,
      });
      return false;
    }
  }
}
