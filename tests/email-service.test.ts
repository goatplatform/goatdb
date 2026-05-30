import { TEST } from './mod.ts';
import { assertEquals, assertFalse, assertTrue } from './asserts.ts';
import type { NormalizedLogEntry } from '../logging/entry.ts';
import type { LogEntry, LogStream } from '../logging/log.ts';
import { newLogger } from '../logging/log.ts';
import { EmailService } from '../net/server/email.ts';
import type { ServerServices } from '../net/server/server.ts';
import type { Schema } from '../cfds/base/schema.ts';
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

function createCapturedLogger(): {
  captured: NormalizedLogEntry<LogEntry>[];
  logger: ReturnType<typeof newLogger>;
} {
  const captured: NormalizedLogEntry<LogEntry>[] = [];
  const stream: LogStream = {
    appendEntry(e): void {
      captured.push(e);
    },
  };
  return {
    captured,
    logger: newLogger([stream]),
  };
}

function createServices(logger: ReturnType<typeof newLogger>) {
  return {
    logger,
    buildInfo: createBuildInfo(),
    appName: 'GOAT Test App',
  } as unknown as ServerServices<Schema>;
}

export default function setupEmailServiceTests(): void {
  TEST(
    'EmailService',
    'initializes transport lazily on first send and deduplicates concurrent init',
    async () => {
      const nodemailer = await import('nodemailer');
      const originalCreateTransport = nodemailer.default.createTransport;
      let createTransportCalls = 0;
      let sendMailCalls = 0;
      try {
        nodemailer.default.createTransport = (() => {
          createTransportCalls++;
          return {
            sendMail: async () => {
              sendMailCalls++;
              return true;
            },
          } as import('nodemailer').Transporter;
        }) as typeof nodemailer.default.createTransport;

        const email = new EmailService({ from: 'system@test.invalid' });
        const { captured, logger } = createCapturedLogger();
        await email.setup(createServices(logger));

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
      } finally {
        nodemailer.default.createTransport = originalCreateTransport;
      }
    },
  );

  TEST(
    'EmailService',
    'retries transport init after failure and logs a single init error per failed send',
    async () => {
      const nodemailer = await import('nodemailer');
      const originalCreateTransport = nodemailer.default.createTransport;
      let createTransportCalls = 0;
      let sendMailCalls = 0;
      try {
        nodemailer.default.createTransport = (() => {
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
        }) as typeof nodemailer.default.createTransport;

        const email = new EmailService({ from: 'system@test.invalid' });
        const { captured, logger } = createCapturedLogger();
        await email.setup(createServices(logger));

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
      } finally {
        nodemailer.default.createTransport = originalCreateTransport;
      }
    },
  );
}
