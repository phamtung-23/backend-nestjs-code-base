import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthErrorCode } from './auth.constants';

// The errors the auth flows share, so every flow answers a case the same way
export const AuthErrors = {
  emailTaken: () =>
    new ConflictException({
      errorCode: AuthErrorCode.EMAIL_TAKEN,
      message: 'An account with this email already exists',
    }),

  invalidCredentials: () =>
    new UnauthorizedException({
      errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      message: 'Email or password is incorrect',
    }),

  accountDisabled: () =>
    new ForbiddenException({
      errorCode: AuthErrorCode.ACCOUNT_DISABLED,
      message: 'This account has been disabled',
    }),

  emailNotVerified: () =>
    new ForbiddenException({
      errorCode: AuthErrorCode.EMAIL_NOT_VERIFIED,
      message: 'Verify your email address before logging in with a password',
    }),

  currentPasswordIncorrect: () =>
    new UnprocessableEntityException({
      errorCode: AuthErrorCode.CURRENT_PASSWORD_INCORRECT,
      message: 'Current password is incorrect',
    }),

  // 422: a well-formed code that is wrong, expired or used up
  invalidCode: () =>
    new UnprocessableEntityException({
      errorCode: AuthErrorCode.INVALID_CODE,
      message: 'Invalid or expired code',
    }),
};
