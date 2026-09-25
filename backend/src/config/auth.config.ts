import { ConfigType, registerAs } from '@nestjs/config';
import { readEnv } from './env.validation';

export const authConfig = registerAs('auth', () => {
  const env = readEnv();
  return {
    jwtSecret: env.JWT_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    // jsonwebtoken timespans, e.g. 15m / 7d
    accessTokenTtl: env.JWT_ACCESS_EXPIRES_IN,
    refreshTokenTtl: env.JWT_REFRESH_EXPIRES_IN,
    otpMaxAttempts: env.OTP_MAX_ATTEMPTS,
    otpExpiryMinutes: env.OTP_EXPIRY_MINUTES,
  };
});

export type AuthConfig = ConfigType<typeof authConfig>;
