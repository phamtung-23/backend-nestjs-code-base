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
