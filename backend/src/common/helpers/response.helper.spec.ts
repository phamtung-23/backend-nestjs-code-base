import { ResponseHelper, SuccessEnvelope } from './response.helper';

describe('ResponseHelper', () => {
  it('wraps data in a success envelope, without meta', () => {
    const envelope = ResponseHelper.success({ id: '1' }, 'Found');

    expect(envelope).toBeInstanceOf(SuccessEnvelope);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual({
      status: 'success',
      message: 'Found',
      data: { id: '1' },
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

  it('adds cursor meta', () => {
    const meta = { limit: 20, nextCursor: 'abc', hasMore: true };

    expect(ResponseHelper.cursorPaginated([{ id: '1' }], meta)).toEqual({
      status: 'success',
      message: 'Request completed successfully',
      data: [{ id: '1' }],
      meta,
    });
  });

  it('restores an envelope that went through JSON', () => {
    const plain = JSON.parse(
      JSON.stringify(
        ResponseHelper.success({ id: '1' }, 'Found', { limit: 1 }),
      ),
    ) as SuccessEnvelope<{ id: string }>;

    const restored = SuccessEnvelope.restore(plain);

    expect(restored).toBeInstanceOf(SuccessEnvelope);
    expect(restored).toEqual({
      status: 'success',
      message: 'Found',
      data: { id: '1' },
      meta: { limit: 1 },
    });
  });
});
