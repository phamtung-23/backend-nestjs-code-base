import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseHelper, SuccessEnvelope } from '../helpers/response.helper';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor<unknown>();
  const context = {} as ExecutionContext;

  const respond = (data: unknown) => {
    const next: CallHandler = { handle: () => of(data) };
    return lastValueFrom(interceptor.intercept(context, next));
  };

  it('passes an envelope built with ResponseHelper through unchanged', async () => {
    const envelope = ResponseHelper.paginated(
      [{ id: 'user-1' }],
      1,
      1,
      20,
      'Users retrieved',
    );

    await expect(respond(envelope)).resolves.toBe(envelope);
  });

  it.each([
    ['an object', { id: 'user-1' }],
    ['an array', [{ id: 'user-1' }]],
    ['a string', 'ok'],
    ['null', null],
    [
      'data that merely looks like an envelope',
      { status: 'ACTIVE', message: 'Hello' },
    ],
  ])('wraps %s in the success envelope', async (_case, data) => {
    const response = await respond(data);

    expect(response).toBeInstanceOf(SuccessEnvelope);
    expect(response).toEqual({
      status: 'success',
      message: 'Request completed successfully',
      data,
    });
  });
});
