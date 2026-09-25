import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

// Documents the success envelope around a response DTO in Swagger:
// @ApiEnvelopeResponse(ArticleResponseDto, { paginated: true })      offset list
// @ApiEnvelopeResponse(AuditLogResponseDto, { paginated: 'cursor' })  cursor list
// @ApiEnvelopeResponse(null) for actions that respond with `data: null`
export function ApiEnvelopeResponse(
  model: Type<unknown> | null,
  options: {
    status?: number;
    description?: string;
    isArray?: boolean;
    paginated?: boolean | 'cursor';
  } = {},
) {
  const { status = 200, description, isArray, paginated } = options;
  const item = model
    ? { $ref: getSchemaPath(model) }
    : { type: 'object', nullable: true, example: null };

  return applyDecorators(
    ...(model ? [ApiExtraModels(model)] : []),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        required: paginated
          ? ['status', 'message', 'data', 'meta']
          : ['status', 'message', 'data'],
        properties: {
          status: { type: 'string', example: 'success' },
          message: { type: 'string' },
          data: isArray || paginated ? { type: 'array', items: item } : item,
          ...(paginated === true && {
            meta: {
              type: 'object',
              required: ['page', 'limit', 'total', 'totalPages'],
              properties: {
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 20 },
                total: { type: 'integer', example: 135 },
                totalPages: { type: 'integer', example: 7 },
              },
            },
          }),
          ...(paginated === 'cursor' && {
            meta: {
              type: 'object',
              required: ['limit', 'nextCursor', 'hasMore'],
              properties: {
                limit: { type: 'integer', example: 20 },
                nextCursor: {
                  type: 'string',
                  nullable: true,
                  example:
                    'eyJmIjoiY3JlYXRlZEF0IiwiZCI6ImRlc2MiLCJ0IjoiZGF0ZSIsInYiOiIyMDI2LTAxLTAxVDA4OjAwOjAwLjAwMFoiLCJpZCI6ImNtdWZzNzllODAwMDlvNGdwdXBsczdpM3kifQ',
                },
                hasMore: { type: 'boolean', example: true },
              },
            },
          }),
        },
      },
    }),
  );
}
