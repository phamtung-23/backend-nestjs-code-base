// Shared by the auth unit specs; excluded from the build (tsconfig.build.json)
import { HttpException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { ClientMeta } from '../../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import {
  PublicUser,
  UserWithPassword,
} from '../../users/interfaces/user.interface';
import { UsersService } from '../../users/users.service';
import { CodeDeliveryService } from '../code-delivery.service';
import { CredentialsService } from '../credentials.service';
import { AuthTokens } from '../interfaces/auth.interface';
import { OtpService } from '../otp.service';
import { TokenService } from '../token.service';

export const CREATED_AT = new Date('2026-09-01T00:00:00.000Z');
export const LOGGED_IN_AT = new Date('2026-09-25T10:00:00.000Z');

export const buildUser = (overrides: Partial<PublicUser> = {}): PublicUser => ({
  id: 'user-1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  avatar: null,
  role: UserRole.CUSTOMER,
  isActive: true,
  isEmailVerified: false,
  lastLoginAt: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  ...overrides,
});

export const buildUserWithPassword = (
  overrides: Partial<UserWithPassword> = {},
): UserWithPassword => ({
  ...buildUser(),
  password: 'stored-hash',
  ...overrides,
});

export const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('prisma failure', {
    code,
    clientVersion: 'test',
  });

// Background work (emails, failed-login audits) isn't awaited; let it settle
export const flushBackgroundWork = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

// Awaits the rejection and checks the exception class and the errorCode that
// GlobalExceptionFilter puts in the error envelope
export async function expectHttpError(
  promise: Promise<unknown>,
  type: new (...args: any[]) => HttpException,
  errorCode: string,
): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error('Expected the call to reject');
    },
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject({ errorCode });
}

export const tx = { tx: true } as unknown as Prisma.TransactionClient;
export const client: ClientMeta = {
  userAgent: 'jest',
  ipAddress: '203.0.113.7',
};
export const tokens: AuthTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
};

export interface AuthMocks {
  prisma: { $transaction: jest.Mock };
  usersService: jest.Mocked<UsersService>;
  otpService: jest.Mocked<OtpService>;
  tokenService: jest.Mocked<TokenService>;
  mailService: jest.Mocked<MailService>;
  auditService: jest.Mocked<AuditService>;
  // Real collaborators over the mocks, so a flow is tested end to end
  credentials: CredentialsService;
  codeDelivery: CodeDeliveryService;
}

export function createAuthMocks(): AuthMocks {
  // Runs the unit of work with a recognisable client so tests can check
  // every write joined the same transaction
  const prisma = {
    $transaction: jest.fn(
      (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(tx),
    ),
  };
  const usersService = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findWithPasswordByEmail: jest.fn(),
    findWithPasswordById: jest.fn(),
    lockForUpdate: jest.fn().mockResolvedValue(true),
    create: jest.fn(),
    setPassword: jest.fn(),
    markEmailVerified: jest.fn(),
    recordLogin: jest.fn(),
  } as unknown as jest.Mocked<UsersService>;
  const otpService = {
    issue: jest.fn().mockResolvedValue('123456'),
    consume: jest.fn(),
    cleanup: jest.fn(),
    expiryMinutes: 15,
  } as unknown as jest.Mocked<OtpService>;
  const tokenService = {
    issue: jest.fn().mockResolvedValue(tokens),
    startSession: jest.fn().mockResolvedValue(tokens),
    rotate: jest.fn(),
    revoke: jest.fn(),
    revokeAllForUser: jest.fn().mockResolvedValue(0),
    cleanup: jest.fn(),
  } as unknown as jest.Mocked<TokenService>;
  const mailService = {
    sendVerificationOtp: jest.fn().mockResolvedValue(undefined),
    sendPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
    sendLoginOtp: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MailService>;
  const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;

  return {
    prisma,
    usersService,
    otpService,
    tokenService,
    mailService,
    auditService,
    credentials: new CredentialsService(usersService, auditService),
    codeDelivery: new CodeDeliveryService(
      prisma as unknown as PrismaService,
      usersService,
      otpService,
      mailService,
    ),
  };
}

// The user row lock must be taken once, before any of the given writes
export function expectLockedBefore(
  usersService: jest.Mocked<UsersService>,
  ...writes: jest.MockInstance<unknown, any[]>[]
): void {
  expect(usersService.lockForUpdate).toHaveBeenCalledTimes(1);
  const lockedAt = usersService.lockForUpdate.mock.invocationCallOrder[0];
  for (const write of writes) {
    expect(write).toHaveBeenCalled();
    expect(lockedAt).toBeLessThan(write.mock.invocationCallOrder[0]);
  }
}
