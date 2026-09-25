import { Prisma } from '@prisma/client';
import { changedFields } from './audit.helpers';

describe('changedFields', () => {
  it('lists only the fields whose value changes', () => {
    expect(
      changedFields(
        { title: 'Old', status: 'DRAFT', content: 'Same' },
        { title: 'New', status: 'DRAFT', content: 'Same' },
      ),
    ).toEqual({ title: { from: 'Old', to: 'New' } });
  });

  it('skips fields that were not sent', () => {
    expect(changedFields({ title: 'Old' }, { title: undefined })).toEqual({});
  });

  it('records fields that were empty before as null', () => {
    expect(
      changedFields<{ nickname?: string | null }>({}, { nickname: 'Jo' }),
    ).toEqual({ nickname: { from: null, to: 'Jo' } });
  });

  it('compares dates, decimals and JSON by value', () => {
    const before = {
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      price: new Prisma.Decimal('9.90'),
      settings: { theme: 'dark' },
    };

    expect(
      changedFields(before, {
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        price: new Prisma.Decimal('9.90'),
        settings: { theme: 'dark' },
      }),
    ).toEqual({});
    expect(
      changedFields(before, { publishedAt: new Date('2026-02-01') }),
    ).toEqual({
      publishedAt: {
        from: before.publishedAt,
        to: new Date('2026-02-01'),
      },
    });
  });

  it('records clearing a value as a change to null', () => {
    expect(
      changedFields<{ publishedAt: Date | null }>(
        { publishedAt: new Date('2026-01-01') },
        { publishedAt: null },
      ),
    ).toEqual({
      publishedAt: { from: new Date('2026-01-01'), to: null },
    });
  });
});
