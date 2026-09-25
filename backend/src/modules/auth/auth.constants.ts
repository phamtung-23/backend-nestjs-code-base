export const AuthErrorCode = {
  EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  INVALID_CODE: 'AUTH_INVALID_CODE',
  INVALID_REFRESH_TOKEN: 'AUTH_INVALID_REFRESH_TOKEN',
  CURRENT_PASSWORD_INCORRECT: 'AUTH_CURRENT_PASSWORD_INCORRECT',
} as const;

export const BCRYPT_ROUNDS = 10;

export const OTP_LENGTH = 6;
export const OTP_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`);
// Per account and code type: at most this many codes per window, and a
// cooldown between two. With OTP_MAX_ATTEMPTS guesses per code this bounds
// brute force per account, however many IPs an attacker uses.
export const OTP_MAX_ISSUED_PER_WINDOW = 5;
export const OTP_ISSUE_WINDOW_MS = 60 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
// Cleanup keeps used codes and revoked tokens around a while for investigation
export const USED_OTP_RETENTION_MS = 24 * 60 * 60 * 1000;
export const REVOKED_TOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// A rotated refresh token presented again within this window is treated as two
// tabs refreshing at once (plain 401); later it counts as reuse of a copied
// token and revokes the whole session family
export const REFRESH_REUSE_GRACE_MS = 30 * 1000;

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores everything past 72 bytes
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

// Hash of a random string nobody knows. Unknown emails are compared against it
// so failed logins take as long whether or not the account exists.
export const DUMMY_PASSWORD_HASH =
  '$2b$10$J0M2tF7ESvWjRwOZkgwFs.N4HxGkeXhJcVqo58685FyxSJ94neZwm';

// Public flows answer the same way whether or not the account exists
export const AuthMessage = {
  REGISTERED:
    'Registration successful. Check your email for the verification code.',
  VERIFICATION_SENT:
    'If the account exists and is not verified yet, a verification code has been sent.',
  PASSWORD_RESET_SENT:
    'If an account with that email exists, a password reset code has been sent.',
  LOGIN_CODE_SENT:
    'If an account with that email exists, a login code has been sent.',
} as const;
