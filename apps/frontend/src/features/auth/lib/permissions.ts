import type { PublicUser, UserRole, UserStatus } from '@/shared/types/api';

/**
 * Role-based UI rules derived from the backend contract (CONTRACT §4–§7).
 * They only decide what to show; the backend enforces every rule again and
 * the UI handles its 403 answers.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Administrator',
  SUPPORT: 'Qo‘llab-quvvatlash',
  VET: 'Veterinar',
  FARMER: 'Fermer',
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  PENDING_VERIFICATION: 'Tasdiqlanmagan',
  ACTIVE: 'Faol',
  BLOCKED: 'Bloklangan',
  ARCHIVED: 'Arxivlangan',
};

export const STAFF_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'VET'];
export const ADMIN_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN'];

export const can = {
  useFarmerApp: (role: UserRole) => role === 'FARMER',
  useStaffApp: (role: UserRole) => STAFF_ROLES.includes(role),
  viewUsers: (role: UserRole) => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'SUPPORT',
  manageUsers: (role: UserRole) => ADMIN_ROLES.includes(role),
  createUsers: (role: UserRole) => ADMIN_ROLES.includes(role),
  resetMfa: (role: UserRole) => role === 'SUPER_ADMIN',
  viewAuditLogs: (role: UserRole) => ADMIN_ROLES.includes(role),
  manageMedicines: (role: UserRole) => role === 'VET' || ADMIN_ROLES.includes(role),
  /** Only a VET may approve medicines (DB-enforced as well). */
  approveMedicines: (role: UserRole) => role === 'VET',
  viewAllMedicineStatuses: (role: UserRole) => STAFF_ROLES.includes(role),
};

/** Roles an actor may grant: SUPER_ADMIN any, ADMIN only below admin level. */
export function assignableRoles(actor: UserRole): UserRole[] {
  if (actor === 'SUPER_ADMIN') return ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'VET', 'FARMER'];
  if (actor === 'ADMIN') return ['SUPPORT', 'VET', 'FARMER'];
  return [];
}

/** Whether `actor` may run admin actions on `target` (no self-actions; ADMIN cannot touch admins). */
export function canActOn(actor: Pick<PublicUser, 'id' | 'role'>, target: Pick<PublicUser, 'id' | 'role'>): boolean {
  if (!can.manageUsers(actor.role) || actor.id === target.id) return false;
  if (actor.role === 'ADMIN' && ADMIN_ROLES.includes(target.role)) return false;
  return true;
}

/** Landing page after login for each role. */
export function roleHome(role: UserRole): string {
  if (role === 'FARMER') return '/dashboard';
  if (role === 'VET') return '/admin/medicines';
  return '/admin';
}
