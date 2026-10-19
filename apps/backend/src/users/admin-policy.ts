import { Errors } from '../common/errors/app.exception.js';
import { UserRole, UserStatus } from '../generated/prisma/enums.js';

/** The fields every admin rule is decided on (read from the DB in the tx). */
export interface PolicyUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  isDemo: boolean;
}

/** Only a SUPER_ADMIN may grant these roles or act on users holding them. */
export const PRIVILEGED_ROLES: readonly UserRole[] = Object.freeze([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
]);

export const AdminErrors = {
  selfAction: () =>
    Errors.forbidden(
      'O‘zingizga nisbatan bu amalni bajarib bo‘lmaydi',
      'SELF_ACTION_FORBIDDEN',
    ),
  demoCreate: () =>
    Errors.forbidden(
      'Demo akkaunt orqali yangi foydalanuvchi yaratib bo‘lmaydi',
      'DEMO_ACTION_FORBIDDEN',
    ),
  lastSuperAdmin: () =>
    Errors.conflict(
      'LAST_SUPER_ADMIN',
      'Oxirgi faol SUPER_ADMIN’ni pasaytirib, bloklab yoki arxivlab bo‘lmaydi',
    ),
};

/**
 * The acting user as re-read inside the transaction: it must still be ACTIVE
 * and still hold one of `allowed` (the guard's check may be stale by now).
 */
export function assertActorAllowed(
  actor: PolicyUser | undefined,
  allowed: readonly UserRole[],
): asserts actor is PolicyUser {
  if (
    !actor ||
    actor.status !== UserStatus.ACTIVE ||
    !allowed.includes(actor.role)
  ) {
    throw Errors.forbidden();
  }
}

/**
 * Whether `actor` may perform an admin mutation on `target`. Order matters:
 * a target the actor may not see is reported as 404 before any 403, so the
 * response never confirms that a hidden account exists.
 */
export function assertMayActOn(
  actor: PolicyUser,
  target: PolicyUser | undefined,
): asserts target is PolicyUser {
  if (actor.id === target?.id) throw AdminErrors.selfAction();
  if (
    !target ||
    target.status === UserStatus.ARCHIVED ||
    (actor.isDemo && !target.isDemo)
  ) {
    throw Errors.notFound();
  }
  if (
    actor.role !== UserRole.SUPER_ADMIN &&
    PRIVILEGED_ROLES.includes(target.role)
  ) {
    throw Errors.forbidden();
  }
}

export function assertMayGrant(actorRole: UserRole, role: UserRole): void {
  if (actorRole !== UserRole.SUPER_ADMIN && PRIVILEGED_ROLES.includes(role)) {
    throw Errors.forbidden();
  }
}

/** True when applying `next` to `target` removes one ACTIVE SUPER_ADMIN. */
export function reducesActiveSuperAdmins(
  target: Pick<PolicyUser, 'role' | 'status'>,
  next: { role?: UserRole; status?: UserStatus },
): boolean {
  const isActiveSuperAdmin = (role: UserRole, status: UserStatus) =>
    role === UserRole.SUPER_ADMIN && status === UserStatus.ACTIVE;
  return (
    isActiveSuperAdmin(target.role, target.status) &&
    !isActiveSuperAdmin(next.role ?? target.role, next.status ?? target.status)
  );
}
