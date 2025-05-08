// deno-types="@types/nodemailer"
import nodemailer from 'nodemailer';
import type { ServerServices } from './server.ts';
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
  | nodemailer.SmtpOptions
  | nodemailer.SesOptions;

/**
 * Configuration interface for SMTP email service.
 * Extends NodeMailerConfig with additional debug options.
 *
 * @property debugEmails - When true, enables sending of emails on development
 *                        machines. When false or undefined, email sending is
 *                        disabled. Defaults to false.
 */
export interface EmailConfig extends NodeMailerConfig {
  /**
   * The e-mail address of the sender. All e-mail addresses can be plain
   * 'sender@server.com' or formatted 'Sender Name <sender@server.com>', see
   * {@link https://nodemailer.com/message/|here} for details.
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
}

/**
 * Interface for email message configuration.
 * Extends NodeMailer's SendMailOptions with additional email type tracking.
 *
 * @extends nodemailer.SendMailOptions
 * @property emailType - Optional type identifier for the email being sent.
 *                      Used for metrics tracking and logging.
 */
export interface EmailMessage extends nodemailer.SendMailOptions {
  emailType?: EmailType;
}

export class EmailService<US extends Schema>
  extends BaseService<ServerServices<US>> {
  private readonly _config: EmailConfig | undefined;
  private readonly _transporter?: nodemailer.Transporter;

  constructor(config?: EmailConfig) {
    super();
    if (config) {
      this._transporter = nodemailer.createTransport(config);
    }
    this._config = config;
  }

  async send(info: EmailInfo): Promise<boolean> {
    // Disable email sending on development machines
    if (!this._config) {
      return false;
    }
    if (!this._transporter) {
      this.services.logger.log({
        severity: 'INFO',
        error: 'MissingConfiguration',
        message: 'Email service not configured',
      });
      if (this.services.buildInfo.isDevelopment) {
        console.log(
          'Email service not configured. Did you forget to configure the email service?',
        );
      }
      return false;
    }
    try {
      const msg = {
        from: this._config.from,
        sender: this._config.sender,
        cc: this._config.cc,
        bcc: this._config.bcc,
        replyTo: this._config.replyTo,
        ...(this._config.builder || DefaultEmailBuilder)(info, this.services),
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
      if (this.services.buildInfo.isDevelopment) {
        console.error(err);
      }
      this.services.logger.log({
        severity: 'ERROR',
        error: 'EmailSendFailed',
        type: info.type,
        trace: (err as Error).stack,
      });
      return false;
    }
  }
}
