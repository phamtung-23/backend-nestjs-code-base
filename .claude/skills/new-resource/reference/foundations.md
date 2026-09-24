# Foundations — shared building blocks

The rules and the `new-resource` templates depend on these pieces. Check CLAUDE.md "Foundations status" first;
build whatever a task needs that is still ❌, **with unit tests**, then flip its row to ✅ in the same change.
The code in sections 1–5 was compiled, linted and exercised end-to-end over HTTP against PostgreSQL — copy it as-is.
Section 6 lists pieces that are specified but not written yet.

## 1. Error codes
`backend/src/common/constants/error-codes.ts`

```ts
// Generic error codes returned in `error.errorCode`. Public contract: add new
// codes, never rename or reuse existing ones.
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_QUERY_PARAM: 'INVALID_QUERY_PARAM',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_KEY_IN_PROGRESS: 'IDEMPOTENCY_KEY_IN_PROGRESS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

## 2. DTO transform helpers
`backend/src/common/helpers/transform.helpers.ts`

```ts
import { TransformFnParams } from 'class-transformer';

// Reusable class-transformer functions for DTOs: @Transform(trimString)

export const trimString = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const normalizeEmail = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// Repeated query params arrive as an array, a single one as a string
export const toArray = ({ value }: TransformFnParams): unknown =>
  value === undefined || Array.isArray(value) ? value : [value];

// @Type(() => Boolean) would turn "false" into true
export const toBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};
```

## 3. List query contract (pagination, sort, search, fields, include)
`backend/src/common/query/list-query.dto.ts`

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { trimString } from '../helpers/transform.helpers';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

const FIELD_LIST = /^[A-Za-z]+(,[A-Za-z]+)*$/;
const SORT_LIST = /^-?[A-Za-z]+(,-?[A-Za-z]+)*$/;

// ?fields= and ?include= — also usable on GET /things/{id}
export class ProjectionQueryDto {
  @ApiPropertyOptional({
    example: 'id,title,createdAt',
    description: 'Sparse fieldset (comma-separated, whitelisted per resource)',
  })
  @IsOptional()
  @IsString()
  @Matches(FIELD_LIST)
  fields?: string;

  @ApiPropertyOptional({
    example: 'author',
    description:
      'Relations to embed (comma-separated, whitelisted per resource)',
  })
  @IsOptional()
  @IsString()
  @Matches(FIELD_LIST)
  include?: string;
}

export class ListQueryDto extends ProjectionQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;

  @ApiPropertyOptional({
    example: '-createdAt,title',
    description: 'Comma-separated fields; prefix with - for descending',
  })
  @IsOptional()
  @IsString()
  @Matches(SORT_LIST)
  sort?: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(2, 100)
  search?: string;
}
```

`backend/src/common/query/query.helpers.ts`

```ts
import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

export type SortDirection = 'asc' | 'desc';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function assertAllowed<T extends string>(
  param: string,
  values: string[],
  allowed: readonly T[],
): T[] {
  const invalid = values.filter((value) => !allowed.includes(value as T));
  if (invalid.length > 0) {
    throw new BadRequestException({
      errorCode: ErrorCode.INVALID_QUERY_PARAM,
      message: `Invalid ${param}: ${invalid.join(', ')}`,
      details: { param, invalid, allowed },
    });
  }
  return values as T[];
}

const splitList = (raw: string): string[] => [
  ...new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];

export type OrderByEntry<F extends string> = Partial<
  Record<F | 'id', SortDirection>
>;

// "-createdAt,title" -> [{ createdAt: 'desc' }, { title: 'asc' }, { id: 'asc' }]
export function parseSort<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
  defaultSort: string,
): OrderByEntry<F>[] {
  const orderBy: OrderByEntry<F>[] = [];

  for (const token of splitList(sort ?? defaultSort)) {
    const field = token.replace(/^-/, '');
    assertAllowed('sort', [field], allowed);
    const direction: SortDirection = token.startsWith('-') ? 'desc' : 'asc';
    orderBy.push({ [field]: direction } as OrderByEntry<F>);
  }

  // id tiebreaker keeps pagination stable when sort values are equal
  if (!orderBy.some((entry) => 'id' in entry)) {
    orderBy.push({ id: 'asc' } as OrderByEntry<F>);
  }
  return orderBy;
}

// Builds one Prisma `select` from ?fields= and ?include= (Prisma forbids
// `select` + `include` at the same level). `id` is always selected.
// Include values are nested selects, so relations load in batched queries.
export function buildSelect<S>(
  query: { fields?: string; include?: string },
  spec: {
    fields: readonly string[];
    includable: Readonly<Record<string, object>>;
  },
): S {
  const select: Record<string, unknown> = { id: true };

  const fields = query.fields
    ? assertAllowed('fields', splitList(query.fields), spec.fields)
    : spec.fields;
  for (const field of fields) select[field] = true;

  if (query.include) {
    const relations = assertAllowed(
      'include',
      splitList(query.include),
      Object.keys(spec.includable),
    );
    for (const relation of relations) {
      select[relation] = spec.includable[relation];
    }
  }
  return select as S;
}

// Case-insensitive `contains` over whitelisted string columns, for `OR`
export function buildSearch<W>(
  search: string | undefined,
  fields: readonly string[],
): W[] | undefined {
  if (!search) return undefined;
  return fields.map(
    (field) => ({ [field]: { contains: search, mode: 'insensitive' } }) as W,
  );
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
```

