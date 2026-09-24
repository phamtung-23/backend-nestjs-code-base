import { ApiResponse } from '../interfaces/response.interface';
import { pageMeta } from '../query/query.helpers';

// Success envelopes only. Errors are thrown as exceptions and shaped by
// GlobalExceptionFilter, so they always carry the right HTTP status.
export class ResponseHelper {
  static success<T>(
    data: T,
    message = 'Request completed successfully',
    meta?: ApiResponse<T>['meta'],
  ): ApiResponse<T> {
    return {
      status: 'success',
      message,
      data,
      meta,
    };
  }

  static paginated<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
    message = 'Request completed successfully',
  ): ApiResponse<T[]> {
    return {
      status: 'success',
      message,
      data,
      meta: pageMeta(page, limit, total),
    };
  }
}
