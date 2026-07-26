/**
 * Portable email message types for custom email builders.
 *
 * This module imports only from GoatDB's core logging types — no
 * server-only dependencies like nodemailer.
 */
import type { EmailType } from '../../logging/metrics.ts';
export type EmailAddressObject = {
  name?: string;
  address: string;
};

export type EmailAddress = string | EmailAddressObject;
export type EmailAddressList = EmailAddress | EmailAddress[];
export type EmailHeaderValue =
  | string
  | string[]
  | { prepared: boolean; value: string };
export type EmailHeaders =
  | Record<string, EmailHeaderValue>
  | Array<{ key: string; value: string }>;

/** Portable binary-or-text content accepted by Nodemailer. */
export type EmailContent = string | Uint8Array;

/** Portable message content accepted by Nodemailer. */
export type EmailContentPart = {
  content?: EmailContent;
  path?: string;
  href?: string;
  encoding?: string;
  contentType?: string;
  raw?: EmailContent;
};

/** Portable attachment subset accepted by Nodemailer. */
export type EmailAttachment = EmailContentPart & {
  filename?: string | false;
  cid?: string;
  contentTransferEncoding?: '7bit' | 'base64' | 'quoted-printable' | false;
  contentDisposition?: 'attachment' | 'inline';
  headers?: EmailHeaders;
};

export type EmailAlternative = EmailAttachment;
export type EmailEnvelope = {
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
};

/**
 * Standard message fields accepted by GoatDB email builders.
 *
 * Text and HTML are optional because messages can contain either form. This
 * explicit portable subset covers ordinary headers and attachments without
 * exposing nodemailer types.
 */
export interface EmailMessage {
  from?: EmailAddress;
  sender?: EmailAddress;
  to?: EmailAddressList;
  cc?: EmailAddressList;
  bcc?: EmailAddressList;
  replyTo?: EmailAddressList;
  inReplyTo?: EmailAddress;
  references?: string | string[];
  subject?: string;
  text?: EmailContent;
  html?: EmailContent;
  watchHtml?: EmailContent;
  amp?: EmailContentPart;
  icalEvent?: EmailContentPart & { method?: string };
  headers?: EmailHeaders;
  list?: Record<string, string | { url: string; comment: string }>;
  envelope?: EmailEnvelope;
  messageId?: string;
  date?: Date | string;
  encoding?: string;
  raw?: EmailContent;
  textEncoding?: 'quoted-printable' | 'base64';
  disableUrlAccess?: boolean;
  disableFileAccess?: boolean;
  priority?: 'high' | 'normal' | 'low';
  attachDataUrls?: boolean;
  xMailer?: false | string;
  /** Optional application-specific type retained for custom builder compatibility. */
  emailType?: EmailType;
  attachments?: EmailAttachment[];
  alternatives?: EmailAlternative[];
}
