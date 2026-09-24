# Foundations — shared building blocks

The rules and the `new-resource` templates depend on these pieces. Check CLAUDE.md "Foundations status" first;
build whatever a task needs that is still ❌, **with unit tests**, then flip its row to ✅ in the same change.

## 1–4. Already in the repo (source of truth — read the files, don't copy from here)

| Piece | File |
| --- | --- |
| Error codes + status fallback map | `backend/src/common/constants/error-codes.ts` |
| DTO transform helpers (`trimString`, `normalizeEmail`, `toArray`, `toBoolean`) | `backend/src/common/helpers/transform.helpers.ts` |
| List query contract (`ListQueryDto`, `ProjectionQueryDto`, `parseSort`, `buildSelect` + `IncludeSpec`, `buildSearch`, `pageMeta`) | `backend/src/common/query/` |
| Pagination meta with `totalPages` | `ResponseHelper.paginated` in `backend/src/common/helpers/response.helper.ts` |
| Swagger decorators (`ApiEnvelopeResponse`, `ApiErrorResponse`) | `backend/src/common/decorators/` |
| Error format, Prisma mapping, 5xx logging | `backend/src/common/filters/global-exception.filter.ts`, `backend/src/common/pipes/validation-exception.factory.ts` |
| Request ID + log correlation | `backend/src/common/middleware/request-id.middleware.ts`, `backend/src/common/context/request-context.ts`, `backend/src/common/logger/app.logger.ts` |
| Env validation | `backend/src/config/env.validation.ts` |
| CORS, helmet, `SWAGGER_ENABLED`, pipes, versioning | `backend/src/app.setup.ts` |

The code in section 5 was compiled, linted and exercised end-to-end over HTTP against PostgreSQL — copy it as-is.
Section 6 lists pieces that are specified but not written yet.

## 5. Auth building blocks: `@CurrentUser()`, `@Public()`, `@Roles()`, global guards

These live in the auth module (it owns authentication), not in `common`.
`backend/src/modules/auth/decorators/current-user.decorator.ts`

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, User } from '../interfaces/auth.interface';

// @CurrentUser() user: User — the user attached by JwtStrategy
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
```

`backend/src/modules/auth/decorators/public.decorator.ts`

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Opts a route or controller out of the global JwtAuthGuard
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

`backend/src/modules/auth/decorators/roles.decorator.ts`

```ts
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

`backend/src/modules/auth/guards/jwt-auth.guard.ts`

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Registered as APP_GUARD: every route requires a valid access token unless
// it is marked @Public()
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }
}
```

`backend/src/modules/auth/guards/roles.guard.ts`

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ErrorCode } from '../../../common/constants/error-codes';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from '../interfaces/auth.interface';

// Registered as APP_GUARD after JwtAuthGuard; no-op for routes without @Roles()
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user && roles.includes(user.role)) return true;

    throw new ForbiddenException({
      errorCode: ErrorCode.FORBIDDEN,
      message: 'You do not have permission to perform this action',
    });
  }
}
```

Switching to secure-by-default (one change):

1. Replace `guards/jwt-auth.guard.ts` with the version above and add `guards/roles.guard.ts`.
2. Register the guards in `AppModule.providers`, **in this order** (APP_GUARDs run in registration order):
   `ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard`.
3. Mark every open route `@Public()`: `/health`, and in `AuthController` login, register, verify-email,
   resend-verification, forgot-password, reset-password, send-otp, verify-otp, refresh-token, logout. Remove the
   now-redundant `@UseGuards(JwtAuthGuard)` from protected routes.
4. Make `JwtStrategy.validate` return `null` for users with `isActive === false`.
5. Tests: guard specs (public route passes, protected route delegates to passport, roles allow/deny with
   `FORBIDDEN`), plus e2e/manual checks that every public auth route still works without a token.
6. Update CLAUDE.md "Foundations status" and the security rule's "until then" note.

## 6. Specified, not yet written

Implement each one following its rule, with tests, then update CLAUDE.md.

| Piece | Where | Spec |
| --- | --- | --- |
| Typed config namespaces | `src/config/*.config.ts` with `registerAs` | group settings (`auth`, `redis`, `mail`, ...) and inject them with `ConfigType<typeof authConfig>` instead of `ConfigService.get('KEY')`. |
| Audit log | `modules/audit/` (`AuditService.log(entry, tx?)`) + `AuditLog` model + migration | `.claude/rules/cross-cutting.md`. |
| Idempotency | `common/decorators/idempotent.decorator.ts` + `common/interceptors/idempotency.interceptor.ts` (Redis via `CACHE_MANAGER` or a dedicated client with `SET NX`) | `.claude/rules/cross-cutting.md`. |
| Redis throttler storage | `ThrottlerModule.forRootAsync` with a Redis storage adapter | needed before running more than one instance. |
| Hashed refresh tokens | auth module + migration | store `sha256(token)`, look up by hash; revoke all tokens on password change/reset; reuse of a revoked token revokes the whole family. |
| e2e setup | `backend/test/jest-e2e.json`, `test/*.e2e-spec.ts` | `.claude/rules/testing.md`; bootstrap the app with `setupApp(app)` from `src/app.setup.ts` so tests match production wiring. |
