import { TEST, type TestSuite } from './mod.ts';
import { assertEquals, assertFalse, assertTrue } from './asserts.ts';
import * as path from '../base/path.ts';
import type { Logger } from '../logging/log.ts';
import { createCapturedLogger } from './test-utils.ts';
import { EmailService, isEmailInitError } from '../net/server/email.ts';
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

type CapturedMessage = {
  to?: string | string[];
  subject?: string;
  text?: string | Uint8Array;
  html?: string | Uint8Array;
  from?: string;
  sender?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  headers?: Record<string, string>;
  attachments?: { filename?: string; content?: unknown }[];
};

async function runDenoCommand(
  args: string[],
  cacheDir: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
    args,
    env: { DENO_DIR: cacheDir },
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

export default function setupEmailServiceTests(): void {
  TEST(
    'EmailService',
    'isEmailInitError requires the explicit true marker',
    () => {
      const branded = new Error('branded') as Error & {
        emailInitFailed?: boolean;
      };
      branded.emailInitFailed = true;
      assertTrue(isEmailInitError(branded), 'true marker must be accepted');

      const falseMarker = new Error('false-marker') as Error & {
        emailInitFailed?: boolean;
      };
      falseMarker.emailInitFailed = false;
      assertFalse(
        isEmailInitError(falseMarker),
        'false marker must not be accepted',
      );

      assertFalse(
        isEmailInitError(new Error('plain')),
        'plain errors must not be accepted',
      );
    },
  );

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
          } as unknown as import('nodemailer').Transporter;
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
    'passes through standard nodemailer message fields from custom builders',
    async () => {
      let capturedMessage: CapturedMessage | undefined;

      const email = new EmailService({
        from: 'system@test.invalid',
        sender: 'sender@test.invalid',
        cc: ['cc@test.invalid'],
        bcc: ['bcc@test.invalid'],
        replyTo: 'reply@test.invalid',
        builder: () => ({
          to: 'custom@test.invalid',
          subject: 'Custom subject',
          text: 'Custom text',
          html: '<p>Custom html</p>',
          headers: { 'x-goatdb': 'present' },
          attachments: [{ filename: 'note.txt', content: 'hello' }],
        }),
        createTransport() {
          return {
            sendMail: async (msg: CapturedMessage) => {
              capturedMessage = msg;
              return true;
            },
          } as unknown as import('nodemailer').Transporter;
        },
      });
      const { logger } = createCapturedLogger();
      await email.setup(makeMinimalServices(logger));

      const sent = await email.send({
        type: 'Login',
        magicLink: 'https://example.com/custom',
        to: 'ignored@test.invalid',
      });

      assertTrue(sent, 'custom builder send must succeed');
      assertEquals(capturedMessage?.to, 'custom@test.invalid');
      assertEquals(capturedMessage?.subject, 'Custom subject');
      assertEquals(capturedMessage?.text, 'Custom text');
      assertEquals(capturedMessage?.html, '<p>Custom html</p>');
      assertEquals(capturedMessage?.from, 'system@test.invalid');
      assertEquals(capturedMessage?.sender, 'sender@test.invalid');
      assertEquals(capturedMessage?.cc, ['cc@test.invalid']);
      assertEquals(capturedMessage?.bcc, ['bcc@test.invalid']);
      assertEquals(capturedMessage?.replyTo, 'reply@test.invalid');
      assertEquals(capturedMessage?.headers?.['x-goatdb'], 'present');
      assertEquals(capturedMessage?.attachments?.[0]?.filename, 'note.txt');
      assertEquals(capturedMessage?.attachments?.[0]?.content, 'hello');
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
          } as unknown as import('nodemailer').Transporter;
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
          } as unknown as import('nodemailer').Transporter;
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
          } as unknown as import('nodemailer').Transporter;
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

