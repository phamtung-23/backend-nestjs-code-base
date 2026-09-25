import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { OtpType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import {
  AuthErrorCode,
  BCRYPT_ROUNDS,
  DUMMY_PASSWORD_HASH,
} from './auth.constants';
import { RegistrationService } from './registration.service';
import {
  AuthMocks,
  createAuthMocks,
  buildUser,
  buildUserWithPassword,
  expectHttpError,
  flushBackgroundWork,
  prismaError,
  tx,
} from './testing/auth.fixtures';

jest.mock('bcryptjs');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('RegistrationService', () => {
  let prisma: AuthMocks['prisma'];
  let usersService: AuthMocks['usersService'];
  let otpService: AuthMocks['otpService'];
  let mailService: AuthMocks['mailService'];
  let auditService: AuthMocks['auditService'];
  let loggerError: jest.SpyInstance;
  let service: RegistrationService;

  const transactionResult = () =>
    prisma.$transaction.mock.results[0].value as Promise<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    const mocks = createAuthMocks();
    ({ prisma, usersService, otpService, mailService, auditService } = mocks);
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = new RegistrationService(
      prisma as unknown as PrismaService,
      usersService,
      otpService,
      mocks.credentials,
      mocks.codeDelivery,
      auditService,
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
      expect(auditService.log).toHaveBeenCalledWith(
        {
          action: AuditAction.USER_REGISTERED,
          entity: AuditEntity.USER,
          entityId: 'user-1',
          actorId: 'user-1',
        },
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

    it('fails the registration when its audit entry cannot be written in the transaction', async () => {
      const error = new Error('audit insert failed');
      auditService.log.mockRejectedValue(error);

      await expect(service.register(dto)).rejects.toBe(error);
      await flushBackgroundWork();
      expect(mailService.sendVerificationOtp).not.toHaveBeenCalled();
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
      expect(auditService.log).not.toHaveBeenCalled();
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
  describe('verifyEmail', () => {
    const dto = {
      email: 'jane@example.com',
      otpCode: '123456',
      password: 'Passw0rd!',
    };

    beforeEach(() => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        buildUserWithPassword(),
      );
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it('checks the password, then marks the email verified when the code is consumed', async () => {
      otpService.consume.mockResolvedValue(true);

      await expect(service.verifyEmail(dto)).resolves.toBeUndefined();
      expect(mockedBcrypt.compare).toHaveBeenCalledWith(
        'Passw0rd!',
        'stored-hash',
      );
      expect(otpService.consume).toHaveBeenCalledWith(
        'user-1',
        OtpType.VERIFICATION,
        '123456',
        tx,
      );
      expect(usersService.markEmailVerified).toHaveBeenCalledWith('user-1', tx);
      expect(auditService.log).toHaveBeenCalledWith(
        {
          action: AuditAction.USER_EMAIL_VERIFIED,
          entity: AuditEntity.USER,
          entityId: 'user-1',
          actorId: 'user-1',
        },
        tx,
      );
    });

    it('returns 401 AUTH_INVALID_CREDENTIALS for a wrong password without touching the code', async () => {
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expectHttpError(
        service.verifyEmail(dto),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      // A guessed password must not burn the code's attempts either
      expect(otpService.consume).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('audits a wrong password on verify-email like a failed login (it is a password check too)', async () => {
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.verifyEmail(dto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await flushBackgroundWork();
      expect(auditService.log).toHaveBeenCalledWith({
        action: 'user.login_failed',
        entity: 'user',
        entityId: 'user-1',
        metadata: { reason: 'wrong_password' },
      });
    });

    it('answers an unknown email exactly like a wrong password, after a dummy bcrypt compare', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(null);
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expectHttpError(
        service.verifyEmail(dto),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      expect(mockedBcrypt.compare).toHaveBeenCalledWith(
        'Passw0rd!',
        DUMMY_PASSWORD_HASH,
      );
      expect(otpService.consume).not.toHaveBeenCalled();
    });

    it('returns 403 AUTH_ACCOUNT_DISABLED for a disabled account with the right password', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        buildUserWithPassword({ isActive: false }),
      );

      await expectHttpError(
        service.verifyEmail(dto),
        ForbiddenException,
        AuthErrorCode.ACCOUNT_DISABLED,
      );
      expect(otpService.consume).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_INVALID_CODE when the email is already verified', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        buildUserWithPassword({ isEmailVerified: true }),
      );

      await expectHttpError(
        service.verifyEmail(dto),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(otpService.consume).not.toHaveBeenCalled();
    });

    it('returns 422 AUTH_INVALID_CODE for a wrong code and commits the attempt instead of rolling it back', async () => {
      otpService.consume.mockResolvedValue(false);

      await expectHttpError(
        service.verifyEmail(dto),
        UnprocessableEntityException,
        AuthErrorCode.INVALID_CODE,
      );
      expect(usersService.markEmailVerified).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
      // Throwing inside the callback would roll back the attempt counter
      await expect(transactionResult()).resolves.toBe(false);
    });
  });

  describe('resendVerification', () => {
    it('emails a verification code to an active, unverified account, after the response', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());

      expect(service.resendVerification('jane@example.com')).toBeUndefined();
      await flushBackgroundWork();

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
    });

    it.each([
      ['already verified', buildUser({ isEmailVerified: true })],
      ['disabled', buildUser({ isActive: false })],
      ['unknown', null],
    ])('sends nothing when the account is %s', async (_case, user) => {
      usersService.findByEmail.mockResolvedValue(user);

      expect(service.resendVerification('jane@example.com')).toBeUndefined();
      await flushBackgroundWork();

      expect(otpService.issue).not.toHaveBeenCalled();
      expect(mailService.sendVerificationOtp).not.toHaveBeenCalled();
    });
  });
});
