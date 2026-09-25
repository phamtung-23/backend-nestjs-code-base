import { ConfigType, registerAs } from '@nestjs/config';
import { NodeEnv, parseOrigins, readEnv } from './env.validation';

export const appConfig = registerAs('app', () => {
  const env = readEnv();
  const isProduction = env.NODE_ENV === NodeEnv.Production;
  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    apiVersion: env.API_VERSION,
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    swaggerEnabled: env.SWAGGER_ENABLED ?? !isProduction,
    swaggerPublicBaseUrl: env.SWAGGER_PUBLIC_BASE_URL,
    frontendUrl: env.FRONTEND_URL,
  };
});

export type AppConfig = ConfigType<typeof appConfig>;
