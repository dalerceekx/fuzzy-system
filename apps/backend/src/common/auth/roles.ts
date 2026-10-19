import { UserRole } from '../../generated/prisma/enums.js';

export const ALL_ROLES: readonly UserRole[] = Object.freeze([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPPORT,
  UserRole.VET,
  UserRole.FARMER,
]);

export const STAFF_ROLES: readonly UserRole[] = Object.freeze([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPPORT,
  UserRole.VET,
]);

export const ADMIN_ROLES: readonly UserRole[] = Object.freeze([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
]);

// Sessions of these roles are only usable after a TOTP check (enforced by
// SessionService.createSession and on every request by AccessTokenGuard).
export const MFA_REQUIRED_ROLES: readonly UserRole[] = Object.freeze([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
]);

export function isMfaRequiredRole(role: UserRole): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}
