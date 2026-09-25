import {
  UnauthorizedException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { OtpType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuthErrorCode, BCRYPT_ROUNDS } from './auth.constants';
import { PasswordService } from './password.service';
import {
  AuthMocks,
  createAuthMocks,
  buildUser,
  buildUserWithPassword,
  client,
  expectHttpError,
  flushBackgroundWork,
  tokens,
  tx,
  expectLockedBefore as expectLockedBeforeFor,
} from './testing/auth.fixtures';

jest.mock('bcryptjs');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('PasswordService', () => {
  let prisma: AuthMocks['prisma'];
  let usersService: AuthMocks['usersService'];
  let otpService: AuthMocks['otpService'];
  let tokenService: AuthMocks['tokenService'];
  let mailService: AuthMocks['mailService'];
  let auditService: AuthMocks['auditService'];
  let loggerError: jest.SpyInstance;
  let service: PasswordService;

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

    service = new PasswordService(
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
      expect(auditService.log).toHaveBeenCalledWith(
        {
          action: AuditAction.USER_PASSWORD_RESET,
          entity: AuditEntity.USER,
          entityId: 'user-1',
          actorId: 'user-1',
        },
        tx,
      );
      expectLockedBefore(
        otpService.consume,
        usersService.setPassword,
        tokenService.revokeAllForUser,
        auditService.log,
      );
    });

    it('marks an unverified email verified in the same transaction, since the code reached the mailbox', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ isEmailVerified: false }),
      );
      otpService.consume.mockResolvedValue(true);

      await expect(service.resetPassword(dto)).resolves.toBeUndefined();
      expect(usersService.markEmailVerified).toHaveBeenCalledWith('user-1', tx);
      expectLockedBefore(usersService.markEmailVerified);
    });

    it('does not mark an already verified email again', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ isEmailVerified: true }),
      );
      otpService.consume.mockResolvedValue(true);

      await expect(service.resetPassword(dto)).resolves.toBeUndefined();
      expect(usersService.setPassword).toHaveBeenCalledWith(
        'user-1',
        'new-hash',
        tx,
      );
      expect(usersService.markEmailVerified).not.toHaveBeenCalled();
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
      expect(usersService.markEmailVerified).not.toHaveBeenCalled();
      expect(tokenService.revokeAllForUser).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
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
      expect(auditService.log).toHaveBeenCalledWith(
        {
          action: AuditAction.USER_PASSWORD_CHANGED,
          entity: AuditEntity.USER,
          entityId: 'user-1',
          actorId: 'user-1',
        },
        tx,
      );
      // The fresh pair starts a new session, recorded as a password change
      expect(tokenService.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-1',
          email: 'jane@example.com',
          role: UserRole.CUSTOMER,
        }),
        client,
        tx,
        'password_change',
      );
      const lockedAt = usersService.lockForUpdate.mock.invocationCallOrder[0];
      expect(lockedAt).toBeLessThan(
        usersService.findWithPasswordById.mock.invocationCallOrder[1],
      );
      expectLockedBefore(
        usersService.setPassword,
        tokenService.revokeAllForUser,
        auditService.log,
        tokenService.startSession,
      );
      // The new pair must be issued after the revoke, or it would be revoked too
      expect(
        tokenService.revokeAllForUser.mock.invocationCallOrder[0],
      ).toBeLessThan(tokenService.startSession.mock.invocationCallOrder[0]);
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
      expect(tokenService.startSession).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
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
        expect(tokenService.startSession).not.toHaveBeenCalled();
      },
    );
  });

  describe('forgotPassword', () => {
    it.each([
      ['a verified account', buildUser({ isEmailVerified: true })],
      // The reset verifies the email, so unverified accounts can recover too
      ['an unverified account', buildUser({ isEmailVerified: false })],
    ])('emails a reset code to %s, after the response', async (_case, user) => {
      usersService.findByEmail.mockResolvedValue(user);

      expect(service.forgotPassword('jane@example.com')).toBeUndefined();
      await flushBackgroundWork();

      expect(otpService.issue).toHaveBeenCalledWith(
        'user-1',
        OtpType.PASSWORD_RESET,
        tx,
      );
      expect(mailService.sendPasswordResetOtp).toHaveBeenCalledWith(
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

      expect(service.forgotPassword('jane@example.com')).toBeUndefined();
      await flushBackgroundWork();

      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetOtp).not.toHaveBeenCalled();
    });
  });
});
