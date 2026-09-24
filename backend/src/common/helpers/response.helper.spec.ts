import { ResponseHelper } from './response.helper';

describe('ResponseHelper', () => {
  it('wraps data in a success envelope', () => {
    expect(ResponseHelper.success({ id: '1' }, 'Found')).toEqual({
      status: 'success',
      message: 'Found',
      data: { id: '1' },
      meta: undefined,
    });
  });

  it('uses a default message', () => {
    expect(ResponseHelper.success(null).message).toBe(
      'Request completed successfully',
    );
  });

  it('adds pagination meta including total pages', () => {
    expect(
      ResponseHelper.paginated([{ id: '1' }], 41, 3, 20, 'Listed'),
    ).toEqual({
      status: 'success',
      message: 'Listed',
      data: [{ id: '1' }],
      meta: { page: 3, limit: 20, total: 41, totalPages: 3 },
    });
  });
});
