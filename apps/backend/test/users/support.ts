import type { User } from '../../src/generated/prisma/client.js';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums.js';
import type { TestApp } from '../utils/app.js';
import { loginAs, type LoggedIn } from '../utils/auth.js';
import {
  createUser,
  type CreateUserOptions,
  type Db,
} from '../utils/factories.js';

export const USERS_URL = '/api/v1/admin/users';
export const AUDIT_LOGS_URL = '/api/v1/admin/audit-logs';

export interface Actor {
  user: User;
  auth: LoggedIn;
}

/** A fresh user with a live session (MFA treated as verified). */
export async function actorWithRole(
  testApp: TestApp,
  role: UserRole,
  options: Omit<CreateUserOptions, 'role'> = {},
): Promise<Actor> {
  const { user } = await createUser(testApp.prisma, { ...options, role });
  return { user, auth: await loginAs(testApp, user) };
}

/**
 * The test database is not wiped between runs, so ACTIVE SUPER_ADMINs from
 * earlier tests or runs exist. Archives all of them except `keepIds` (which
 * must contain at least one ACTIVE SUPER_ADMIN: the DB trigger refuses to
 * leave none).
 */
export async function archiveOtherActiveSuperAdmins(
  prisma: Db,
  keepIds: string[],
): Promise<void> {
  await prisma.user.updateMany({
    where: {
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      id: { notIn: keepIds },
    },
    data: { status: UserStatus.ARCHIVED, archivedAt: new Date() },
  });
}

/** Columns an admin action may change, for "nothing changed" assertions. */
export async function userSnapshot(prisma: Db, id: string) {
  const [user, activeSessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        role: true,
        status: true,
        blockedAt: true,
        blockedReason: true,
        archivedAt: true,
        mfaEnabled: true,
        mfaSecretEnc: true,
        updatedAt: true,
      },
    }),
    prisma.session.count({ where: { userId: id, revokedAt: null } }),
  ]);
  return { ...user, activeSessions };
}

export function auditRowsFor(prisma: Db, resourceId: string) {
  return prisma.auditLog.findMany({
    where: { resourceId },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
  });
}
