import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Enable CORS
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:5173'], // Add your frontend URLs
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // API prefix + URI versioning. Traefik strips `/api` upstream, so the
  // backend itself only owns the version segment (e.g. /v1/...).
  const apiPrefix = configService.get<string>('API_PREFIX') ?? '';
  const apiVersion = configService.get<string>('API_VERSION') ?? '1';
  if (apiPrefix) {
    app.setGlobalPrefix(apiPrefix);
  }
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: apiVersion,
  });

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('Backend Base API')
    .setDescription('A comprehensive authentication and user management API')
    .setVersion('1.0')
    .addServer(
      `${configService.get('SWAGGER_PUBLIC_BASE_URL')}`,
      'Development API via Traefik',
    )
    .addServer('http://localhost:3001', 'Development API without Traefik')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = parseInt(configService.get('PORT') as string) || 3000;
  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📚 Swagger documentation: http://localhost:${port}/docs`);
}

void bootstrap();
