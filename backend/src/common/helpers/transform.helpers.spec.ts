import { TransformFnParams } from 'class-transformer';
import {
  normalizeEmail,
  toArray,
  toBoolean,
  toDate,
  toEndOfDay,
  trimString,
} from './transform.helpers';

const params = (value: unknown) => ({ value }) as TransformFnParams;

describe('transform helpers', () => {
  it('trimString trims strings and leaves other values alone', () => {
    expect(trimString(params('  hi  '))).toBe('hi');
    expect(trimString(params(42))).toBe(42);
  });

  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail(params('  John.Doe@Example.COM '))).toBe(
      'john.doe@example.com',
    );
    expect(normalizeEmail(params(undefined))).toBeUndefined();
  });

  it('toArray wraps single values and keeps arrays and undefined', () => {
    expect(toArray(params('A'))).toEqual(['A']);
    expect(toArray(params(['A', 'B']))).toEqual(['A', 'B']);
    expect(toArray(params(undefined))).toBeUndefined();
  });

  it('toBoolean parses "true"/"false" and leaves anything else for validation', () => {
    expect(toBoolean(params('true'))).toBe(true);
    expect(toBoolean(params(true))).toBe(true);
    expect(toBoolean(params('false'))).toBe(false);
    expect(toBoolean(params(false))).toBe(false);
    expect(toBoolean(params('yes'))).toBe('yes');
  });

  it('toDate parses dates and timestamps with an offset', () => {
    expect(toDate(params('2026-01-01'))).toEqual(
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(toDate(params('2026-01-01T10:00:00Z'))).toEqual(
      new Date('2026-01-01T10:00:00.000Z'),
    );
    expect(toDate(params('2026-01-01T10:00:00.123+07:00'))).toEqual(
      new Date('2026-01-01T03:00:00.123Z'),
    );
    expect(toDate(params('2024-02-29'))).toEqual(
      new Date('2024-02-29T00:00:00.000Z'),
    );
    expect(toDate(params(undefined))).toBeUndefined();
  });

  it.each([
    ['free text', 'nope'],
    ['text Date would still parse', 'hello 2026'],
    ['a bare number', '1'],
    ['an impossible day (Date would roll it over)', '2026-02-30'],
    ['an impossible day in a timestamp', '2026-02-30T10:00:00Z'],
    ['a non-leap-year Feb 29', '2026-02-29'],
    ['an impossible hour', '2026-01-01T25:00:00Z'],
    [
      'a timestamp without an offset (server-timezone dependent)',
      '2026-01-01T10:00:00',
    ],
    ['a space instead of T', '2026-01-01 10:00:00Z'],
  ])('toDate turns %s into an Invalid Date', (_case, value) => {
    expect(Number.isNaN((toDate(params(value)) as Date).getTime())).toBe(true);
  });

  it('toEndOfDay makes a bare date cover the whole day', () => {
    expect(toEndOfDay(params('2026-12-31'))).toEqual(
      new Date('2026-12-31T23:59:59.999Z'),
    );
    expect(toEndOfDay(params('2026-12-31T10:00:00Z'))).toEqual(
      new Date('2026-12-31T10:00:00.000Z'),
    );
    expect(toEndOfDay(params(undefined))).toBeUndefined();
    expect(
      Number.isNaN((toEndOfDay(params('2026-02-30')) as Date).getTime()),
    ).toBe(true);
  });
});
