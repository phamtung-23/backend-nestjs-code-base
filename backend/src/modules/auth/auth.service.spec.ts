import {
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { OtpType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { UserWithPassword } from '../users/interfaces/user.interface';
import { AuthErrorCode, DUMMY_PASSWORD_HASH } from './auth.constants';
import { AuthService } from './auth.service';
import {
  AuthMocks,
  createAuthMocks,
  buildUser,
  buildUserWithPassword,
  client,
  expectHttpError,
  flushBackgroundWork,
  LOGGED_IN_AT,
  tokens,
  tx,
  expectLockedBefore as expectLockedBeforeFor,
} from './testing/auth.fixtures';

jest.mock('bcryptjs');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let prisma: AuthMocks['prisma'];
  let usersService: AuthMocks['usersService'];
  let otpService: AuthMocks['otpService'];
  let tokenService: AuthMocks['tokenService'];
  let mailService: AuthMocks['mailService'];
  let auditService: AuthMocks['auditService'];
  let loggerError: jest.SpyInstance;
  let service: AuthService;

  const expectLockedBefore = (...writes: jest.MockInstance<unknown, any[]>[]) =>
    expectLockedBeforeFor(usersService, ...writes);

  const transactionResult = () =>
    prisma.$transaction.mock.results[0].value as Promise<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    const mocks = createAuthMocks();
    ({
      prisma,
      usersService,
      otpService,
      tokenService,
      mailService,
      auditService,
    } = mocks);
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = new AuthService(
      prisma as unknown as PrismaService,
      usersService,
      otpService,
      tokenService,
      mocks.credentials,
      mocks.codeDelivery,
      auditService,
    );
  });

  afterEach(() => loggerError.mockRestore());

  describe('login', () => {
    const dto = { email: 'jane@example.com', password: 'Passw0rd!' };
    // Password login requires a verified email
    const verifiedRecord = (overrides: Partial<UserWithPassword> = {}) =>
      buildUserWithPassword({ isEmailVerified: true, ...overrides });

    beforeEach(() => {
      usersService.findWithPasswordByEmail.mockResolvedValue(verifiedRecord());
      usersService.findWithPasswordById.mockResolvedValue(verifiedRecord());
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
      expect(tokenService.startSession).not.toHaveBeenCalled();
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
      expect(tokenService.startSession).toHaveBeenCalledWith(
        updated,
        client,
        tx,
        'password',
      );
      expectLockedBefore(
        usersService.findWithPasswordById,
        usersService.recordLogin,
        tokenService.startSession,
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
      expect(tokenService.startSession).not.toHaveBeenCalled();
    });

    it('returns 401 AUTH_INVALID_CREDENTIALS when the password is wrong', async () => {
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expectHttpError(
        service.login(dto, client),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tokenService.startSession).not.toHaveBeenCalled();
    });

    it('audits a wrong password for an existing account in the background, outside any transaction', async () => {
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto, client)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await flushBackgroundWork();

      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith({
        action: AuditAction.USER_LOGIN_FAILED,
        entity: AuditEntity.USER,
        entityId: 'user-1',
        metadata: { reason: 'wrong_password' },
      });
      expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
        'Passw0rd!',
      );
    });

    it('answers a wrong password without waiting for the audit entry', async () => {
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
      auditService.log.mockReturnValue(new Promise(() => {}));

      await expectHttpError(
        service.login(dto, client),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
    });

    it('logs a failed-login audit write instead of changing the answer', async () => {
      const error = new Error('audit insert failed');
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
      auditService.log.mockRejectedValue(error);

      await expectHttpError(
        service.login(dto, client),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      await flushBackgroundWork();
      expect(loggerError).toHaveBeenCalledWith(
        'Background task failed',
        error.stack,
      );
    });

    it('does not audit failed logins for unknown emails', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(null);
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto, client)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await flushBackgroundWork();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('returns 403 AUTH_ACCOUNT_DISABLED for a disabled account with the right password', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        verifiedRecord({ isActive: false }),
      );

      await expectHttpError(
        service.login(dto, client),
        ForbiddenException,
        AuthErrorCode.ACCOUNT_DISABLED,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tokenService.startSession).not.toHaveBeenCalled();
    });

    it('returns 403 AUTH_EMAIL_NOT_VERIFIED for an unverified account with the right password, without a session', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        buildUserWithPassword({ isEmailVerified: false }),
      );

      await expectHttpError(
        service.login(dto, client),
        ForbiddenException,
        AuthErrorCode.EMAIL_NOT_VERIFIED,
      );
      await flushBackgroundWork();
      // The password was right: nothing to record as a failed login
      expect(auditService.log).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(usersService.recordLogin).not.toHaveBeenCalled();
      expect(tokenService.startSession).not.toHaveBeenCalled();
    });

    it('reports a disabled account before an unverified email', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        buildUserWithPassword({ isActive: false, isEmailVerified: false }),
      );

      await expectHttpError(
        service.login(dto, client),
        ForbiddenException,
        AuthErrorCode.ACCOUNT_DISABLED,
      );
    });

    it('checks the password before revealing that the email is unverified', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        buildUserWithPassword({ isEmailVerified: false }),
      );
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expectHttpError(
        service.login(dto, client),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
    });

    it.each<[string, UserWithPassword | null]>([
      ['the password was changed', verifiedRecord({ password: 'newer-hash' })],
      ['the account was disabled', verifiedRecord({ isActive: false })],
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
        expect(tokenService.startSession).not.toHaveBeenCalled();
        await expect(transactionResult()).resolves.toBeNull();
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
      expect(tokenService.startSession).not.toHaveBeenCalled();
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
      expect(tokenService.startSession).toHaveBeenCalledWith(
        updated,
        client,
        tx,
        'code',
      );
      expectLockedBefore(
        otpService.consume,
        usersService.recordLogin,
        tokenService.startSession,
      );
      expect(session).toEqual({ ...tokens, user: updated });
      expect(session.user).not.toHaveProperty('password');
    });

    it('logs an unverified account in without marking its email verified', async () => {
      const unverified = buildUser({ isEmailVerified: false });
      usersService.findByEmail.mockResolvedValue(unverified);
      otpService.consume.mockResolvedValue(true);
      usersService.recordLogin.mockResolvedValue(unverified);

      const session = await service.verifyLoginOtp(dto, client);

      expect(session.user.isEmailVerified).toBe(false);
      expect(usersService.markEmailVerified).not.toHaveBeenCalled();
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
      expect(tokenService.startSession).not.toHaveBeenCalled();
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
    it('locks the user, revokes every refresh token and audits how many, in one transaction', async () => {
      tokenService.revokeAllForUser.mockResolvedValue(3);

      await expect(service.logoutAll('user-1')).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(usersService.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('user-1', tx);
      expect(auditService.log).toHaveBeenCalledWith(
        {
          action: AuditAction.USER_SESSIONS_REVOKED,
          entity: AuditEntity.USER,
          entityId: 'user-1',
          actorId: 'user-1',
          metadata: { revokedTokens: 3 },
        },
        tx,
      );
      expectLockedBefore(tokenService.revokeAllForUser, auditService.log);
    });

    it('writes no audit entry when there was nothing to revoke', async () => {
      tokenService.revokeAllForUser.mockResolvedValue(0);

      await expect(service.logoutAll('user-1')).resolves.toBeUndefined();
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('user-1', tx);
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('does nothing when the user was deleted meanwhile', async () => {
      usersService.lockForUpdate.mockResolvedValue(false);

      await expect(service.logoutAll('user-1')).resolves.toBeUndefined();
      expect(tokenService.revokeAllForUser).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('fails when its audit entry cannot be written, so the revocation rolls back with it', async () => {
      const error = new Error('audit insert failed');
      tokenService.revokeAllForUser.mockResolvedValue(2);
      auditService.log.mockRejectedValue(error);

      await expect(service.logoutAll('user-1')).rejects.toBe(error);
    });
  });

  describe('sendLoginOtp', () => {
    it.each([
      ['a verified account', buildUser({ isEmailVerified: true })],
      ['an unverified account', buildUser({ isEmailVerified: false })],
    ])('emails a login code to %s, after the response', async (_case, user) => {
      usersService.findByEmail.mockResolvedValue(user);

      expect(service.sendLoginOtp('jane@example.com')).toBeUndefined();
      await flushBackgroundWork();

      expect(otpService.issue).toHaveBeenCalledWith(
        'user-1',
        OtpType.LOGIN,
        tx,
      );
      expect(mailService.sendLoginOtp).toHaveBeenCalledWith(
        'jane@example.com',
        '123456',
        15,
      );
    });

    it.each([
      ['disabled', buildUser({ isActive: false })],
      ['unknown', null],
    ])('sends nothing when the account is %s', async (_case, user) => {
      usersService.findByEmail.mockResolvedValue(user);

      expect(service.sendLoginOtp('jane@example.com')).toBeUndefined();
      await flushBackgroundWork();

      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService.sendLoginOtp).not.toHaveBeenCalled();
    });
  });
});