`backend/src/common/query/index.ts`

```ts
export * from './list-query.dto';
export * from './query.helpers';
```

Also add `totalPages` to the list meta. In `src/common/interfaces/response.interface.ts`, add `totalPages?: number`
to `meta`. In `ResponseHelper.paginated`, build the meta with the helper:

```ts
import { pageMeta } from '../query/query.helpers';
// ...
return { status: 'success', message, data, meta: pageMeta(page, limit, total) };
```

Tests to add: `query.helpers.spec.ts` covering sort parsing (asc/desc, id tiebreaker, duplicates, invalid field →
400 `INVALID_QUERY_PARAM`), `buildSelect` (default fields, sparse fields, include, invalid values),
`buildSearch` (undefined when empty) and `pageMeta`. Add `**/query/*.ts` to `collectCoverageFrom`.

## 4. Swagger envelope decorator
`backend/src/common/decorators/api-envelope-response.decorator.ts`

```ts
import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

// Documents the success envelope around a response DTO in Swagger:
// @ApiEnvelopeResponse(ArticleResponseDto, { paginated: true })
export function ApiEnvelopeResponse(
  model: Type<unknown>,
  options: {
    status?: number;
    description?: string;
    isArray?: boolean;
    paginated?: boolean;
  } = {},
) {
  const { status = 200, description, isArray, paginated } = options;
  const item = { $ref: getSchemaPath(model) };

  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: ['status', 'message', 'data'],
        properties: {
          status: { type: 'string', example: 'success' },
          message: { type: 'string' },
          data: isArray || paginated ? { type: 'array', items: item } : item,
          ...(paginated && {
            meta: {
              type: 'object',
              properties: {
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 20 },
                total: { type: 'integer', example: 135 },
                totalPages: { type: 'integer', example: 7 },
              },
            },
          }),
        },
      },
    }),
  );
}
```

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
| Error format upgrade | `common/filters/global-exception.filter.ts` | `.claude/rules/errors.md`: `errorCode` (from the exception body, or derived from the status), `details` (flattened validation errors), `requestId`, `path`, `timestamp`, Prisma P2002/P2025/P2003/P2034 mapping, generic 5xx message in production, `Logger.error` for 5xx. The ValidationPipe needs an `exceptionFactory` that throws `BadRequestException({ errorCode: 'VALIDATION_FAILED', message: 'Validation failed', details: [{ field, message }] })`. |
| Env validation + typed config | `src/config/` (`env.validation.ts`, `registerAs` namespaces) | class-validator schema for every env var, wired through `ConfigModule.forRoot({ validate })`; the app refuses to start on invalid config. |
| CORS + helmet + Swagger flag | `main.ts` | `ALLOWED_ORIGINS` split on commas; `helmet()`; Swagger only when `SWAGGER_ENABLED=true` (default off in production). |
| Request ID | `common/middleware/request-id.middleware.ts` + `AsyncLocalStorage` | `.claude/rules/cross-cutting.md`. |
| Audit log | `modules/audit/` (`AuditService.log(entry, tx?)`) + `AuditLog` model + migration | `.claude/rules/cross-cutting.md`. |
| Idempotency | `common/decorators/idempotent.decorator.ts` + `common/interceptors/idempotency.interceptor.ts` (Redis via `CACHE_MANAGER` or a dedicated client with `SET NX`) | `.claude/rules/cross-cutting.md`. |
| Redis throttler storage | `ThrottlerModule.forRootAsync` with a Redis storage adapter | needed before running more than one instance. |
| Hashed refresh tokens | auth module + migration | store `sha256(token)`, look up by hash; revoke all tokens on password change/reset; reuse of a revoked token revokes the whole family. |
| e2e setup | `backend/test/jest-e2e.json`, `test/*.e2e-spec.ts` | `.claude/rules/testing.md`. |
