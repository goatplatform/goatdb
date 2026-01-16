import { notReached } from '../base/error.ts';
import type { EmailMessage } from '../net/server/email.ts';
import type { ServerOptions } from '../net/server/server.ts';
import type { Schema } from '../cfds/base/schema.ts';

/**
 * Configuration type for login emails containing magic links.
 * Used to generate login emails that allow users to authenticate via one-time
 * links.
 *
 * @property type - Literal 'Login' to identify this as a login email
 * @property magicLink - The one-time use authentication URL to include in the
 *                       email
 * @property to - The recipient's email address
 */
export type EmailLoginWithMagicLink = {
  type: 'Login';
  magicLink: string;
  to: string;
};

/**
 * Union type for all supported email types.
 * Currently only supports login emails with magic links.
 *
 * @see EmailLoginWithMagicLink
 */
export type EmailInfo = EmailLoginWithMagicLink;

/**
 * Function type for building email messages from email info.
 * Takes email info and server config and returns a formatted email message.
 *
 * @param info - The email information to use for building the message
 * @param config - Server configuration options
 * @returns An EmailMessage object with subject, text and HTML content
 */
export type EmailBuilder<US extends Schema = Schema> = (
  info: EmailInfo,
  config: ServerOptions<US>,
) => EmailMessage;

/**
 * Default implementation of the EmailBuilder function type.
 * Builds standard email messages for different email types.
 *
 * Currently supports:
 * - Login emails with magic links
 *
 * @param info - The email information to use for building the message
 * @param config - Server configuration options containing app name and other
 *                 settings
 * @returns An EmailMessage with subject line and message content in text and
 *          HTML formats
 * @throws Error if an unknown email type is provided
 */
export function DefaultEmailBuilder<US extends Schema = Schema>(
  info: EmailInfo,
  config: ServerOptions<US>,
): EmailMessage {
  switch (info.type) {
    case 'Login':
      return {
        subject: `Login to ${config.appName || 'GOAT App'}`,
        text: `Click on this link to login to your account: ${info.magicLink}`,
        html:
          `<html><body><div>Click on this link to login to your account: <a href="${info.magicLink}">here</a></div></body></html>`,
        to: info.to,
      };

    default:
      notReached('Unknown email type');
  }
}
