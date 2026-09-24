import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListQueryDto, MAX_PAGE, MAX_PAGE_LIMIT } from './list-query.dto';

const validate = (query: Record<string, unknown>) => {
  const dto = plainToInstance(ListQueryDto, query);
  return { dto, errors: validateSync(dto).map((error) => error.property) };
};

describe('ListQueryDto', () => {
  it('defaults to page 1 and limit 20', () => {
    const { dto, errors } = validate({});
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ page: 1, limit: 20 });
  });

  it('converts numeric query strings', () => {
    expect(validate({ page: '3', limit: '50' }).dto).toMatchObject({
      page: 3,
      limit: 50,
    });
  });

  it.each([
    ['page', '0'],
    ['page', String(MAX_PAGE + 1)],
    ['page', '1e21'],
    ['limit', String(MAX_PAGE_LIMIT + 1)],
    ['search', 'a'],
    ['sort', 'x'.repeat(501)],
    ['fields', 'x'.repeat(501)],
    ['include', 'x'.repeat(501)],
  ])('rejects %s=%s', (key, value) => {
    expect(validate({ [key]: value }).errors).toContain(key);
  });

  it('leaves name checks to the whitelist helpers (digits and unknown names pass here)', () => {
    expect(
      validate({
        sort: '-addressLine2,created_at',
        fields: 'addressLine2',
        include: 'author',
      }).errors,
    ).toEqual([]);
  });

  it('trims the search term', () => {
    expect(validate({ search: '  nest  ' }).dto.search).toBe('nest');
  });
});
