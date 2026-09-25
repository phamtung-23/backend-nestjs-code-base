import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { setupApp } from '../../src/app.setup';
import { MailService } from '../../src/modules/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { REDIS_CLIENT, RedisClient } from '../../src/redis/redis.constants';

type MailKind = 'verification' | 'password-reset' | 'login';

// Stands in for MailService: keeps the codes the app would have emailed
export class FakeMailbox {
  private readonly latest = new Map<string, string>();
  private readonly counts = new Map<string, number>();

  sendVerificationOtp = (email: string, code: string) =>
    this.store(email, 'verification', code);
  sendPasswordResetOtp = (email: string, code: string) =>
    this.store(email, 'password-reset', code);
  sendLoginOtp = (email: string, code: string) =>
    this.store(email, 'login', code);

  sentCount(email: string, kind: MailKind): number {
    return this.counts.get(`${email}:${kind}`) ?? 0;
  }

  // Code-sending flows run after the response, so wait for the email
  async code(email: string, kind: MailKind): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = this.latest.get(`${email}:${kind}`);
      if (code) return code;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`No ${kind} email for ${email}`);
  }

  private store(email: string, kind: MailKind, code: string): Promise<void> {
    const key = `${email}:${kind}`;
    this.latest.set(key, code);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    return Promise.resolve();
  }
}

export interface TestApp {
  app: NestExpressApplication;
  mailbox: FakeMailbox;
  prisma: PrismaService;
  // A supertest agent with its own client IP, so per-IP rate limits of one
  // step don't leak into the next (the app trusts one proxy hop). Pass an IP
  // to act as the same client several times.
  http: (ip?: string) => request.Agent;
}

let ipCounter = 0;
export const nextIp = (): string => {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 65536) % 256}.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
};

// The real AppModule with production wiring (setupApp); only email is faked
export async function createTestApp(): Promise<TestApp> {
  const mailbox = new FakeMailbox();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mailbox)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  setupApp(app);
  await app.init();

  // The Redis client connects in the background; wait so rate limiting and
  // idempotency run against Redis rather than their fallbacks
  const redis = app.get<RedisClient>(REDIS_CLIENT);
  for (let attempt = 0; attempt < 100 && !redis.isReady; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Files run one after another against one Redis and each restarts the IP
  // counter: clear the previous file's rate-limit and idempotency keys
  await redis.flushDb();

  return {
    app,
    mailbox,
    prisma: app.get(PrismaService),
    http: (ip = nextIp()) =>
      request.agent(app.getHttpServer()).set('X-Forwarded-For', ip),
  };
}

export const uniqueEmail = (label: string): string =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
