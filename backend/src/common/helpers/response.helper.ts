import { ApiResponse } from '../interfaces/response.interface';

export class ResponseHelper {
  static success<T>(
    data: T,
    message = 'Request completed successfully',
    meta?: {
      total?: number;
      page?: number;
      limit?: number;
    },
  ): ApiResponse<T> {
    return {
      status: 'success',
      message,
      data,
      meta,
    };
  }

  static error(
    message: string,
    code: number,
    details?: any,
  ): ApiResponse<null> {
    return {
      status: 'error',
      message,
      data: null,
      error: {
        code,
        details,
      },
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
      meta: {
        total,
        page,
        limit,
      },
    };
  }
}
