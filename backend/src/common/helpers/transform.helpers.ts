import { TransformFnParams } from 'class-transformer';

// Reusable class-transformer functions for DTOs: @Transform(trimString)

export const trimString = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const normalizeEmail = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// Repeated query params arrive as an array, a single one as a string
export const toArray = ({ value }: TransformFnParams): unknown =>
  value === undefined || Array.isArray(value) ? value : [value];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// With an explicit offset: without one, Date reads it in the server's timezone
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

// Date rolls impossible days over ("2026-02-30" becomes March 2nd)
const isRealDay = (day: string): boolean => {
  const parsed = new Date(`${day}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
  );
};

// Query dates: "2026-01-01" (UTC midnight) or an ISO-8601 timestamp with `Z` or
// an offset. Anything else becomes an Invalid Date, which @IsDate rejects.
export const toDate = ({ value }: TransformFnParams): unknown => {
  if (typeof value !== 'string') return value;
  const isIso =
    (DATE_ONLY.test(value) || TIMESTAMP.test(value)) &&
    isRealDay(value.slice(0, 10));
  return new Date(isIso ? value : Number.NaN);
};

// Upper bounds of a range: a bare date means the whole day, so
// createdTo=2026-12-31 includes everything on the 31st
export const toEndOfDay = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && DATE_ONLY.test(value) && isRealDay(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : toDate({ value } as TransformFnParams);

// @Type(() => Boolean) would turn "false" into true
export const toBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};
