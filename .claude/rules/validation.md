---
paths:
  - "backend/src/**/dto/**/*.ts"
  - "backend/src/**/*.controller.ts"
  - "backend/src/common/query/**/*.ts"
  - "backend/src/app.setup.ts"
---

# Validation & DTOs

- The global `ValidationPipe` in `src/app.setup.ts` (`whitelist`, `forbidNonWhitelisted`, `transform`,
  `exceptionFactory: validationExceptionFactory`) is the only validation pipe. Don't add `new ValidationPipe()` per
  parameter. Reusable `@Transform` functions (`trimString`, `normalizeEmail`, `toArray`, `toBoolean`) live in
  `src/common/helpers/transform.helpers.ts`.
- One DTO per operation: `CreateUserDto`, `UpdateUserDto extends PartialType(CreateUserDto)`,
  `ListUsersQueryDto extends ListQueryDto`, `UserResponseDto`. Import `PartialType` / `PickType` / `OmitType`
  from `@nestjs/swagger` so the docs follow.
- Every property has class-validator decorators plus `@ApiProperty` / `@ApiPropertyOptional`. Optional
  properties put `@IsOptional()` first.

## Field rules

| Kind | Decorators |
| --- | --- |
| String | `@IsString()` + `@MaxLength(n)` always (names 100, email 254, free text as needed); `@IsNotEmpty()` when required; trim with `@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))` |
| Email | `@IsEmail()` `@MaxLength(254)` + lowercase and trim via `@Transform` — Postgres uniqueness is case-sensitive |
| Password | `@IsString()` `@MinLength(8)` `@MaxLength(72)` (bcrypt ignores bytes past 72); never trim |
| Number (query) | `@Type(() => Number)` `@IsInt()` `@Min()` `@Max()` |
| Boolean (query) | `@Transform(({ value }) => value === 'true' \|\| value === true)` `@IsBoolean()` — `@Type(() => Boolean)` turns `"false"` into `true` |
| Enum | `@IsEnum(PrismaEnum)` |
| ID | `@IsString()` `@Matches(/^c[a-z0-9]{24}$/)` for cuid, `@IsUUID()` for UUID |
| Date | `@IsISO8601()`, or `@Type(() => Date)` `@IsDate()` |
| Array | `@IsArray()` `@ArrayMaxSize(n)` + item validators with `{ each: true }` |
| Nested object | `@ValidateNested({ each: true })` `@Type(() => ChildDto)` |
| Multi-value query | `@Transform(({ value }) => (Array.isArray(value) ? value : [value]))` + `@IsArray()` |

## Never trust the client with

- Server-controlled fields: `id`, `role`, `isEmailVerified`, `isActive`, `createdAt`, `updatedAt`, `version`
  on create, `ownerId` / `userId` (take them from the authenticated user).
- Don't spread a DTO straight into Prisma `data` for models with privileged columns; map fields explicitly.
- Env vars get validated at startup (CLAUDE.md "Foundations status"); never use raw `process.env` values unchecked.
