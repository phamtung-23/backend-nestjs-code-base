import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { runInBackground } from '../../common/helpers/background.helper';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { UserWithPassword } from '../users/interfaces/user.interface';
import { UsersService } from '../users/users.service';
import { BCRYPT_ROUNDS, DUMMY_PASSWORD_HASH } from './auth.constants';
import { AuthErrors } from './auth.errors';

// Password hashing and the email + password check
@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  matches(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // Shared by login and verify-email. Unknown emails are compared against a
  // dummy hash, so both cases take as long and answer alike (401). A wrong
  // password for an existing account is audited as a failed login.
  async verify(email: string, password: string): Promise<UserWithPassword> {
    const record = await this.usersService.findWithPasswordByEmail(email);
    const passwordMatches = await this.matches(
      password,
      record?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (record && !passwordMatches) {
      // In the background, so a wrong password for an existing account isn't
      // slower than one for an unknown email
      const userId = record.id;
      runInBackground(this.logger, () =>
        this.auditService.log({
          action: AuditAction.USER_LOGIN_FAILED,
          entity: AuditEntity.USER,
          entityId: userId,
          metadata: { reason: 'wrong_password' },
        }),
      );
    }
    if (!record || !passwordMatches) {
      throw AuthErrors.invalidCredentials();
    }
    if (!record.isActive) {
      throw AuthErrors.accountDisabled();
    }
    return record;
  }
}
