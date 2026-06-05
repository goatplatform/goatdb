import { TEST } from './mod.ts';
import { assertEquals, assertFalse, assertTrue } from './asserts.ts';
import type { Logger } from '../logging/log.ts';
import { createCapturedLogger } from './test-utils.ts';
import { EmailService } from '../net/server/email.ts';
import type { BuildInfo } from '../base/build-info.ts';

function createBuildInfo(): BuildInfo {
  return {
    creationDate: '2026-01-01T00:00:00.000Z',
    createdBy: 'test',
    builder: {
      runtime: 'deno',
      target: 'test',
      arch: 'x64',
      os: 'darwin',
      vendor: 'goatdb',
      env: 'test',
    },
    appName: 'GOAT Test App',
  };
}

/** Minimal services object passed to EmailService.setup() in tests.
 *  Only the fields the email service actually accesses are provided.
 *  The return type is cast via `as any` because test helpers naturally
 *  provide a subset of the full ServerServices interface. */
function makeMinimalServices(logger: Logger): any {
  return { logger, buildInfo: createBuildInfo() };
}

export default function setupEmailServiceTests(): void {
  TEST(
    'EmailService',
    'initializes transport lazily on first send and deduplicates concurrent init',
    async () => {
      let createTransportCalls = 0;
      let sendMailCalls = 0;

      const email = new EmailService({
        from: 'system@test.invalid',
        createTransport() {
          createTransportCalls++;
          return {
            sendMail: async () => {
              sendMailCalls++;
              return true;
            },
          } as import('nodemailer').Transporter;
        },
      });
      const { captured, logger } = createCapturedLogger();
      await email.setup(makeMinimalServices(logger));

      assertEquals(
        createTransportCalls,
        0,
        'EmailService constructor/setup must not initialize nodemailer transport',
      );

      const [first, second] = await Promise.all([
        email.send({
          type: 'Login',
          magicLink: 'https://example.com/a',
          to: 'a@test.invalid',
        }),
        email.send({
          type: 'Login',
          magicLink: 'https://example.com/b',
          to: 'b@test.invalid',
        }),
      ]);

      assertTrue(first, 'first send must succeed after lazy init');
      assertTrue(second, 'second concurrent send must share the same init');
      assertEquals(
        createTransportCalls,
        1,
        'concurrent first sends must create exactly one transporter',
      );
      assertEquals(
        sendMailCalls,
        2,
        'each send must still dispatch its own email',
      );
      assertEquals(
        captured.filter((e) =>
          e.severity === 'METRIC' && e.name === 'EmailSent'
        ).length,
        2,
        'successful sends must emit EmailSent metrics',
      );
    },
  );

  TEST(
    'EmailService',
    'retries transport init after failure and logs a single init error per failed send',
    async () => {
      let createTransportCalls = 0;
      let sendMailCalls = 0;

      const email = new EmailService({
        from: 'system@test.invalid',
        createTransport() {
          createTransportCalls++;
          if (createTransportCalls === 1) {
            throw new Error('email-init-sentinel');
          }
          return {
            sendMail: async () => {
              sendMailCalls++;
              return true;
            },
          } as import('nodemailer').Transporter;
        },
      });
      const { captured, logger } = createCapturedLogger();
      await email.setup(makeMinimalServices(logger));

      const first = await email.send({
        type: 'Login',
        magicLink: 'https://example.com/first',
        to: 'first@test.invalid',
      });
      const second = await email.send({
        type: 'Login',
        magicLink: 'https://example.com/second',
        to: 'second@test.invalid',
      });

      assertFalse(first, 'failed init must return false to caller');
      assertTrue(second, 'cleared init sentinel must allow a later retry');
      assertEquals(
        createTransportCalls,
        2,
        'a failed init must be retried on the next send',
      );
      assertEquals(
        sendMailCalls,
        1,
        'only the successful retry should reach sendMail',
      );
      assertEquals(
        captured.filter((e) =>
          e.severity === 'ERROR' && e.error === 'EmailInitFailed'
        ).length,
        1,
        'failed init must emit one EmailInitFailed log',
      );
      assertEquals(
        captured.filter((e) => e.error === 'EmailSendFailed').length,
        0,
        'init failures must not also emit EmailSendFailed',
      );
    },
  );

  TEST(
    'EmailService',
    'logs EmailSendFailed when sendMail returns false after init',
    async () => {
      const email = new EmailService({
        from: 'system@test.invalid',
        createTransport() {
          return {
            sendMail: async () => false,
          } as import('nodemailer').Transporter;
        },
      });
      const { captured, logger } = createCapturedLogger();
      await email.setup(makeMinimalServices(logger));

      const sent = await email.send({
        type: 'Login',
        magicLink: 'https://example.com/false',
        to: 'false@test.invalid',
      });

      assertFalse(sent, 'false sendMail result must return false to caller');
      assertEquals(
        captured.filter((e) =>
          e.severity === 'INFO' && e.error === 'EmailSendFailed'
        ).length,
        1,
        'false sendMail result must emit one EmailSendFailed log',
      );
    },
  );

  TEST(
    'EmailService',
    'logs EmailSendFailed when sendMail throws after init',
    async () => {
      const email = new EmailService({
        from: 'system@test.invalid',
        createTransport() {
          return {
            sendMail: async () => {
              throw new Error('email-send-sentinel');
            },
          } as import('nodemailer').Transporter;
        },
      });
      const { captured, logger } = createCapturedLogger();
      await email.setup(makeMinimalServices(logger));

      const sent = await email.send({
        type: 'Login',
        magicLink: 'https://example.com/throw',
        to: 'throw@test.invalid',
      });

      assertFalse(sent, 'thrown sendMail error must return false to caller');
      assertEquals(
        captured.filter((e) =>
          e.severity === 'ERROR' && e.error === 'EmailSendFailed'
        ).length,
        1,
        'thrown sendMail error must emit one EmailSendFailed log',
      );
      assertEquals(
        captured.filter((e) => e.error === 'EmailInitFailed').length,
        0,
        'post-init send failures must not be mislabeled as init failures',
      );
    },
  );
}

export function setupEmailServiceServerTests(): void {
  TEST(
    'EmailService',
    'uses nodemailer createTransport by default when no test hook is injected',
    async () => {
      const email = new EmailService(
        {
          from: 'system@test.invalid',
          streamTransport: true,
          buffer: true,
        } as import('../net/server/email.ts').EmailConfig,
      );
      const { captured, logger } = createCapturedLogger();
      await email.setup(makeMinimalServices(logger));

      const sent = await email.send({
        type: 'Login',
        magicLink: 'https://example.com/default',
        to: 'default@test.invalid',
      });

      assertTrue(
        sent,
        'default nodemailer transport path must send successfully',
      );
      assertEquals(
        captured.filter((e) =>
          e.severity === 'METRIC' && e.name === 'EmailSent'
        ).length,
        1,
        'default nodemailer transport path must emit EmailSent metric',
      );
    },
  );
}
