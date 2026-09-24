# Response & Error Standard

Chuẩn response dùng chung cho mọi API. Chi tiết quy ước nằm ở `.claude/rules/api-design.md` và
`.claude/rules/errors.md`.

## Success envelope

```typescript
interface ApiResponse<T> {
  status: 'success' | 'error';
  message: string;
  data?: T;
  meta?: { page?: number; limit?: number; total?: number; totalPages?: number };
  error?: ApiErrorBody; // chỉ có ở response lỗi
}
```

- `ResponseInterceptor` (global) tự wrap dữ liệu controller trả về thành envelope. Nếu object trả về đã có cả
  `status` và `message` thì được coi là envelope và giữ nguyên.
- `ResponseHelper` tạo envelope khi cần message cụ thể:

```typescript
ResponseHelper.success(data, 'Article created');
ResponseHelper.paginated(items, total, page, limit, 'Articles retrieved'); // meta có totalPages
```

- Không có helper cho lỗi: lỗi luôn được **throw** để `GlobalExceptionFilter` trả đúng HTTP status.

## Error envelope

```json
{
  "status": "error",
  "message": "Email is already registered",
  "data": null,
  "error": {
    "code": 409,
    "errorCode": "USER_EMAIL_TAKEN",
    "details": null,
    "requestId": "7f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
    "path": "/v1/users",
    "timestamp": "2026-01-01T00:00:00.000Z"
  }
}
```

- `errorCode`: mã ổn định cho client xử lý (không dựa vào `message`). Mã chung ở `constants/error-codes.ts`;
  exception không kèm `errorCode` sẽ nhận mã theo HTTP status.
- Validation lỗi → 400 `VALIDATION_FAILED`, `details = [{ field, message }]` (field lồng nhau dạng `items.0.name`).
- Lỗi Prisma được map tập trung: P2002 → 409 `CONFLICT` (kèm `details.fields`), P2025 → 404, P2003/P2034 → 409.
- Lỗi không lường trước → 500 `INTERNAL_ERROR` với message chung, không lộ chi tiết; stack được ghi log.

Cách throw:

```typescript
throw new ConflictException({
  errorCode: 'USER_EMAIL_TAKEN',
  message: 'Email is already registered',
});
```

## Request ID

- Mọi response có header `X-Request-Id`, luôn do server sinh (không dùng id client gửi lên).
- Id này nằm trong `error.requestId` và được `AppLogger` gắn vào mọi dòng log trong request (`[req <id>]`),
  nên có thể tra log từ một response lỗi.
- Lấy id ở bất kỳ đâu: `RequestContext.requestId()`.

## List query

`query/` chứa `ListQueryDto` (page, limit ≤ 100, sort, search, fields, include), `ProjectionQueryDto` và các
helper `parseSort`, `buildSelect`, `buildSearch`, `pageMeta`. Module mẫu dùng đầy đủ các helper này nằm ở
`.claude/skills/new-resource/reference/templates.md`.
