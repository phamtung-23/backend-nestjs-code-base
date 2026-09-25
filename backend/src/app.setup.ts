import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './common/middleware/request-id.middleware';
import { validationExceptionFactory } from './common/pipes/validation-exception.factory';
import { AppConfig, appConfig } from './config/app.config';

const SWAGGER_PATH = 'docs';
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

// Everything main.ts applies to the Nest app, kept in one place so e2e tests
// can bootstrap an identical app.
export function setupApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(appConfig.KEY);

  // Traefik sits in front of the app. Trust one proxy hop so req.ip (used by
  // the throttler) is the real client IP rather than Traefik's.
  app.set('trust proxy', 1);

  // Runs before the body parser so even malformed-JSON errors get an id
  app.use(requestIdMiddleware);

  // Swagger UI relies on inline scripts, so only the docs skip the CSP
  const apiHelmet = helmet();
  const docsHelmet = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(`/${SWAGGER_PATH}`)
      ? docsHelmet(req, res, next)
      : apiHelmet(req, res, next),
  );

  const origins = config.allowedOrigins;
  app.enableCors({
    // No configured origins: localhost in development, no CORS in production
    origin:
      origins.length > 0 ? origins : config.isProduction ? false : DEV_ORIGINS,
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // API prefix + URI versioning. Traefik strips `/api` upstream, so the
  // backend itself only owns the version segment (e.g. /v1/...).
  if (config.apiPrefix) {
    // /health stays at the root for the Docker healthchecks
    app.setGlobalPrefix(config.apiPrefix, { exclude: ['health'] });
  }
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.apiVersion,
  });

  if (config.swaggerEnabled) {
    setupSwagger(app, config);
  }
}

function setupSwagger(app: NestExpressApplication, config: AppConfig): void {
  const builder = new DocumentBuilder()
    .setTitle('Backend Base API')
    .setDescription('A comprehensive authentication and user management API')
    .setVersion('1.0');
  if (config.swaggerPublicBaseUrl) {
    builder.addServer(config.swaggerPublicBaseUrl, 'API via Traefik');
  }
  const document = builder
    .addServer(`http://localhost:${config.port}`, 'API without Traefik')
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

  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    SwaggerModule.createDocument(app, document),
    { swaggerOptions: { persistAuthorization: true } },
  );
}
