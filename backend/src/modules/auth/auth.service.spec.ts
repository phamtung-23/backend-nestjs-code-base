import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OtpType, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  PublicUser,
  UserWithPassword,
} from '../users/interfaces/user.interface';
import { UsersService } from '../users/users.service';
import {
  AuthErrorCode,
  BCRYPT_ROUNDS,
  DUMMY_PASSWORD_HASH,
} from './auth.constants';
import { AuthService } from './auth.service';
import { AuthTokens } from './interfaces/auth.interface';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

jest.mock('bcryptjs');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

const CREATED_AT = new Date('2026-09-01T00:00:00.000Z');
const LOGGED_IN_AT = new Date('2026-09-25T10:00:00.000Z');

const buildUser = (overrides: Partial<PublicUser> = {}): PublicUser => ({
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

const buildUserWithPassword = (
  overrides: Partial<UserWithPassword> = {},
): UserWithPassword => ({
  ...buildUser(),
  password: 'stored-hash',
  ...overrides,
});

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('prisma failure', {
    code,
    clientVersion: 'test',
  });

// Emails are sent without being awaited; let those promises settle first
const flushBackgroundWork = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

// Awaits the rejection and checks the exception class and the errorCode that
// GlobalExceptionFilter puts in the error envelope
async function expectHttpError(
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

describe('AuthService', () => {
  const tx = { tx: true } as unknown as Prisma.TransactionClient;
  const client: ClientMeta = { userAgent: 'jest', ipAddress: '203.0.113.7' };
  const tokens: AuthTokens = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };

  let prisma: { $transaction: jest.Mock };
  let usersService: jest.Mocked<UsersService>;
  let otpService: jest.Mocked<OtpService>;
  let tokenService: jest.Mocked<TokenService>;
  let mailService: jest.Mocked<MailService>;
  let loggerError: jest.SpyInstance;
  let service: AuthService;

  // The user row lock must be taken before any of the given writes
  const expectLockedBefore = (
    ...writes: jest.MockInstance<unknown, any[]>[]
  ) => {
    expect(usersService.lockForUpdate).toHaveBeenCalledTimes(1);
    const lockedAt = usersService.lockForUpdate.mock.invocationCallOrder[0];
    for (const write of writes) {
      expect(write).toHaveBeenCalled();
      expect(lockedAt).toBeLessThan(write.mock.invocationCallOrder[0]);
    }
  };

  const transactionResult = () =>
    prisma.$transaction.mock.results[0].value as Promise<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Runs the unit of work with a recognisable client so tests can check
    // every write joined the same transaction
    prisma = {
      $transaction: jest.fn(
        (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    usersService = {
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

    otpService = {
      issue: jest.fn().mockResolvedValue('123456'),
      consume: jest.fn(),
      cleanup: jest.fn(),
      expiryMinutes: 15,
    } as unknown as jest.Mocked<OtpService>;

    tokenService = {
      issue: jest.fn().mockResolvedValue(tokens),
      rotate: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn().mockResolvedValue(0),
      cleanup: jest.fn(),
    } as unknown as jest.Mocked<TokenService>;

    mailService = {
      sendVerificationOtp: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
      sendOtpEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailService>;

    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = new AuthService(
      prisma as unknown as PrismaService,
      usersService,
      otpService,
      tokenService,
      mailService,
    );
  });

  afterEach(() => loggerError.mockRestore());

  describe('register', () => {
    const dto = {
      email: 'jane@example.com',
      password: 'Passw0rd!',
      firstName: 'Jane',
      lastName: 'Doe',
    };

    beforeEach(() => {
      usersService.findByEmail.mockResolvedValue(null);
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      usersService.create.mockResolvedValue(buildUser());
    });

    it('creates the user and a verification code in one transaction, then emails the code', async () => {
      const result = await service.register(dto);
      await flushBackgroundWork();

      expect(usersService.findByEmail).toHaveBeenCalledWith('jane@example.com');
      expect(mockedBcrypt.hash).toHaveBeenCalledWith(
        'Passw0rd!',
        BCRYPT_ROUNDS,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(usersService.create).toHaveBeenCalledWith(
        {
          email: 'jane@example.com',
          passwordHash: 'new-hash',
          firstName: 'Jane',
          lastName: 'Doe',
        },
        tx,
      );
      expect(otpService.issue).toHaveBeenCalledWith(
        'user-1',
        OtpType.VERIFICATION,
        tx,
      );
      expect(mailService.sendVerificationOtp).toHaveBeenCalledWith(
        'jane@example.com',
        '123456',
        15,
      );
      expect(result).toEqual(buildUser());
      expect(result).not.toHaveProperty('password');
    });

    it('returns without waiting for the email to be delivered', async () => {
      mailService.sendVerificationOtp.mockReturnValue(new Promise(() => {}));

      await expect(service.register(dto)).resolves.toEqual(buildUser());
    });

    it('registers without sending an email when no code could be issued', async () => {
      otpService.issue.mockResolvedValue(null);

      await expect(service.register(dto)).resolves.toEqual(buildUser());
      await flushBackgroundWork();
      expect(mailService.sendVerificationOtp).not.toHaveBeenCalled();
    });

    it('returns 409 AUTH_EMAIL_TAKEN when the email is already registered', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());

      await expectHttpError(
        service.register(dto),
        ConflictException,
        AuthErrorCode.EMAIL_TAKEN,
      );
      expect(mockedBcrypt.hash).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 409 AUTH_EMAIL_TAKEN when a concurrent registration wins the unique constraint', async () => {
      usersService.create.mockRejectedValue(prismaError('P2002'));

      await expectHttpError(
        service.register(dto),
        ConflictException,
        AuthErrorCode.EMAIL_TAKEN,
      );
      await flushBackgroundWork();
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService.sendVerificationOtp).not.toHaveBeenCalled();
    });

    it('rethrows other Prisma errors unchanged', async () => {
      const error = prismaError('P2034');
      usersService.create.mockRejectedValue(error);

      await expect(service.register(dto)).rejects.toBe(error);
    });

    it('rethrows non-Prisma errors from the transaction unchanged', async () => {
      const error = new Error('connection lost');
      otpService.issue.mockRejectedValue(error);

      await expect(service.register(dto)).rejects.toBe(error);
      await flushBackgroundWork();
      expect(mailService.sendVerificationOtp).not.toHaveBeenCalled();
    });

    it('still succeeds and logs the failure when the verification email cannot be sent', async () => {
      const error = new Error('SMTP down');
      mailService.sendVerificationOtp.mockRejectedValue(error);

      await expect(service.register(dto)).resolves.toEqual(buildUser());
      await flushBackgroundWork();
      expect(loggerError).toHaveBeenCalledWith(
        'Background task failed',
        error.stack,
      );
    });

    it('logs mail failures that are not Error instances as strings', async () => {
      mailService.sendVerificationOtp.mockRejectedValue('SMTP down');

      await service.register(dto);
      await flushBackgroundWork();
      expect(loggerError).toHaveBeenCalledWith(
        'Background task failed',
        'SMTP down',
      );
    });
  });

  describe('login', () => {
    const dto = { email: 'jane@example.com', password: 'Passw0rd!' };

    beforeEach(() => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        buildUserWithPassword(),
      );
      usersService.findWithPasswordById.mockResolvedValue(
        buildUserWithPassword(),
      );
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it('returns 401 AUTH_INVALID_CREDENTIALS without a session when the account disappears before the lock', async () => {
      usersService.lockForUpdate.mockResolvedValue(false);

      await expectHttpError(
        service.login(dto, client),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      expect(usersService.recordLogin).not.toHaveBeenCalled();
      expect(tokenService.issue).not.toHaveBeenCalled();
    });

    it('locks the user, re-checks the hash and starts a session in one transaction, returning the user without the password hash', async () => {
      const updated = buildUser({ lastLoginAt: LOGGED_IN_AT });
      usersService.recordLogin.mockResolvedValue(updated);

      const session = await service.login(dto, client);

      expect(usersService.findWithPasswordByEmail).toHaveBeenCalledWith(
        'jane@example.com',
      );
      expect(mockedBcrypt.compare).toHaveBeenCalledWith(
        'Passw0rd!',
        'stored-hash',
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      expect(usersService.findWithPasswordById).toHaveBeenCalledWith(
        'user-1',
        tx,
      );
      expect(usersService.recordLogin).toHaveBeenCalledWith('user-1', tx);
      expect(tokenService.issue).toHaveBeenCalledWith(updated, client, tx);
      expectLockedBefore(
        usersService.findWithPasswordById,
        usersService.recordLogin,
        tokenService.issue,
      );
      expect(session).toEqual({ ...tokens, user: updated });
      expect(session.user).not.toHaveProperty('password');
    });

    it('compares against the dummy hash for an unknown email and returns 401 AUTH_INVALID_CREDENTIALS', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(null);
      // Even a match against the dummy hash must never log anyone in
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expectHttpError(
        service.login(dto, client),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      expect(mockedBcrypt.compare).toHaveBeenCalledWith(
        'Passw0rd!',
        DUMMY_PASSWORD_HASH,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tokenService.issue).not.toHaveBeenCalled();
    });

    it('returns 401 AUTH_INVALID_CREDENTIALS when the password is wrong', async () => {
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expectHttpError(
        service.login(dto, client),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tokenService.issue).not.toHaveBeenCalled();
    });

    it('returns 403 AUTH_ACCOUNT_DISABLED for a disabled account with the right password', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        buildUserWithPassword({ isActive: false }),
      );

      await expectHttpError(
        service.login(dto, client),
        ForbiddenException,
        AuthErrorCode.ACCOUNT_DISABLED,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tokenService.issue).not.toHaveBeenCalled();
    });

    it.each<[string, UserWithPassword | null]>([
      [
        'the password was changed',
        buildUserWithPassword({ password: 'newer-hash' }),
      ],
      ['the account was disabled', buildUserWithPassword({ isActive: false })],
      ['the account was deleted', null],
    ])(
      'returns 401 AUTH_INVALID_CREDENTIALS without a session when %s while bcrypt was running',
      async (_case, current) => {
        usersService.findWithPasswordById.mockResolvedValue(current);

        await expectHttpError(
          service.login(dto, client),
          UnauthorizedException,
          AuthErrorCode.INVALID_CREDENTIALS,
        );
        expect(usersService.recordLogin).not.toHaveBeenCalled();
        expect(tokenService.issue).not.toHaveBeenCalled();
        await expect(transactionResult()).resolves.toBeNull();
      },
    );
  });

  describe('verifyEmail', () => {
    const dto = { email: 'jane@example.com', otpCode: '123456' };

    it('marks the email verified when the code is consumed', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());
      otpService.consume.mockResolvedValue(true);

      await expect(service.verifyEmail(dto)).resolves.toBeUndefined();
      expect(otpService.consume).toHaveBeenCalledWith(
        'user-1',
        OtpType.VERIFICATION,
        '123456',
        tx,
      );
      expect(usersService.markEmailVerified).toHaveBeenCalledWith('user-1', tx);
    });

    it('returns 422 AUTH_INVALID_CODE for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expectHttpError(
        service.verifyEmail(dto),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(otpService.consume).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_INVALID_CODE when the email is already verified', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ isEmailVerified: true }),
      );

      await expectHttpError(
        service.verifyEmail(dto),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(otpService.consume).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_INVALID_CODE for a wrong code and commits the attempt instead of rolling it back', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());
      otpService.consume.mockResolvedValue(false);

      await expectHttpError(
        service.verifyEmail(dto),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(usersService.markEmailVerified).not.toHaveBeenCalled();
      // Throwing inside the callback would roll back the attempt counter
      await expect(transactionResult()).resolves.toBe(false);
    });
  });

  describe.each([
    {
      method: 'resendVerification',
      type: OtpType.VERIFICATION,
      mail: 'sendVerificationOtp',
    },
    {
      method: 'forgotPassword',
      type: OtpType.PASSWORD_RESET,
      mail: 'sendPasswordResetOtp',
    },
    { method: 'sendLoginOtp', type: OtpType.LOGIN, mail: 'sendOtpEmail' },
  ] as const)('$method', ({ method, type, mail }) => {
    const request = () => service[method]('jane@example.com');

    beforeEach(() => {
      usersService.findByEmail.mockResolvedValue(buildUser());
    });

    it('locks the user and issues the code in one transaction, then emails it with the configured expiry', async () => {
      expect(request()).toBeUndefined();
      await flushBackgroundWork();

      expect(usersService.findByEmail).toHaveBeenCalledWith('jane@example.com');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      expect(otpService.issue).toHaveBeenCalledWith('user-1', type, tx);
      expectLockedBefore(otpService.issue);
      expect(mailService[mail]).toHaveBeenCalledWith(
        'jane@example.com',
        '123456',
        15,
      );
    });

    it('does nothing for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      expect(request()).toBeUndefined();
      await flushBackgroundWork();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService[mail]).not.toHaveBeenCalled();
    });

    it('does nothing for a disabled account', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ isActive: false }),
      );

      expect(request()).toBeUndefined();
      await flushBackgroundWork();
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService[mail]).not.toHaveBeenCalled();
    });

    it('sends no email while issuing is rate limited', async () => {
      otpService.issue.mockResolvedValue(null);

      expect(request()).toBeUndefined();
      await flushBackgroundWork();
      expect(mailService[mail]).not.toHaveBeenCalled();
    });

    it('issues nothing when the account disappears before the lock', async () => {
      usersService.lockForUpdate.mockResolvedValue(false);

      expect(request()).toBeUndefined();
      await flushBackgroundWork();
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService[mail]).not.toHaveBeenCalled();
    });

    it('responds before the account is even looked up (timing reveals nothing)', () => {
      usersService.findByEmail.mockReturnValue(new Promise(() => {}));

      expect(request()).toBeUndefined();
      expect(otpService.issue).not.toHaveBeenCalled();
    });

    it('returns without waiting for the email to be delivered', () => {
      mailService[mail].mockReturnValue(new Promise(() => {}));

      expect(request()).toBeUndefined();
    });

    it('logs failures instead of failing the request', async () => {
      const error = new Error('SMTP down');
      mailService[mail].mockRejectedValue(error);

      expect(request()).toBeUndefined();
      await flushBackgroundWork();
      expect(loggerError).toHaveBeenCalledWith(
        'Background task failed',
        error.stack,
      );
    });
  });

  describe('resendVerification', () => {
    it('does nothing when the email is already verified', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ isEmailVerified: true }),
      );

      expect(service.resendVerification('jane@example.com')).toBeUndefined();
      await flushBackgroundWork();
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService.sendVerificationOtp).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const dto = {
      email: 'jane@example.com',
      otpCode: '123456',
      newPassword: 'NewPassw0rd!',
    };

    beforeEach(() => {
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
    });

    it('returns 422 AUTH_INVALID_CODE without consuming when the account disappears before the lock', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());
      usersService.lockForUpdate.mockResolvedValue(false);

      await expectHttpError(
        service.resetPassword(dto),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(otpService.consume).not.toHaveBeenCalled();
      expect(usersService.setPassword).not.toHaveBeenCalled();
    });

    it('locks the user, then sets the new password and revokes every session in the same transaction', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());
      otpService.consume.mockResolvedValue(true);

      await expect(service.resetPassword(dto)).resolves.toBeUndefined();
      expect(mockedBcrypt.hash).toHaveBeenCalledWith(
        'NewPassw0rd!',
        BCRYPT_ROUNDS,
      );
      expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      expect(otpService.consume).toHaveBeenCalledWith(
        'user-1',
        OtpType.PASSWORD_RESET,
        '123456',
        tx,
      );
      expect(usersService.setPassword).toHaveBeenCalledWith(
        'user-1',
        'new-hash',
        tx,
      );
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('user-1', tx);
      expectLockedBefore(
        otpService.consume,
        usersService.setPassword,
        tokenService.revokeAllForUser,
      );
    });

    it('hashes the new password even for an unknown email, then returns 422 AUTH_INVALID_CODE', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expectHttpError(
        service.resetPassword(dto),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(mockedBcrypt.hash).toHaveBeenCalledWith(
        'NewPassw0rd!',
        BCRYPT_ROUNDS,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_INVALID_CODE for a disabled account without touching the password', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ isActive: false }),
      );

      await expectHttpError(
        service.resetPassword(dto),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(otpService.consume).not.toHaveBeenCalled();
      expect(usersService.setPassword).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_INVALID_CODE for a wrong code without changing the password or revoking sessions', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());
      otpService.consume.mockResolvedValue(false);

      await expectHttpError(
        service.resetPassword(dto),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(usersService.setPassword).not.toHaveBeenCalled();
      expect(tokenService.revokeAllForUser).not.toHaveBeenCalled();
      await expect(transactionResult()).resolves.toBe(false);
    });
  });

  describe('changePassword', () => {
    const dto = { currentPassword: 'Passw0rd!', newPassword: 'NewPassw0rd!' };

    beforeEach(() => {
      usersService.findWithPasswordById.mockResolvedValue(
        buildUserWithPassword(),
      );
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
    });

    it('locks the user, re-checks the hash, sets the new password, revokes all sessions and issues a fresh pair in one transaction', async () => {
      const result = await service.changePassword('user-1', dto, client);

      expect(usersService.findWithPasswordById).toHaveBeenNthCalledWith(
        1,
        'user-1',
      );
      expect(mockedBcrypt.compare).toHaveBeenCalledWith(
        'Passw0rd!',
        'stored-hash',
      );
      expect(mockedBcrypt.hash).toHaveBeenCalledWith(
        'NewPassw0rd!',
        BCRYPT_ROUNDS,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      expect(usersService.findWithPasswordById).toHaveBeenNthCalledWith(
        2,
        'user-1',
        tx,
      );
      expect(usersService.setPassword).toHaveBeenCalledWith(
        'user-1',
        'new-hash',
        tx,
      );
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('user-1', tx);
      expect(tokenService.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-1',
          email: 'jane@example.com',
          role: UserRole.CUSTOMER,
        }),
        client,
        tx,
      );
      const lockedAt = usersService.lockForUpdate.mock.invocationCallOrder[0];
      expect(lockedAt).toBeLessThan(
        usersService.findWithPasswordById.mock.invocationCallOrder[1],
      );
      expectLockedBefore(
        usersService.setPassword,
        tokenService.revokeAllForUser,
        tokenService.issue,
      );
      // The new pair must be issued after the revoke, or it would be revoked too
      expect(
        tokenService.revokeAllForUser.mock.invocationCallOrder[0],
      ).toBeLessThan(tokenService.issue.mock.invocationCallOrder[0]);
      expect(result).toEqual(tokens);
    });

    it('returns 401 when the user no longer exists', async () => {
      usersService.findWithPasswordById.mockResolvedValue(null);

      await expect(
        service.changePassword('user-1', dto, client),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockedBcrypt.compare).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_CURRENT_PASSWORD_INCORRECT when the current password is wrong', async () => {
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expectHttpError(
        service.changePassword('user-1', dto, client),
        UnprocessableEntityException,
        AuthErrorCode.CURRENT_PASSWORD_INCORRECT,
      );
      expect(mockedBcrypt.hash).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_CURRENT_PASSWORD_INCORRECT without overwriting anything when the password was changed concurrently', async () => {
      usersService.findWithPasswordById
        .mockResolvedValueOnce(buildUserWithPassword())
        .mockResolvedValueOnce(
          buildUserWithPassword({ password: 'newer-hash' }),
        );

      await expectHttpError(
        service.changePassword('user-1', dto, client),
        UnprocessableEntityException,
        AuthErrorCode.CURRENT_PASSWORD_INCORRECT,
      );
      expect(usersService.setPassword).not.toHaveBeenCalled();
      expect(tokenService.revokeAllForUser).not.toHaveBeenCalled();
      expect(tokenService.issue).not.toHaveBeenCalled();
    });

    it.each([
      ['the lock finds no row', false, buildUserWithPassword()],
      ['the re-read finds no row', true, null],
    ])(
      'returns 401 without writing anything when the account was deleted concurrently (%s)',
      async (_case, locked, current) => {
        usersService.findWithPasswordById
          .mockResolvedValueOnce(buildUserWithPassword())
          .mockResolvedValueOnce(current);
        usersService.lockForUpdate.mockResolvedValue(locked);

        await expect(
          service.changePassword('user-1', dto, client),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(usersService.setPassword).not.toHaveBeenCalled();
        expect(tokenService.issue).not.toHaveBeenCalled();
      },
    );
  });

  describe('verifyLoginOtp', () => {
    const dto = { email: 'jane@example.com', otpCode: '123456' };

    it('returns 422 AUTH_INVALID_CODE without consuming when the account disappears before the lock', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());
      usersService.lockForUpdate.mockResolvedValue(false);

      await expectHttpError(
        service.verifyLoginOtp(dto, client),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(otpService.consume).not.toHaveBeenCalled();
      expect(tokenService.issue).not.toHaveBeenCalled();
    });

    it('locks the user, consumes the code and starts a session in one transaction', async () => {
      const updated = buildUser({ lastLoginAt: LOGGED_IN_AT });
      usersService.findByEmail.mockResolvedValue(buildUser());
      otpService.consume.mockResolvedValue(true);
      usersService.recordLogin.mockResolvedValue(updated);

      const session = await service.verifyLoginOtp(dto, client);

      expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      expect(otpService.consume).toHaveBeenCalledWith(
        'user-1',
        OtpType.LOGIN,
        '123456',
        tx,
      );
      expect(usersService.recordLogin).toHaveBeenCalledWith('user-1', tx);
      expect(tokenService.issue).toHaveBeenCalledWith(updated, client, tx);
      expectLockedBefore(
        otpService.consume,
        usersService.recordLogin,
        tokenService.issue,
      );
      expect(session).toEqual({ ...tokens, user: updated });
      expect(session.user).not.toHaveProperty('password');
    });

    it('returns 422 AUTH_INVALID_CODE for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expectHttpError(
        service.verifyLoginOtp(dto, client),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_INVALID_CODE for a disabled account', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ isActive: false }),
      );

      await expectHttpError(
        service.verifyLoginOtp(dto, client),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(otpService.consume).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_INVALID_CODE for a wrong code, committing the attempt without starting a session', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());
      otpService.consume.mockResolvedValue(false);

      await expectHttpError(
        service.verifyLoginOtp(dto, client),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(usersService.recordLogin).not.toHaveBeenCalled();
      expect(tokenService.issue).not.toHaveBeenCalled();
      await expect(transactionResult()).resolves.toBeNull();
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token through TokenService', async () => {
      tokenService.rotate.mockResolvedValue(tokens);

      await expect(service.refresh('old-refresh', client)).resolves.toBe(
        tokens,
      );
      expect(tokenService.rotate).toHaveBeenCalledWith('old-refresh', client);
    });
  });

  describe('logout', () => {
    it('revokes the given refresh token', async () => {
      tokenService.revoke.mockResolvedValue(undefined);

      await expect(service.logout('refresh-token')).resolves.toBeUndefined();
      expect(tokenService.revoke).toHaveBeenCalledWith('refresh-token');
    });
  });

  describe('logoutAll', () => {
    it('locks the user and revokes every refresh token in one transaction', async () => {
      tokenService.revokeAllForUser.mockResolvedValue(3);

      await expect(service.logoutAll('user-1')).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('user-1', tx);
      expectLockedBefore(tokenService.revokeAllForUser);
    });
  });
});
