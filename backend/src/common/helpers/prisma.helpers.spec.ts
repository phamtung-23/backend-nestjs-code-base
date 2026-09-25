import { Prisma } from '@prisma/client';
import { isPrismaError } from './prisma.helpers';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('prisma failure', {
    code,
    clientVersion: 'test',
  });

describe('isPrismaError', () => {
  it('matches a known Prisma request error with the given code', () => {
    expect(isPrismaError(prismaError('P2002'), 'P2002')).toBe(true);
  });

  it('does not match a known Prisma request error with another code', () => {
    expect(isPrismaError(prismaError('P2025'), 'P2002')).toBe(false);
  });

  it('does not match other errors that happen to carry the same code', () => {
    const lookalike = Object.assign(new Error('duplicate'), { code: 'P2002' });

    expect(isPrismaError(lookalike, 'P2002')).toBe(false);
  });

  it.each([undefined, null, 'P2002', { code: 'P2002' }])(
    'does not match the non-error value %p',
    (value) => {
      expect(isPrismaError(value, 'P2002')).toBe(false);
    },
  );
});
