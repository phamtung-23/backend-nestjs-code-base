import { BadRequestException } from '@nestjs/common';
import { buildSearch, buildSelect, pageMeta, parseSort } from './query.helpers';

const SORTABLE = ['createdAt', 'title'] as const;
const PROJECTION = {
  fields: ['title', 'status'],
  includable: { author: { select: { id: true, firstName: true } } },
};

const expectInvalidParam = (fn: () => unknown, param: string) => {
  try {
    fn();
    throw new Error('expected an exception');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      errorCode: 'INVALID_QUERY_PARAM',
      details: { param },
    });
  }
};

describe('parseSort', () => {
  it('uses the default sort and appends the id tiebreaker', () => {
    expect(parseSort(undefined, SORTABLE, '-createdAt')).toEqual([
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('parses ascending and descending fields in order, ignoring duplicates', () => {
    expect(parseSort('title,-createdAt,title', SORTABLE, 'title')).toEqual([
      { title: 'asc' },
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('does not add a second id entry when id is already sorted', () => {
    expect(parseSort('-id', [...SORTABLE, 'id'], 'title')).toEqual([
      { id: 'desc' },
    ]);
  });

  it('rejects fields outside the whitelist', () => {
    expectInvalidParam(() => parseSort('password', SORTABLE, 'title'), 'sort');
  });
});

describe('buildSelect', () => {
  it('selects id plus every whitelisted field by default', () => {
    expect(buildSelect({}, PROJECTION)).toEqual({
      id: true,
      title: true,
      status: true,
    });
  });

  it('selects only the requested fields plus id, and whitelisted relations', () => {
    expect(
      buildSelect({ fields: 'title', include: 'author' }, PROJECTION),
    ).toEqual({
      id: true,
      title: true,
      author: { select: { id: true, firstName: true } },
    });
  });

  it('rejects fields outside the whitelist', () => {
    expectInvalidParam(
      () => buildSelect({ fields: 'title,password' }, PROJECTION),
      'fields',
    );
  });

  it('rejects relations outside the whitelist', () => {
    expectInvalidParam(
      () => buildSelect({ include: 'comments' }, PROJECTION),
      'include',
    );
  });
});

describe('buildSearch', () => {
  it('returns undefined without a search term', () => {
    expect(buildSearch(undefined, ['title'])).toBeUndefined();
    expect(buildSearch('', ['title'])).toBeUndefined();
  });

  it('builds a case-insensitive contains condition per field', () => {
    expect(buildSearch('nest', ['title', 'content'])).toEqual([
      { title: { contains: 'nest', mode: 'insensitive' } },
      { content: { contains: 'nest', mode: 'insensitive' } },
    ]);
  });
});

describe('pageMeta', () => {
  it('computes total pages', () => {
    expect(pageMeta(2, 20, 45)).toEqual({
      page: 2,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
  });

  it('reports zero pages for an empty result', () => {
    expect(pageMeta(1, 20, 0).totalPages).toBe(0);
  });
});
