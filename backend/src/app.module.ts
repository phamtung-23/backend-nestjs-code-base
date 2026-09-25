import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { createKeyv } from '@keyv/redis';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { REDIS_CLIENT, RedisClient } from './redis/redis.constants';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { validateEnv } from './config/env.validation';
import { CONFIG_NAMESPACES, RedisConfig, redisConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
      // Read only validated values; otherwise an empty var dropped by
      // validateEnv would come back as '' from process.env and skip its default
      skipProcessEnv: true,
      // Typed groups for injection: @Inject(authConfig.KEY) auth: AuthConfig
      load: CONFIG_NAMESPACES,
    }),
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: RedisClient) => ({
        throttlers: [
          {
            ttl: 60000, // 1 minute
            limit: 100, // per IP; sensitive routes set stricter limits via @RateLimit
          },
        ],
        // Shared across instances; falls back to memory if Redis is down
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [redisConfig.KEY],
      useFactory: (redis: RedisConfig) => ({
        stores: [
          createKeyv({
            socket: { host: redis.host, port: redis.port },
            password: redis.password || undefined,
          }),
        ],
        ttl: 60 * 60 * 1000, // 1 hour in milliseconds
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    // Global guards run in this order: rate limit, then authentication
    // (skipped for @Public routes), then @Roles checks
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