export function setupEmailServiceDenoTests(): void {
  TEST(
    'EmailService',
    'public EmailMessage facade typechecks offline without node_modules',
    async (ctx: TestSuite) => {
      const dir = await ctx.tempDir('email-message-deno-check');
      const entryPath = path.join(dir, 'email-message-check.ts');
      const root = Deno.cwd();
      const configPath = path.join(root, 'deno.json');
      const packagePath = path.join(root, 'package.json');
      const denoConfig = JSON.parse(await Deno.readTextFile(configPath)) as {
        exports: Record<string, string>;
      };
      const packageConfig = JSON.parse(
        await Deno.readTextFile(packagePath),
      ) as {
        exports: Record<string, string>;
      };
      const emailExport = denoConfig.exports['./server/email'];
      assertEquals(emailExport, './server/email.ts');
      assertEquals(packageConfig.exports['./server/email'], emailExport);
      const emailModule = path.toFileUrl(path.join(root, emailExport)).href;

      await Deno.writeTextFile(
        entryPath,
        [
          `import type { EmailMessage } from ${JSON.stringify(emailModule)};`,
          'const message: EmailMessage = {',
          "  to: [{ name: 'User', address: 'user@test.invalid' }],",
          "  headers: { 'x-goatdb': ['present'] },",
          "  attachments: [{ filename: 'note.txt', content: new Uint8Array([1]) }],",
          "  emailType: 'Login',",
          '};',
          '// @ts-expect-error recipients must be email addresses',
          'const invalidRecipient: EmailMessage = { to: 42 };',
          '// @ts-expect-error header values must be strings',
          'const invalidHeader: EmailMessage = { headers: { test: 42 } };',
          '// @ts-expect-error attachment content must be portable',
          'const invalidAttachment: EmailMessage = { attachments: [{ content: 42 }] };',
          'void [message, invalidRecipient, invalidHeader, invalidAttachment];',
          '',
        ].join('\n'),
      );

      const result = await runDenoCommand([
        'check',
        '--no-remote',
        '--node-modules-dir=false',
        '--config',
        configPath,
        entryPath,
      ], path.join(dir, 'deno-dir'));

      assertEquals(
        result.code,
        0,
        `Public EmailMessage facade must typecheck offline from a fresh cache without node_modules\n${result.stderr}`,
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
          builder: () => ({
            attachments: [{
              filename: 'bytes.bin',
              content: new Uint8Array([1]),
            }],
          }),
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

  TEST(
    'EmailService',
    'converts portable binary message content before sending',
    async () => {
      const { Buffer } = await import('node:buffer');
      let captured: CapturedMessage | undefined;
      const email = new EmailService({
        from: 'system@test.invalid',
        builder: () => ({
          text: new Uint8Array([1, 2]),
          html: new Uint8Array([3, 4]),
          attachments: [{ content: new Uint8Array([5, 6]) }],
        }),
        createTransport() {
          return {
            sendMail: async (message: CapturedMessage) => {
              captured = message;
              return true;
            },
          } as unknown as import('nodemailer').Transporter;
        },
      });
      const { logger } = createCapturedLogger();
      await email.setup(makeMinimalServices(logger));
      assertTrue(
        await email.send({
          type: 'Login',
          magicLink: 'https://example.com/binary',
          to: 'binary@test.invalid',
        }),
      );

      assertTrue(captured?.text instanceof Buffer);
      assertTrue(captured?.html instanceof Buffer);
      assertTrue(captured?.attachments?.[0]?.content instanceof Buffer);
      assertEquals(Array.from(captured?.text as Uint8Array), [1, 2]);
      assertEquals(Array.from(captured?.html as Uint8Array), [3, 4]);
      assertEquals(
        Array.from(captured?.attachments?.[0]?.content as Uint8Array),
        [5, 6],
      );
    },
  );

  TEST(
    'EmailService',
    'default nodemailer path logs EmailInitFailed when transporter creation throws',
    async () => {
      const email = new EmailService(
        {
          from: 'system@test.invalid',
          get send() {
            throw new Error('email-init-sentinel');
          },
        } as unknown as import('../net/server/email.ts').EmailConfig,
      );
      const { captured, logger } = createCapturedLogger();
      await email.setup(makeMinimalServices(logger));

      const sent = await email.send({
        type: 'Login',
        magicLink: 'https://example.com/default-init-failure',
        to: 'default-init-failure@test.invalid',
      });

      assertFalse(sent, 'transport init failure must return false to caller');
      assertEquals(
        captured.filter((e) =>
          e.severity === 'ERROR' && e.error === 'EmailInitFailed'
        ).length,
        1,
        'default nodemailer init failure must emit EmailInitFailed',
      );
      assertEquals(
        captured.filter((e) => e.error === 'EmailSendFailed').length,
        0,
        'default nodemailer init failure must not emit EmailSendFailed',
      );
    },
  );

  TEST(
    'EmailService',
    'default nodemailer path logs EmailSendFailed when sendMail throws after init',
    async () => {
      const email = new EmailService(
        {
          from: 'system@test.invalid',
          send() {
            throw new Error('email-send-sentinel');
          },
        } as unknown as import('../net/server/email.ts').EmailConfig,
      );
      const { captured, logger } = createCapturedLogger();
      await email.setup(makeMinimalServices(logger));

      const sent = await email.send({
        type: 'Login',
        magicLink: 'https://example.com/default-send-failure',
        to: 'default-send-failure@test.invalid',
      });

      assertFalse(sent, 'sendMail failure must return false to caller');
      assertEquals(
        captured.filter((e) =>
          e.severity === 'ERROR' && e.error === 'EmailSendFailed'
        ).length,
        1,
        'default nodemailer send failure must emit EmailSendFailed',
      );
      assertEquals(
        captured.filter((e) => e.error === 'EmailInitFailed').length,
        0,
        'post-init default nodemailer send failure must not emit EmailInitFailed',
      );
    },
  );
}
