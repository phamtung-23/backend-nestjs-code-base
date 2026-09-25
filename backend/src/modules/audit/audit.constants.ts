import { IncludeSpec } from '../../common/query';

// Core actions, <entity>.<past_tense_verb>. Modules declare their own in
// their constants file. Public contract for whoever reads the audit trail:
// add new actions, never rename existing ones.
export const AuditAction = {
  USER_REGISTERED: 'user.registered',
  USER_EMAIL_VERIFIED: 'user.email_verified',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_LOGIN_FAILED: 'user.login_failed',
  USER_SESSIONS_REVOKED: 'user.sessions_revoked',
  SESSION_STARTED: 'session.started',
  SESSION_ENDED: 'session.ended',
  SESSION_REUSE_DETECTED: 'session.reuse_detected',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditEntity = {
  USER: 'user',
  // Sessions are refresh token families; entityId is the familyId
  SESSION: 'session',
} as const;

// No `search` and no sort by action: `action` has a handful of values, so
// ILIKE '%term%' and ORDER BY action scan most of a large table. Filter by
// ?action= instead.
export const AUDIT_SORTABLE = ['createdAt'] as const;
export const AUDIT_DEFAULT_SORT = '-createdAt';
export const AUDIT_FIELDS = [
  'actorId',
  'action',
  'entity',
  'entityId',
  'changes',
  'metadata',
  'ipAddress',
  'userAgent',
  'requestId',
  'createdAt',
] as const;
// Entries reference ids, not relations (they outlive what they mention)
export const AUDIT_INCLUDABLE: Record<string, IncludeSpec> = {};

// How long entries (with their IP and user agent) are kept. A legal and
// compliance decision: set it per project.
export const AUDIT_RETENTION_DAYS = 365;
