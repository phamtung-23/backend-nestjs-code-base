import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { ErrorCode, STATUS_ERROR_CODES } from '../constants/error-codes';
import { RequestContext } from '../context/request-context';
import { ApiResponse } from '../interfaces/response.interface';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware';

interface NormalizedError {
  status: number;
  errorCode: string;
  message: string;
  details: unknown;
}

// Prisma errors are mapped here once instead of in every service
const PRISMA_ERRORS: Readonly<
  Record<string, Omit<NormalizedError, 'details'>>
> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    errorCode: ErrorCode.CONFLICT,
    message: 'A record with the same unique value already exists',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    errorCode: ErrorCode.NOT_FOUND,
    message: 'Record not found',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    errorCode: ErrorCode.CONFLICT,
    message: 'The operation violates a relation constraint',
  },
  P2034: {
    status: HttpStatus.CONFLICT,
    errorCode: ErrorCode.CONFLICT,
    message: 'Concurrent update conflict, please retry',
  },
};

// http-errors raised by Express middleware, e.g. the body parser's 413/415.
// (Nest already turns its SyntaxError for malformed JSON into a 400.)
interface ExpressHttpError extends Error {
  status: number;
  expose: boolean;
}

const INTERNAL_ERROR: NormalizedError = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  errorCode: ErrorCode.INTERNAL_ERROR,
  message: 'Internal server error',
  details: null,
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const error = this.normalize(exception);
    const path = request.originalUrl.split('?')[0];

    if (error.status >= 500) {
      this.logger.error(
        `${request.method} ${path} failed with ${error.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiResponse<null> = {
      status: 'error',
      message: error.message,
      data: null,
      error: {
        code: error.status,
        errorCode: error.errorCode,
        details: error.details,
        // The async context is lost inside some Express middleware (body parser)
        requestId:
          RequestContext.requestId() ??
          (response.getHeader(REQUEST_ID_HEADER) as string | undefined) ??
          null,
        path,
        timestamp: new Date().toISOString(),
      },
    };

    response.status(error.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        errorCode: ErrorCode.RATE_LIMITED,
        message: 'Too many requests, please try again later',
        details: null,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      PRISMA_ERRORS[exception.code]
    ) {
      return {
        ...PRISMA_ERRORS[exception.code],
        details:
          exception.code === 'P2002'
            ? { fields: exception.meta?.target ?? null }
            : null,
      };
    }

    if (this.isExposedClientError(exception)) {
      return {
        status: exception.status,
        errorCode:
          STATUS_ERROR_CODES[exception.status] ?? ErrorCode.BAD_REQUEST,
        message: exception.message,
        details: null,
      };
    }

    // Unexpected errors never leak their message, stack or SQL to the client
    return INTERNAL_ERROR;
  }

  private fromHttpException(exception: HttpException): NormalizedError {
    const status = exception.getStatus();
    const fallbackCode =
      STATUS_ERROR_CODES[status] ??
      (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST);
    const body = exception.getResponse();

    if (typeof body === 'string') {
      return { status, errorCode: fallbackCode, message: body, details: null };
    }

    const { errorCode, message, details } = body as {
      errorCode?: string;
      message?: string | string[];
      details?: unknown;
    };

    // class-validator messages from a pipe that doesn't use our exceptionFactory
    if (Array.isArray(message)) {
      return {
        status,
        errorCode: errorCode ?? ErrorCode.VALIDATION_FAILED,
        message: 'Validation failed',
        // The field is unknown here; keep the { field, message } shape anyway
        details: message.map((text) => ({ field: null, message: text })),
      };
    }

    return {
      status,
      errorCode: errorCode ?? fallbackCode,
      message: message ?? exception.message,
      details: details ?? null,
    };
  }

  private isExposedClientError(
    exception: unknown,
  ): exception is ExpressHttpError {
    if (!(exception instanceof Error)) return false;
    const candidate = exception as Partial<ExpressHttpError>;
    return (
      candidate.expose === true &&
      typeof candidate.status === 'number' &&
      candidate.status >= 400 &&
      candidate.status < 500
    );
  }
}
