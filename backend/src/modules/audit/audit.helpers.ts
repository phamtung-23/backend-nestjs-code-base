import { Prisma } from '@prisma/client';

// Dates, Decimals and Json values are objects: `!==` would always see a change
const sameValue = (a: unknown, b: unknown): boolean =>
  a !== null && b !== null && typeof a === 'object' && typeof b === 'object'
    ? JSON.stringify(a) === JSON.stringify(b)
    : a === b;

// `changes` for an audit entry: the fields of `patch` whose value differs from
// `before`, as { field: { from, to } }. Undefined patch values (not sent) are
// skipped. Don't pass secret fields.
export function changedFields<T extends object>(
  before: T,
  patch: Partial<T>,
): Prisma.InputJsonObject {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, to] of Object.entries(patch)) {
    const from = (before as Record<string, unknown>)[field];
    if (to !== undefined && !sameValue(from, to)) {
      changes[field] = { from: from ?? null, to };
    }
  }
  return changes as Prisma.InputJsonObject;
}
