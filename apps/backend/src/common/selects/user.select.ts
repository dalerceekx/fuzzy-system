import type { Prisma } from '../../generated/prisma/client.js';

/** The only user fields an API response may contain. */
export const USER_PUBLIC_SELECT = {
  id: true,
  phone: true,
  email: true,
  fullName: true,
  role: true,
  status: true,
  phoneVerifiedAt: true,
  mfaEnabled: true,
  isDemo: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  blockedAt: true,
  archivedAt: true,
} as const satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof USER_PUBLIC_SELECT;
}>;

/** Never returned, logged or audited. */
export const SENSITIVE_USER_FIELDS: readonly string[] = Object.freeze([
  'passwordHash',
  'mfaSecretEnc',
  'mfaPendingSecretEnc',
  'mfaLastUsedStep',
]);
