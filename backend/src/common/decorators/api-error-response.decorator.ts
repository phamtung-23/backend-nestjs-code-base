import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

// Documents the error envelope produced by GlobalExceptionFilter:
// @ApiErrorResponse(404, 'ARTICLE_NOT_FOUND')
// @ApiErrorResponse(409, 'VERSION_CONFLICT', 'USER_EMAIL_TAKEN')
export function ApiErrorResponse(status: number, ...errorCodes: string[]) {
  return applyDecorators(
    ApiResponse({
      status,
      description: errorCodes.join(' | ') || undefined,
      schema: {
        type: 'object',
        required: ['status', 'message', 'data', 'error'],
        properties: {
          status: { type: 'string', example: 'error' },
          message: { type: 'string' },
          data: { type: 'object', nullable: true, example: null },
          error: {
            type: 'object',
            required: [
              'code',
              'errorCode',
              'details',
              'requestId',
              'path',
              'timestamp',
            ],
            properties: {
              code: { type: 'integer', example: status },
              errorCode: {
                type: 'string',
                ...(errorCodes.length > 0 && {
                  enum: errorCodes,
                  example: errorCodes[0],
                }),
              },
              details: {
                nullable: true,
                description:
                  'null, [{ field, message }] for validation errors, or an object',
              },
              requestId: { type: 'string', nullable: true, format: 'uuid' },
              path: { type: 'string', example: '/v1/things' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    }),
  );
}
