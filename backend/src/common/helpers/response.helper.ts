import { ApiResponse } from '../interfaces/response.interface';
import { CursorPageMeta } from '../query/cursor.helpers';
import { pageMeta } from '../query/query.helpers';

export const DEFAULT_SUCCESS_MESSAGE = 'Request completed successfully';

type Meta = ApiResponse<unknown>['meta'];

// The success envelope. ResponseInterceptor passes instances through and wraps
// anything else, so data that happens to have `status` and `message` keys is
// never mistaken for an envelope.
export class SuccessEnvelope<T> {
  readonly status = 'success' as const;
  readonly message: string;
  readonly data: T;
  readonly meta?: Meta;

  constructor(data: T, message: string = DEFAULT_SUCCESS_MESSAGE, meta?: Meta) {
    this.message = message;
    this.data = data;
    if (meta) {
      this.meta = meta;
    }
  }

  // Rebuilds an envelope that went through JSON (idempotent replays)
  static restore<T>(plain: {
    data: T;
    message: string;
    meta?: Meta;
  }): SuccessEnvelope<T> {
    return new SuccessEnvelope(plain.data, plain.message, plain.meta);
  }
}

// Success envelopes only. Errors are thrown as exceptions and shaped by
// GlobalExceptionFilter, so they always carry the right HTTP status.
export class ResponseHelper {
  static success<T>(
    data: T,
    message = DEFAULT_SUCCESS_MESSAGE,
    meta?: Meta,
  ): SuccessEnvelope<T> {
    return new SuccessEnvelope(data, message, meta);
  }

  static paginated<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
    message = DEFAULT_SUCCESS_MESSAGE,
  ): SuccessEnvelope<T[]> {
    return new SuccessEnvelope(data, message, pageMeta(page, limit, total));
  }

  // For lists built with cursorArgs / cursorPage
  static cursorPaginated<T>(
    data: T[],
    meta: CursorPageMeta,
    message = DEFAULT_SUCCESS_MESSAGE,
  ): SuccessEnvelope<T[]> {
    return new SuccessEnvelope(data, message, meta);
  }
}
