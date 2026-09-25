import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { AppLogger } from './common/logger/app.logger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(new AppLogger());
  // Run onModuleDestroy/onApplicationShutdown on SIGTERM (docker stop), so
  // Prisma and Redis close their connections cleanly
  app.enableShutdownHooks();
  setupApp(app);

  const port = app.get(ConfigService).get<number>('PORT') ?? 3000;
  await app.listen(port);

  Logger.log(`Application is running on port ${port}`, 'Bootstrap');
}

void bootstrap();
