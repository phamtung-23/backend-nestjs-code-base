import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import {
  AuthErrorCode,
  BCRYPT_ROUNDS,
  DUMMY_PASSWORD_HASH,
} from './auth.constants';
import { CredentialsService } from './credentials.service';
import {
  AuthMocks,
  buildUserWithPassword,
  createAuthMocks,
  expectHttpError,
  flushBackgroundWork,
} from './testing/auth.fixtures';

jest.mock('bcryptjs');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('CredentialsService', () => {
  let usersService: AuthMocks['usersService'];
  let auditService: AuthMocks['auditService'];
  let loggerError: jest.SpyInstance;
  let service: CredentialsService;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ usersService, auditService } = createAuthMocks());
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    usersService.findWithPasswordByEmail.mockResolvedValue(
      buildUserWithPassword(),
    );
    (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);

    service = new CredentialsService(usersService, auditService);
  });

  afterEach(() => loggerError.mockRestore());

  it('hashes passwords with the configured bcrypt cost', async () => {
    (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

    await expect(service.hash('Passw0rd!')).resolves.toBe('new-hash');
    expect(mockedBcrypt.hash).toHaveBeenCalledWith('Passw0rd!', BCRYPT_ROUNDS);
  });

  it('compares a password with a stored hash', async () => {
    await expect(service.matches('Passw0rd!', 'stored-hash')).resolves.toBe(
      true,
    );
    expect(mockedBcrypt.compare).toHaveBeenCalledWith(
      'Passw0rd!',
      'stored-hash',
    );
  });

  describe('verify', () => {
    it('returns the account, with its hash, when the password matches', async () => {
      await expect(
        service.verify('jane@example.com', 'Passw0rd!'),
      ).resolves.toEqual(buildUserWithPassword());
      expect(usersService.findWithPasswordByEmail).toHaveBeenCalledWith(
        'jane@example.com',
      );
      await flushBackgroundWork();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('compares an unknown email against the dummy hash and answers 401, even on a match', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(null);

      await expectHttpError(
        service.verify('ghost@example.com', 'Passw0rd!'),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      expect(mockedBcrypt.compare).toHaveBeenCalledWith(
        'Passw0rd!',
        DUMMY_PASSWORD_HASH,
      );
      await flushBackgroundWork();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('answers a wrong password with 401 and audits it in the background, without the password', async () => {
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expectHttpError(
        service.verify('jane@example.com', 'Wrong1234'),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      await flushBackgroundWork();

      expect(auditService.log).toHaveBeenCalledWith({
        action: AuditAction.USER_LOGIN_FAILED,
        entity: AuditEntity.USER,
        entityId: 'user-1',
        metadata: { reason: 'wrong_password' },
      });
      expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
        'Wrong1234',
      );
    });

    it('answers without waiting for the audit entry, and logs its failure', async () => {
      const error = new Error('audit insert failed');
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
      auditService.log.mockRejectedValue(error);

      await expectHttpError(
        service.verify('jane@example.com', 'Wrong1234'),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
      await flushBackgroundWork();
      expect(loggerError).toHaveBeenCalledWith(
        'Background task failed',
        error.stack,
      );
    });

    it('answers 403 AUTH_ACCOUNT_DISABLED for a disabled account, only after the password matched', async () => {
      usersService.findWithPasswordByEmail.mockResolvedValue(
        buildUserWithPassword({ isActive: false }),
      );

      await expectHttpError(
        service.verify('jane@example.com', 'Passw0rd!'),
        ForbiddenException,
        AuthErrorCode.ACCOUNT_DISABLED,
      );

      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expectHttpError(
        service.verify('jane@example.com', 'Wrong1234'),
        UnauthorizedException,
        AuthErrorCode.INVALID_CREDENTIALS,
      );
    });
  });
});
