import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';
import { parseSort, SortDirection } from './query.helpers';

export interface CursorPageMeta {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

// A cursor list sorts by one field, then by id in the same direction. The
// field must be non-nullable: keyset comparisons never match NULL.
export interface CursorSort<F extends string> {
  field: F;
  direction: SortDirection;
}

type CursorValue = Date | number | string;

// Encoded in the cursor: the sort it belongs to, and the last row's sort value
// (typed, so a date comes back as a Date) and id
interface CursorPayload {
  f: string;
  d: SortDirection;
  t: 'date' | 'number' | 'string';
  v: string | number;
  id: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CURSOR_ID = /^[A-Za-z0-9_-]{1,100}$/;
// Keeps cursors within CursorListQueryDto's 500 characters
const MAX_STRING_VALUE = 200;

const invalidCursor = (
  message = 'Invalid cursor; pass meta.nextCursor unchanged',
) =>
  new BadRequestException({
    errorCode: ErrorCode.INVALID_QUERY_PARAM,
    message,
    details: { param: 'cursor' },
  });

// "-createdAt" -> { field: 'createdAt', direction: 'desc' }. Exactly one
// whitelisted field; unknown ones get parseSort's INVALID_QUERY_PARAM.
export function parseCursorSort<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
  defaultSort: string,
): CursorSort<F> {
  const tokens = (sort ?? defaultSort)
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length !== 1) {
    throw new BadRequestException({
      errorCode: ErrorCode.INVALID_QUERY_PARAM,
      message: 'Cursor lists sort by exactly one field',
      details: { param: 'sort', allowed },
    });
  }
  const [first] = parseSort(tokens[0], allowed, defaultSort);
  const [field, direction] = Object.entries(first)[0] as [F, SortDirection];
  return { field, direction };
}

export function cursorOrderBy<O>(sort: CursorSort<string>): O[] {
  const entries: Record<string, SortDirection>[] =
    sort.field === 'id'
      ? [{ id: sort.direction }]
      : [{ [sort.field]: sort.direction }, { id: sort.direction }];
  return entries as O[];
}

// The next cursor is built from the sort field, so the query must select it
// even when ?fields= leaves it out (cursorPage strips it again)
export function cursorSelect<S>(select: S, sort: CursorSort<string>): S {
  return { ...select, [sort.field]: true };
}

export function encodeCursor(
  sort: CursorSort<string>,
  row: { id: string } & Record<string, unknown>,
): string {
  const value = row[sort.field];
  let typed: Pick<CursorPayload, 't' | 'v'>;
  if (value instanceof Date) {
    typed = { t: 'date', v: value.toISOString() };
  } else if (typeof value === 'number') {
    typed = { t: 'number', v: value };
  } else if (typeof value === 'string' && value.length <= MAX_STRING_VALUE) {
    typed = { t: 'string', v: value };
  } else {
    throw new Error(
      `Cursor sort field "${sort.field}" must be a non-null date, number or short string`,
    );
  }
  const payload: CursorPayload = {
    f: sort.field,
    d: sort.direction,
    ...typed,
    id: row.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeValue(type: unknown, value: unknown): CursorValue | undefined {
  if (type === 'date' && typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (type === 'number' && typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (
    type === 'string' &&
    typeof value === 'string' &&
    value.length <= MAX_STRING_VALUE
  ) {
    return value;
  }
  return undefined;
}

export function decodeCursor(
  cursor: string,
  sort: CursorSort<string>,
): { value: CursorValue; id: string } {
  // Node's decoder skips characters outside the alphabet; don't accept them
  if (!BASE64URL.test(cursor)) {
    throw invalidCursor();
  }
  let payload: Partial<CursorPayload> | null;
  try {
    payload = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<CursorPayload> | null;
  } catch {
    throw invalidCursor();
  }
  if (typeof payload !== 'object' || payload === null) {
    throw invalidCursor();
  }
  if (payload.f !== sort.field || payload.d !== sort.direction) {
    throw invalidCursor(
      'This cursor belongs to another sort; repeat the sort of the page it came from',
    );
  }
  const value = decodeValue(payload.t, payload.v);
  if (
    value === undefined ||
    typeof payload.id !== 'string' ||
    !CURSOR_ID.test(payload.id)
  ) {
    throw invalidCursor();
  }
  return { value, id: payload.id };
}

// Rows after the cursor, as a Prisma where to AND with the list filters.
// Descending: field <= v AND (field < v OR (field = v AND id < cursorId)),
// mirrored for ascending. The leading bound lets the field's index skip
// straight to the position (no OFFSET, no scan of earlier rows), and the
// cursor row itself needn't exist anymore.
export function cursorWhere<W>(
  cursor: string | undefined,
  sort: CursorSort<string>,
): W | undefined {
  if (!cursor) {
    return undefined;
  }
  const { value, id } = decodeCursor(cursor, sort);
  const [past, upTo] =
    sort.direction === 'desc' ? ['lt', 'lte'] : ['gt', 'gte'];
  if (sort.field === 'id') {
    return { id: { [past]: id } } as W;
  }
  return {
    [sort.field]: { [upTo]: value },
    OR: [
      { [sort.field]: { [past]: value } },
      { [sort.field]: value, id: { [past]: id } },
    ],
  } as W;
}

// Query with `take: limit + 1`: the extra row tells whether another page
// follows, so no count is needed. Drops it, builds the next cursor from the
// last item, and strips the sort field when ?fields= didn't ask for it.
export function cursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  sort: CursorSort<string>,
  select: Record<string, unknown>,
): { items: T[]; meta: CursorPageMeta } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? encodeCursor(sort, page[page.length - 1] as T & Record<string, unknown>)
    : null;
  const items = select[sort.field]
    ? page
    : page.map((row) => {
        const copy: Record<string, unknown> = { ...row };
        delete copy[sort.field];
        return copy as T;
      });
  return { items, meta: { limit, nextCursor, hasMore } };
}
