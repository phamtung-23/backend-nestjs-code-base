# Response Standard System

Hệ thống standardize response cho Football Web API.

## Cấu trúc Response

Tất cả API response sẽ tuân theo format sau:

```typescript
interface ApiResponse<T> {
  status: 'success' | 'error';
  message: string;
  data?: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
  error?: {
    code: number;
    details?: any;
  };
}
```

## Các Component

### 1. ResponseInterceptor

- Tự động wrap tất cả response thành `ApiResponse` format
- Đã được config global trong `app.module.ts`
- Nếu response đã có format `ApiResponse`, sẽ không thay đổi

### 2. GlobalExceptionFilter

- Handle tất cả exception và convert thành `ApiResponse` format
- Đã được config global trong `app.module.ts`
- Hiển thị stack trace trong development mode

### 3. ResponseHelper

Utility class để tạo response dễ dàng:

```typescript
// Success response
ResponseHelper.success(data, 'Message', meta);

// Error response
ResponseHelper.error('Error message', 400, details);

// Paginated response
ResponseHelper.paginated(data, total, page, limit, 'Message');
```

## Cách sử dụng

### 1. Trả về data trực tiếp (tự động wrap)

```typescript
@Get()
async findAll() {
  return await this.service.findAll(); // Sẽ được wrap tự động
}
```

### 2. Sử dụng ResponseHelper

```typescript
@Get()
async findAll() {
  const data = await this.service.findAll();
  return ResponseHelper.success(data, 'Teams retrieved successfully');
}
```

### 3. Pagination

```typescript
@Get()
async findAll(@Query() query: PaginationDto) {
  const { data, total } = await this.service.findAllPaginated(query);
  return ResponseHelper.paginated(data, total, query.page, query.limit);
}
```

## Ví dụ Response

### Success Response

```json
{
  "status": "success",
  "message": "Teams retrieved successfully",
  "data": [
    {
      "id": "1",
      "name": "Team A"
    }
  ]
}
```

### Error Response

```json
{
  "status": "error",
  "message": "Team not found",
  "data": null,
  "error": {
    "code": 404,
    "details": {
      "path": "/teams/999",
      "method": "GET"
    }
  }
}
```

### Paginated Response

```json
{
  "status": "success",
  "message": "Teams retrieved successfully",
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10
  }
}
```