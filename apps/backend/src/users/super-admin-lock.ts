import { UserRole, UserStatus } from '../generated/prisma/enums.js';
import type { Tx } from '../prisma/prisma.service.js';

/**
 * Transaction-scoped advisory lock serializing every change that could alter
 * the set of ACTIVE SUPER_ADMINs (admin user mutations and the bootstrap
 * CLI). Taken before any row lock, so all writers acquire locks in the same
 * order and cannot deadlock. The deferred DB trigger
 * `users_keep_active_super_admin` remains the backstop.
 */
export async function lockSuperAdminChanges(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('users:super_admins'))`;
}

/** ACTIVE SUPER_ADMINs other than `excludeId`; call under the lock above. */
export function countOtherActiveSuperAdmins(
  tx: Tx,
  excludeId: string,
): Promise<number> {
  return tx.user.count({
    where: {
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      id: { not: excludeId },
    },
  });
}
