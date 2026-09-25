import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { mailConfig } from './mail.config';
import { redisConfig } from './redis.config';

export * from './app.config';
export * from './auth.config';
export * from './mail.config';
export * from './redis.config';

// Loaded by ConfigModule.forRoot({ load }); inject one with
// @Inject(authConfig.KEY) private readonly auth: AuthConfig
export const CONFIG_NAMESPACES = [
  appConfig,
  authConfig,
  mailConfig,
  redisConfig,
];
