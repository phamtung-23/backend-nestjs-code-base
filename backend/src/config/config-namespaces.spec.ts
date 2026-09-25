import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { NodeEnv } from './env.validation';
import { CONFIG_NAMESPACES } from './index';
import { mailConfig } from './mail.config';
import { redisConfig } from './redis.config';

describe('config namespaces', () => {
  const originalEnv = process.env;
  const base = {
    DATABASE_URL: 'postgresql://localhost:5432/app',
    JWT_SECRET: 'dev-access-secret',
    JWT_REFRESH_SECRET: 'dev-refresh-secret',
  };

  const withEnv = (env: Record<string, string>) => {
    process.env = { ...base, ...env };
  };

  afterEach(() => {
    process.env = originalEnv;
  });

  it('registers every namespace under its own key', () => {
    expect(CONFIG_NAMESPACES.map((namespace) => namespace.KEY)).toEqual([
      'CONFIGURATION(app)',
      'CONFIGURATION(auth)',
      'CONFIGURATION(mail)',
      'CONFIGURATION(redis)',
    ]);
  });

  describe('app', () => {
    it('groups the HTTP settings with typed values and defaults', () => {
      withEnv({
        PORT: '4000',
        API_PREFIX: 'api',
        ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
        SWAGGER_PUBLIC_BASE_URL: 'https://api.example.com',
        FRONTEND_URL: 'https://app.example.com',
      });

      expect(appConfig()).toEqual({
        nodeEnv: NodeEnv.Development,
        isProduction: false,
        port: 4000,
        apiPrefix: 'api',
        apiVersion: '1',
        allowedOrigins: ['https://a.example.com', 'https://b.example.com'],
        swaggerEnabled: true,
        swaggerPublicBaseUrl: 'https://api.example.com',
        frontendUrl: 'https://app.example.com',
      });
    });

    it('turns Swagger off by default in production, unless enabled', () => {
      const secrets = {
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
      };
      withEnv(secrets);
      expect(appConfig()).toMatchObject({
        isProduction: true,
        swaggerEnabled: false,
      });

      withEnv({ ...secrets, SWAGGER_ENABLED: 'true' });
      expect(appConfig().swaggerEnabled).toBe(true);
    });

    it('treats empty variables as unset', () => {
      withEnv({ PORT: '', API_PREFIX: '' });

      expect(appConfig()).toMatchObject({ port: 3000, apiPrefix: undefined });
    });
  });

  it('auth: secrets, token lifetimes and OTP limits', () => {
    withEnv({ JWT_ACCESS_EXPIRES_IN: '30m', OTP_MAX_ATTEMPTS: '3' });

    expect(authConfig()).toEqual({
      jwtSecret: 'dev-access-secret',
      jwtRefreshSecret: 'dev-refresh-secret',
      accessTokenTtl: '30m',
      refreshTokenTtl: '7d',
      otpMaxAttempts: 3,
      otpExpiryMinutes: 10,
    });
  });

  it('mail: SMTP settings with safe defaults', () => {
    withEnv({});
    expect(mailConfig()).toEqual({
      host: 'localhost',
      port: 587,
      user: undefined,
      pass: undefined,
      from: 'noreply@example.com',
    });

    withEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'secret',
      SMTP_FROM: 'hello@example.com',
    });
    expect(mailConfig()).toEqual({
      host: 'smtp.example.com',
      port: 465,
      user: 'mailer',
      pass: 'secret',
      from: 'hello@example.com',
    });
  });

  it('redis: connection settings', () => {
    withEnv({ REDIS_HOST: 'redis', REDIS_PORT: '6380', REDIS_PASSWORD: 'pw' });

    expect(redisConfig()).toEqual({
      host: 'redis',
      port: 6380,
      password: 'pw',
    });
  });

  it('refuses to build a namespace from an invalid environment', () => {
    process.env = { PORT: 'not-a-port' };

    expect(() => authConfig()).toThrow('Invalid environment configuration');
  });
});
