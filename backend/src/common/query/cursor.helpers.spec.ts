import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';
import {
  cursorOrderBy,
  cursorPage,
  cursorSelect,
  cursorWhere,
  CursorSort,
  decodeCursor,
  encodeCursor,
  parseCursorSort,
} from './cursor.helpers';

const ID = 'cmufs79e80009o4gpupls7i3y';
const AT = new Date('2026-01-01T08:00:00.000Z');
const NEWEST_FIRST: CursorSort<string> = {
  field: 'createdAt',
  direction: 'desc',
};
const OLDEST_FIRST: CursorSort<string> = {
  field: 'createdAt',
  direction: 'asc',
};
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const payload = (overrides: Record<string, unknown> = {}) => ({
  f: 'createdAt',
  d: 'desc',
  t: 'date',
  v: AT.toISOString(),
  id: ID,
  ...overrides,
});

const expectInvalid = (call: () => unknown, param: string) => {
  let error: unknown;
  try {
    call();
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(BadRequestException);
  expect((error as BadRequestException).getResponse()).toMatchObject({
    errorCode: ErrorCode.INVALID_QUERY_PARAM,
    details: expect.objectContaining({ param }),
  });
};

describe('cursor helpers', () => {
  describe('parseCursorSort', () => {
    const allowed = ['createdAt', 'name'] as const;

    it('reads one field and its direction, with a default', () => {
      expect(parseCursorSort('-createdAt', allowed, 'name')).toEqual(
        NEWEST_FIRST,
      );
      expect(parseCursorSort(undefined, allowed, 'name')).toEqual({
        field: 'name',
        direction: 'asc',
      });
    });

    it.each([
      ['more than one field', 'createdAt,name'],
      ['the same field twice', 'createdAt,-createdAt'],
      ['a field outside the whitelist', 'password'],
    ])('rejects %s with 400 INVALID_QUERY_PARAM', (_case, sort) => {
      expectInvalid(() => parseCursorSort(sort, allowed, 'name'), 'sort');
    });
  });

  it('orders by the field, then by id in the same direction', () => {
    expect(cursorOrderBy(NEWEST_FIRST)).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(cursorOrderBy({ field: 'id', direction: 'asc' })).toEqual([
      { id: 'asc' },
    ]);
  });

  it('always selects the sort field, since the next cursor needs it', () => {
    expect(cursorSelect({ id: true, action: true }, NEWEST_FIRST)).toEqual({
      id: true,
      action: true,
      createdAt: true,
    });
  });

  describe('encodeCursor / decodeCursor', () => {
    it('round-trips the sort value with its type, and the id, in a URL-safe cursor', () => {
      const cursor = encodeCursor(NEWEST_FIRST, { id: ID, createdAt: AT });

      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeCursor(cursor, NEWEST_FIRST)).toEqual({ value: AT, id: ID });
    });

    it.each([
      ['a number', 42],
      ['a string', 'Jane'],
    ])('round-trips %s sort value', (_case, value) => {
      const sort = { field: 'rank', direction: 'asc' as const };

      expect(
        decodeCursor(encodeCursor(sort, { id: ID, rank: value }), sort),
      ).toEqual({ value, id: ID });
    });

    it.each([
      ['null', null],
      ['missing', undefined],
      ['an object', { nested: true }],
      ['a string that would make the cursor too long', 'x'.repeat(201)],
    ])('refuses to encode a sort value that is %s', (_case, value) => {
      expect(() =>
        encodeCursor(NEWEST_FIRST, { id: ID, createdAt: value }),
      ).toThrow('must be a non-null date, number or short string');
    });

    it('rejects a cursor made for another sort field or direction', () => {
      const cursor = encodeCursor(NEWEST_FIRST, { id: ID, createdAt: AT });

      expectInvalid(() => decodeCursor(cursor, OLDEST_FIRST), 'cursor');
      expectInvalid(
        () => decodeCursor(cursor, { field: 'name', direction: 'desc' }),
        'cursor',
      );
    });

    it.each([
      ['not base64 JSON', 'bm90LWpzb24'],
      ['JSON null', encode(null)],
      ['an array', encode([1])],
      ['a valid cursor with junk appended', `${encode(payload())}!!!`],
      ['a valid cursor with a dot inside', `${encode(payload())}.x`],
      ['an unknown value type', encode(payload({ t: 'boolean', v: true }))],
      ['an invalid date', encode(payload({ v: 'not-a-date' }))],
      ['a date type with a number', encode(payload({ v: 5 }))],
      ['a non-finite number', encode(payload({ t: 'number', v: null }))],
      [
        'a string too long',
        encode(payload({ t: 'string', v: 'x'.repeat(201) })),
      ],
      ['a missing id', encode(payload({ id: undefined }))],
      ['an id with other characters', encode(payload({ id: "x' OR 1=1" }))],
    ])(
      'rejects a cursor that is %s with 400 INVALID_QUERY_PARAM',
      (_case, cursor) => {
        expectInvalid(() => decodeCursor(cursor, NEWEST_FIRST), 'cursor');
      },
    );
  });

  describe('cursorWhere', () => {
    it('is empty on the first page', () => {
      expect(cursorWhere(undefined, NEWEST_FIRST)).toBeUndefined();
    });

    it('continues below the cursor when newest first, with an index-friendly leading bound', () => {
      const cursor = encodeCursor(NEWEST_FIRST, { id: ID, createdAt: AT });

      expect(cursorWhere(cursor, NEWEST_FIRST)).toEqual({
        createdAt: { lte: AT },
        OR: [{ createdAt: { lt: AT } }, { createdAt: AT, id: { lt: ID } }],
      });
    });

    it('continues above the cursor when oldest first', () => {
      const cursor = encodeCursor(OLDEST_FIRST, { id: ID, createdAt: AT });

      expect(cursorWhere(cursor, OLDEST_FIRST)).toEqual({
        createdAt: { gte: AT },
        OR: [{ createdAt: { gt: AT } }, { createdAt: AT, id: { gt: ID } }],
      });
    });

    it('compares only the id when sorting by id', () => {
      const sort = { field: 'id', direction: 'desc' as const };

      expect(cursorWhere(encodeCursor(sort, { id: ID }), sort)).toEqual({
        id: { lt: ID },
      });
    });
  });

  describe('cursorPage', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `row${i}`,
        action: 'user.registered',
        createdAt: new Date(AT.getTime() - i * 1000),
      }));
    const select = { id: true, action: true, createdAt: true };

    it('drops the extra row and builds the next cursor from the last item', () => {
      const { items, meta } = cursorPage(rows(3), 2, NEWEST_FIRST, select);

      expect(items).toEqual(rows(2));
      expect(meta).toEqual({
        limit: 2,
        nextCursor: encodeCursor(NEWEST_FIRST, rows(2)[1]),
        hasMore: true,
      });
    });

    it.each([
      ['a short page', 1],
      ['an exactly full page', 2],
      ['an empty page', 0],
    ])('reports no next page for %s', (_case, count) => {
      const { items, meta } = cursorPage(rows(count), 2, NEWEST_FIRST, select);

      expect(items).toEqual(rows(count));
      expect(meta).toEqual({ limit: 2, nextCursor: null, hasMore: false });
    });

    it('strips the sort field when ?fields= did not ask for it', () => {
      const { items, meta } = cursorPage(rows(2), 1, NEWEST_FIRST, {
        id: true,
        action: true,
      });

      expect(items).toEqual([{ id: 'row0', action: 'user.registered' }]);
      expect(meta.nextCursor).toBe(encodeCursor(NEWEST_FIRST, rows(1)[0]));
    });
  });
});
