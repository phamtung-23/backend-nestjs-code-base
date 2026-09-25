import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor<unknown>();
  const context = {} as ExecutionContext;

  const respond = (data: unknown) => {
    const next: CallHandler = { handle: () => of(data) };
    return lastValueFrom(interceptor.intercept(context, next));
  };

  it('passes an existing envelope through unchanged', async () => {
    const envelope = {
      status: 'success',
      message: 'Users retrieved',
      data: [{ id: 'user-1' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };

    await expect(respond(envelope)).resolves.toBe(envelope);
  });

  it.each([
    ['an object', { id: 'user-1' }],
    ['an array', [{ id: 'user-1' }]],
    ['a string', 'ok'],
    ['null', null],
    ['an object with a status but no message', { status: 'ACTIVE' }],
  ])('wraps %s in the success envelope', async (_case, data) => {
    await expect(respond(data)).resolves.toEqual({
      status: 'success',
      message: 'Request completed successfully',
      data,
    });
  });
});
