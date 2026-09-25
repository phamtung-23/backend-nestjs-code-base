import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Starts disposable Postgres and Redis containers (needs Docker), applies the
// migrations, and points the app at them through env vars. Runs once per
// `yarn test:e2e`; tests run in band against the same databases.
export default async function globalSetup(): Promise<void> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  globalThis.__E2E_CONTAINERS__ = [postgres, redis];

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_HOST: redis.getHost(),
    REDIS_PORT: String(redis.getMappedPort(6379)),
    REDIS_PASSWORD: '',
    JWT_SECRET: 'e2e-access-secret',
    JWT_REFRESH_SECRET: 'e2e-refresh-secret',
    SWAGGER_ENABLED: 'false',
    // MailService is replaced by a fake mailbox; nothing is sent
    SMTP_HOST: '127.0.0.1',
  });

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '../..'),
    env: process.env,
    stdio: 'ignore',
  });
}
