import { ConfigType, registerAs } from '@nestjs/config';
import { readEnv } from './env.validation';

export const mailConfig = registerAs('mail', () => {
  const env = readEnv();
  return {
    host: env.SMTP_HOST ?? 'localhost',
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM ?? 'noreply@example.com',
  };
});

export type MailConfig = ConfigType<typeof mailConfig>;
