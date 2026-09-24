import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { toBoolean } from '../common/helpers/transform.helpers';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

const MIN_PRODUCTION_SECRET_LENGTH = 32;
// Phrases used by the placeholders in .env.sample / backend/.env.example
const PLACEHOLDER_SECRET =
  /your-|change-?in-?production|change-?me|key-?here|placeholder/i;

// An exact origin as the browser sends it: scheme://host[:port], nothing else
function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value &&
      !value.includes('*')
    );
  } catch {
    return false;
  }
}

// Every env var the app reads. Defaults apply when a var is unset or empty
// (docker compose passes unset vars as empty strings).
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsOptional()
  @IsString()
  API_PREFIX?: string;

  @IsString()
  @Matches(/^\d+$/)
  API_VERSION: string = '1';

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;

  @IsString()
  REDIS_HOST: string = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  OTP_MAX_ATTEMPTS: number = 5;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number = 587;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  /** Comma-separated list of exact origins, e.g. https://app.example.com */
  @IsOptional()
  @IsString()
  ALLOWED_ORIGINS?: string;

  /** Defaults to on outside production, off in production */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED?: boolean;

  @IsOptional()
  @IsString()
  SWAGGER_PUBLIC_BASE_URL?: string;

  @IsOptional()
  @IsString()
  FRONTEND_URL?: string;
}

export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Passed to ConfigModule.forRoot({ validate }). Throws, and so stops the app
// from starting, when the configuration is invalid. Messages name the
// variables but never print their values.
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const provided = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== ''),
  );
  const env = plainToInstance(EnvironmentVariables, provided);

  const problems = validateSync(env).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

  const invalidOrigins = parseOrigins(env.ALLOWED_ORIGINS).filter(
    (origin) => !isExactOrigin(origin),
  );
  if (invalidOrigins.length > 0) {
    problems.push(
      `ALLOWED_ORIGINS must list exact http(s) origins without paths or wildcards (invalid: ${invalidOrigins.join(', ')})`,
    );
  }

  if (env.NODE_ENV === NodeEnv.Production) {
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const secret = env[key] ?? '';
      if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
        problems.push(
          `${key} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
        );
      } else if (PLACEHOLDER_SECRET.test(secret)) {
        problems.push(
          `${key} still contains a placeholder value from a sample env file`,
        );
      }
    }
    if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      problems.push('JWT_SECRET and JWT_REFRESH_SECRET must be different');
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n- ${problems.join('\n- ')}`,
    );
  }
  return env;
}
