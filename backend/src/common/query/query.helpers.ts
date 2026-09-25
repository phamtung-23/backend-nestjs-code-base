import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

export type SortDirection = 'asc' | 'desc';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function assertAllowed<T extends string>(
  param: string,
  values: string[],
  allowed: readonly T[],
): T[] {
  const invalid = values.filter((value) => !allowed.includes(value as T));
  if (invalid.length > 0) {
    throw new BadRequestException({
      errorCode: ErrorCode.INVALID_QUERY_PARAM,
      message: `Invalid ${param}: ${invalid.join(', ')}`,
      details: { param, invalid, allowed },
    });
  }
  return values as T[];
}

const splitList = (raw: string): string[] => [
  ...new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];

export type OrderByEntry<F extends string> = Partial<
  Record<F | 'id', SortDirection>
>;

// "-createdAt,title" -> [{ createdAt: 'desc' }, { title: 'asc' }, { id: 'asc' }]
export function parseSort<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
  defaultSort: string,
): OrderByEntry<F>[] {
  const orderBy: OrderByEntry<F>[] = [];

  for (const token of splitList(sort ?? defaultSort)) {
    const field = token.replace(/^-/, '');
    assertAllowed('sort', [field], allowed);
    const direction: SortDirection = token.startsWith('-') ? 'desc' : 'asc';
    orderBy.push({ [field]: direction } as OrderByEntry<F>);
  }

  // id tiebreaker keeps pagination stable when sort values are equal
  if (!orderBy.some((entry) => 'id' in entry)) {
    orderBy.push({ id: 'asc' } as OrderByEntry<F>);
  }
  return orderBy;
}

// An embeddable relation must list its columns: a nested `include` would
// return every column of the related model (password hashes included)
export interface IncludeSpec {
  select: Record<string, unknown>;
  take?: number;
  orderBy?: unknown;
  where?: unknown;
}

// Builds one Prisma `select` from ?fields= and ?include= (Prisma forbids
// `select` + `include` at the same level). `id` is always selected.
// Include values are nested selects, so relations load in batched queries.
export function buildSelect<S>(
  query: { fields?: string; include?: string },
  spec: {
    fields: readonly string[];
    includable: Readonly<Record<string, IncludeSpec>>;
  },
): S {
  const select: Record<string, unknown> = { id: true };

  // `id` is always selected, so asking for it is allowed but changes nothing
  const fields = query.fields
    ? assertAllowed(
        'fields',
        splitList(query.fields).filter((field) => field !== 'id'),
        spec.fields,
      )
    : spec.fields;
  for (const field of fields) select[field] = true;

  if (query.include) {
    const relations = assertAllowed(
      'include',
      splitList(query.include),
      Object.keys(spec.includable),
    );
    for (const relation of relations) {
      select[relation] = spec.includable[relation];
    }
  }
  return select as S;
}

// Case-insensitive `contains` over whitelisted string columns, for `OR`
export function buildSearch<W>(
  search: string | undefined,
  fields: readonly string[],
): W[] | undefined {
  if (!search) return undefined;
  return fields.map(
    (field) => ({ [field]: { contains: search, mode: 'insensitive' } }) as W,
  );
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
