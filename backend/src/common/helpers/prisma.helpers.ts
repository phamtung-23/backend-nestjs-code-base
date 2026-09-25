import { Prisma } from '@prisma/client';

// For services that translate a specific Prisma error into a domain error,
// e.g. P2002 on users.email -> 409 AUTH_EMAIL_TAKEN. Everything else is mapped
// by GlobalExceptionFilter.
export function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
