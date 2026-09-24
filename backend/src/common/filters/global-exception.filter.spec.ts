import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { RequestContext } from '../context/request-context';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let loggerError: jest.SpyInstance;

  const run = (exception: unknown, headerRequestId?: string) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = {
      status,
      getHeader: jest.fn().mockReturnValue(headerRequestId),
    };
    const request = { method: 'POST', originalUrl: '/v1/things?token=abc' };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);
    return { httpStatus: status.mock.calls[0][0], body: json.mock.calls[0][0] };
  };

  const prismaError = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('prisma failure', {
      code,
      clientVersion: 'test',
      meta,
    });

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => loggerError.mockRestore());

  it('builds the error envelope from an exception carrying an errorCode', () => {
    const { httpStatus, body } = run(
      new ConflictException({
        errorCode: 'USER_EMAIL_TAKEN',
        message: 'Email is already registered',
        details: { field: 'email' },
      }),
    );

    expect(httpStatus).toBe(409);
    expect(body).toEqual({
      status: 'error',
      message: 'Email is already registered',
      data: null,
      error: {
        code: 409,
        errorCode: 'USER_EMAIL_TAKEN',
        details: { field: 'email' },
        requestId: null,
        path: '/v1/things',
        timestamp: expect.any(String),
      },
    });
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('derives the errorCode from the status for Nest default bodies', () => {
    const { body } = run(new UnauthorizedException());
    expect(body.message).toBe('Unauthorized');
    expect(body.error.errorCode).toBe('UNAUTHENTICATED');
  });

  it('uses string bodies as the message and maps the status to a code', () => {
    const { httpStatus, body } = run(
      new HttpException('API v1 has been retired', HttpStatus.GONE),
    );
    expect(httpStatus).toBe(410);
    expect(body.message).toBe('API v1 has been retired');
    expect(body.error.errorCode).toBe('GONE');
  });

  it('falls back to BAD_REQUEST for unmapped 4xx statuses', () => {
    const { body } = run(new HttpException('Teapot', HttpStatus.I_AM_A_TEAPOT));
    expect(body.error.errorCode).toBe('BAD_REQUEST');
  });

  it('falls back to the exception message when the body has none', () => {
    const { body } = run(new HttpException({ errorCode: 'CUSTOM' }, 400));
    expect(body.error.errorCode).toBe('CUSTOM');
    expect(typeof body.message).toBe('string');
  });

  it('turns class-validator message arrays into VALIDATION_FAILED details', () => {
    const { body } = run(
      new BadRequestException(['email must be an email', 'name is too long']),
    );
    expect(body.message).toBe('Validation failed');
    expect(body.error.errorCode).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual([
      { field: null, message: 'email must be an email' },
      { field: null, message: 'name is too long' },
    ]);
  });

  it('keeps authored messages of 5xx HttpExceptions and logs them', () => {
    const { httpStatus, body } = run(
      new ServiceUnavailableException('Database is unreachable'),
    );
    expect(httpStatus).toBe(503);
    expect(body.message).toBe('Database is unreachable');
    expect(body.error.errorCode).toBe('SERVICE_UNAVAILABLE');
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('uses INTERNAL_ERROR for unmapped 5xx HttpExceptions', () => {
    const { body } = run(new HttpException('Upstream failed', 502));
    expect(body.error.errorCode).toBe('INTERNAL_ERROR');
  });

  it('maps throttling to 429 RATE_LIMITED with a readable message', () => {
    const { httpStatus, body } = run(new ThrottlerException());
    expect(httpStatus).toBe(429);
    expect(body.error.errorCode).toBe('RATE_LIMITED');
    expect(body.message).toBe('Too many requests, please try again later');
  });

  it('maps Prisma unique violations to 409 with the conflicting fields', () => {
    const { httpStatus, body } = run(
      prismaError('P2002', { target: ['email'] }),
    );
    expect(httpStatus).toBe(409);
    expect(body.error.errorCode).toBe('CONFLICT');
    expect(body.error.details).toEqual({ fields: ['email'] });
    expect(body.message).not.toContain('prisma');
  });

  it('maps Prisma record-not-found to 404 without details', () => {
    const { httpStatus, body } = run(prismaError('P2025'));
    expect(httpStatus).toBe(404);
    expect(body.error.errorCode).toBe('NOT_FOUND');
    expect(body.error.details).toBeNull();
  });

  it('treats unmapped Prisma errors as internal errors', () => {
    const { httpStatus, body } = run(prismaError('P2000'));
    expect(httpStatus).toBe(500);
    expect(body.message).toBe('Internal server error');
  });

  it('maps an unsupported content type from Express to 415', () => {
    const unsupported = Object.assign(new Error('unsupported charset "X"'), {
      status: 415,
      expose: true,
    });
    const { httpStatus, body } = run(unsupported);
    expect(httpStatus).toBe(415);
    expect(body.error.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('falls back to BAD_REQUEST for unmapped exposed 4xx errors', () => {
    const teapot = Object.assign(new Error('teapot'), {
      status: 418,
      expose: true,
    });
    expect(run(teapot).body.error.errorCode).toBe('BAD_REQUEST');
  });

  it('keeps the message of exposed client errors', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
      type: 'entity.too.large',
    });
    const { httpStatus, body } = run(tooLarge);
    expect(httpStatus).toBe(413);
    expect(body.error.errorCode).toBe('PAYLOAD_TOO_LARGE');
    expect(body.message).toBe('request entity too large');
  });

  it('never leaks the message of unexpected errors, but logs the stack', () => {
    const { httpStatus, body } = run(
      new Error('connect ECONNREFUSED postgres://admin:secret@db'),
    );
    expect(httpStatus).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(loggerError).toHaveBeenCalledWith(
      'POST /v1/things failed with 500',
      expect.stringContaining('ECONNREFUSED'),
    );
  });

  it('handles non-Error throwables', () => {
    const { httpStatus } = run('something odd');
    expect(httpStatus).toBe(500);
    expect(loggerError).toHaveBeenCalledWith(
      'POST /v1/things failed with 500',
      'something odd',
    );
  });

  it('does not treat non-exposed or 5xx http-errors as client errors', () => {
    const hidden = Object.assign(new Error('internal detail'), {
      status: 400,
      expose: false,
    });
    const serverSide = Object.assign(new Error('internal detail'), {
      status: 502,
      expose: true,
    });
    expect(run(hidden).httpStatus).toBe(500);
    expect(run(serverSide).httpStatus).toBe(500);
  });

  it('includes the request id from the async context', () => {
    const requestId = RequestContext.run({ requestId: 'req-ctx' }, () =>
      run(new UnauthorizedException()),
    ).body.error.requestId;
    expect(requestId).toBe('req-ctx');
  });

  it('falls back to the response header when the async context is lost', () => {
    const { body } = run(new UnauthorizedException(), 'req-header');
    expect(body.error.requestId).toBe('req-header');
  });
});
