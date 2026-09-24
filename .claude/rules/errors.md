---
paths:
  - "backend/src/**/*.ts"
---

# Error handling

## Error response format (GlobalExceptionFilter)

```json
{
  "status": "error",
  "message": "Email is already registered",
  "data": null,
  "error": {
    "code": 409,
    "errorCode": "USER_EMAIL_TAKEN",
    "details": null,
    "requestId": "7f1c...",
    "path": "/v1/users",
    "timestamp": "2026-01-01T00:00:00.000Z"
  }
}
```

- `message`: always a string, human readable, safe to show to end users.
- `error.code`: HTTP status (existing field — keep it for compatibility).
- `error.errorCode`: stable machine-readable UPPER_SNAKE code; clients branch on this, never on `message`.
- `error.details`: `null`, an array of `{ field, message }` for validation errors (nested paths joined with
  dots), or a small object for other structured context.
- The current filter lacks `errorCode` / `requestId` / `path` / `timestamp`, returns message arrays for
  validation errors, leaks internal messages of non-HTTP errors, and doesn't log (see CLAUDE.md
  "Foundations status"). When you touch the filter, bring it to this format.

## Throwing errors

```ts
throw new ConflictException({
  errorCode: UserErrorCode.EMAIL_TAKEN,
  message: 'Email is already registered',
});
```

- Generic codes live in `src/common/constants/error-codes.ts` (`VALIDATION_FAILED`, `INVALID_QUERY_PARAM`,
  `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VERSION_CONFLICT`, `RATE_LIMITED`,
  `INTERNAL_ERROR`, ...). Module codes live in `<name>.constants.ts`, prefixed with the domain (`USER_`,
  `AUTH_`, `ORDER_`). Codes are public contract: add new ones, never rename or reuse.
- Status choice:

| Status | When | Example errorCode |
| --- | --- | --- |
| 400 | malformed input, DTO validation failure, bad query param | `VALIDATION_FAILED`, `INVALID_QUERY_PARAM` |
| 401 | missing / invalid / expired credentials | `UNAUTHENTICATED` |
| 403 | authenticated but not allowed | `FORBIDDEN` |
| 404 | missing, or exists but the caller may not see it | `USER_NOT_FOUND` |
| 409 | unique violation, optimistic-lock mismatch, lost state race, idempotency key in progress | `USER_EMAIL_TAKEN`, `VERSION_CONFLICT` |
| 412 | `If-Match` / ETag mismatch | `PRECONDITION_FAILED` |
| 422 | well-formed input that breaks a business rule | `ORDER_ALREADY_SHIPPED` |
| 429 | rate limited | `RATE_LIMITED` |
| 500 / 503 | unexpected failure / dependency down | `INTERNAL_ERROR` / `SERVICE_UNAVAILABLE` |

- Never 401 for "already exists", never 400 for "not found".
- Repositories return `null` instead of throwing; services translate to domain errors.
- Don't swallow errors. Catch only to translate (e.g. Prisma P2002 → 409 with a specific code) or add context,
  and rethrow anything unexpected.

## Prisma errors

Map them once, in the global filter, not in each service:

| Prisma code | Meaning | Response |
| --- | --- | --- |
| P2002 | unique constraint | 409 `CONFLICT`, `details: { fields: meta.target }` |
| P2025 | record to update/delete not found | 404 `NOT_FOUND` |
| P2003 | foreign key constraint | 409 `CONFLICT` |
| P2034 | transaction write conflict / deadlock | 409 `CONFLICT` (client may retry) |

A service may still catch P2002 around one specific write to return a more precise code (`USER_EMAIL_TAKEN`).

## 5xx and logging

- 5xx responses always say `"Internal server error"` — never `exception.message`, stack traces, SQL or Prisma text.
  Include `requestId` so support can correlate.
- Log every 5xx with `logger.error(message, stack)` plus the requestId. Log 4xx only when useful (auth failures at
  `warn`, without secrets).
