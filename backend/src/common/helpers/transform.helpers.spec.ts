import { TransformFnParams } from 'class-transformer';
import {
  normalizeEmail,
  toArray,
  toBoolean,
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
});
