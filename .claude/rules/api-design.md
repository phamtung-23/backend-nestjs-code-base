---
paths:
  - "backend/src/**/*.controller.ts"
  - "backend/src/**/dto/**/*.ts"
  - "backend/src/**/*.constants.ts"
  - "backend/src/common/**/*.ts"
  - "backend/src/main.ts"
  - "backend/src/app.setup.ts"
---

# API design

## Resources & naming

- Paths: `/v{n}/<plural-kebab-noun>[/{id}[/<sub-resource>]]` — `/v1/users`, `/v1/users/{id}`,
  `/v1/users/{userId}/sessions`. At most one level of nesting; go deeper with a filter on a top-level resource
  (`/v1/comments?postId=...`).
- Nouns, not verbs. Non-CRUD state transitions are POST verb sub-resources: `POST /v1/orders/{id}/cancel`.
- `/v1/auth/*` (login, refresh-token, ...) is the accepted RPC-style exception.
- `@Controller('users')` + `UsersController`. Route params are `id` or `<entity>Id`. IDs are cuid strings.
- JSON body, query params and response fields are camelCase. Enum values are UPPER_SNAKE (Prisma enums).
  Dates are ISO-8601 UTC strings. Money is integer minor units or a decimal string — never a float.
- Booleans start with `is`/`has`/`can`; collections are plural.

## HTTP methods & status codes

| Operation | Method & path | Success | Body |
| --- | --- | --- | --- |
| List | `GET /things` | 200 | array + `meta` |
| Read | `GET /things/{id}` | 200 | object |
| Create | `POST /things` | 201 | created object |
| Replace | `PUT /things/{id}` | 200 | object |
| Partial update | `PATCH /things/{id}` | 200 | object |
| Delete | `DELETE /things/{id}` | 204 | none — `@HttpCode(HttpStatus.NO_CONTENT)` |
| Action, no new resource | `POST /things/{id}/<action>` | 200 — `@HttpCode(HttpStatus.OK)` | result |
| Long-running job accepted | `POST ...` | 202 | job reference |

- Nest defaults every POST to 201, so each POST that doesn't create a resource needs `@HttpCode(HttpStatus.OK)`.
- GET has no side effects. GET/PUT/DELETE are idempotent. POSTs with side effects support `Idempotency-Key`
  (cross-cutting rule).
- Error statuses and codes: see the errors rule.

## Versioning

- URI versioning is global (`enableVersioning({ type: VersioningType.URI, defaultVersion })`) — never hardcode
  `v1` in a path.
- Backward-compatible additions (new optional field, new endpoint) stay in the current version.
- Breaking changes (remove/rename a field, change a type or meaning, stricter validation) get a new version on the
  affected handlers only (`@Version('2')`). v1 keeps working, is marked `deprecated: true` in `@ApiOperation`,
  and sends `Deprecation` / `Sunset` headers.
- Infra endpoints (`/health`) use `VERSION_NEUTRAL` and are excluded from the global prefix.

## Response envelope

```json
{ "status": "success", "message": "Users retrieved", "data": {}, "meta": {} }
```

- `ResponseInterceptor` wraps anything that isn't already an envelope. Controllers use
  `ResponseHelper.success(data, message)` / `ResponseHelper.paginated(...)` when the message matters.
- Services return domain data, never envelopes and never `{ message }` objects.
- Expose data through response DTOs (`<Entity>ResponseDto`) or explicit mapping — never raw Prisma models that
  include sensitive columns. `meta` appears only on list responses. 204 responses have no body.

## List endpoints: pagination, filter, sort, search, fields, include

Every list endpoint takes a query DTO extending the shared `ListQueryDto` from `src/common/query`, and builds its
Prisma arguments with `parseSort`, `buildSelect` and `buildSearch` from the same module (reference implementation:
`.claude/skills/new-resource/reference/templates.md`). Detail endpoints that support `fields`/`include` take
`ProjectionQueryDto`. Document list responses with `@ApiEnvelopeResponse(Dto, { paginated: true })`.

| Param | Example | Rule |
| --- | --- | --- |
| `page`, `limit` | `?page=2&limit=20` | offset pagination; `page` 1–10 000 (default 1); `limit` 1–100 (default 20) |
| `cursor`, `limit` | `?cursor=Y2t4...&limit=20` | cursor pagination for feeds/large tables; opaque base64url cursor |
| `sort` | `?sort=-createdAt,name` | comma list, `-` = desc; only the resource's SORTABLE fields; `id` tiebreaker always appended |
| `search` | `?search=john` | trimmed, 2–100 chars; case-insensitive `contains` over the SEARCHABLE fields |
| filters | `?status=ACTIVE&createdFrom=2025-01-01` | flat, explicitly declared DTO properties only; ranges use `<field>From` / `<field>To`; multiple values = repeated param (`?status=A&status=B`) |
| `fields` | `?fields=id,name,email` | sparse fieldset → Prisma `select`; FIELDS whitelist only; `id` always included; sensitive columns never selectable |
| `include` | `?include=author,tags` | INCLUDABLE whitelist only, depth ≤ 1; maps to a nested Prisma `select` (Prisma batches it — no N+1) |

- Express 5 uses the "simple" query parser: bracket syntax like `filter[status]=A` is **not** parsed into objects.
  Use flat params.
- Unknown `sort` / `fields` / `include` values → 400 with `errorCode: INVALID_QUERY_PARAM`. Never ignore them
  silently.
- Every whitelist (FIELDS, SORTABLE, SEARCHABLE, INCLUDABLE) holds only columns the caller may see: sorting or
  searching on a hidden column leaks it one comparison at a time. INCLUDABLE entries are `IncludeSpec`s with an
  explicit `select` — never a nested `include`, which returns every column of the related model.
- Offset meta: `{ "page": 2, "limit": 20, "total": 135, "totalPages": 7 }`.
  Cursor meta: `{ "limit": 20, "nextCursor": "..." | null, "hasMore": true }`.

Whitelists live in `<name>.constants.ts`:

```ts
export const USER_SORTABLE = ['createdAt', 'email', 'lastName'] as const;
export const USER_SEARCHABLE = ['email', 'firstName', 'lastName'] as const;
export const USER_FIELDS = ['id', 'email', 'firstName', 'lastName', 'role', 'createdAt'] as const;
export const USER_INCLUDABLE = {
  sessions: { select: { id: true, createdAt: true }, take: 20 },
} as const;
```

## Swagger

- Controller: `@ApiTags`. Every endpoint: `@ApiOperation`, its success response (`@ApiEnvelopeResponse(Dto, ...)`,
  or `@ApiNoContentResponse` for 204), its error responses (`@ApiErrorResponse(status, ...errorCodes)`), and
  `@ApiBearerAuth('JWT-auth')` when protected. Both decorators live in `src/common/decorators`.
- Every DTO property: `@ApiProperty` / `@ApiPropertyOptional` with an example.
