import { AuditAction } from '../audit/audit-actions.js';
import type { AuditService } from '../audit/audit.service.js';
import { isDemoPhone, maskPhone, normalizePhone } from '../common/phone.js';
import { sanitizeText } from '../common/strings.js';
import { UserRole, UserStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PasswordService } from '../security/password.service.js';
import { passwordPolicyError } from '../users/password-policy.js';
import { lockSuperAdminChanges } from '../users/super-admin-lock.js';

/** A refusal whose message is safe to print as is. */
export class BootstrapError extends Error {
  override readonly name = 'BootstrapError';
}

export interface BootstrapInput {
  phone: string;
  fullName: string;
  password: string;
}

/** Validates BOOTSTRAP_PHONE / BOOTSTRAP_FULL_NAME (before asking for a password). */
export function validateBootstrapTarget(
  rawPhone: string | undefined,
  rawFullName: string | undefined,
): { phone: string; fullName: string } {
  const phone = normalizePhone(rawPhone);
  if (!phone || isDemoPhone(phone)) {
    throw new BootstrapError(
      'BOOTSTRAP_PHONE noto‘g‘ri: +998XXXXXXXXX formatida bo‘lishi kerak',
    );
  }
  const fullName = sanitizeText(rawFullName ?? '');
  if (fullName.length < 2 || fullName.length > 100) {
    throw new BootstrapError(
      'BOOTSTRAP_FULL_NAME 2–100 belgidan iborat bo‘lishi kerak',
    );
  }
  return { phone, fullName };
}

export function assertBootstrapPassword(password: string, phone: string): void {
  const error = passwordPolicyError(password, phone);
  if (error) throw new BootstrapError(error);
}

/**
 * Creates the first SUPER_ADMIN: ACTIVE, phone treated as verified, MFA not
 * enrolled yet (login forces TOTP setup). Refuses when a real (non-demo)
 * ACTIVE SUPER_ADMIN exists — later admins are created through the API — or
 * when the phone already belongs to any account.
 */
export async function bootstrapSuperAdmin(
  deps: {
    prisma: PrismaService;
    passwords: PasswordService;
    audit: AuditService;
  },
  input: BootstrapInput,
): Promise<{ id: string; phoneMasked: string }> {
  const passwordHash = await deps.passwords.hash(input.password);
  return deps.prisma.$transaction(async (tx) => {
    // Same lock as admin role changes: concurrent bootstraps (or a demotion
    // racing a bootstrap) are serialized before the count below.
    await lockSuperAdminChanges(tx);
    const existing = await tx.user.count({
      where: {
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        isDemo: false,
      },
    });
    if (existing > 0) {
      throw new BootstrapError(
        'Faol SUPER_ADMIN allaqachon mavjud. Yangi administratorlarni API orqali yarating.',
      );
    }
    const taken = await tx.user.findUnique({
      where: { phone: input.phone },
      select: { id: true },
    });
    if (taken) {
      throw new BootstrapError(
        'Bu telefon raqami bilan foydalanuvchi allaqachon mavjud',
      );
    }

    const user = await tx.user.create({
      data: {
        phone: input.phone,
        fullName: input.fullName,
        passwordHash,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        phoneVerifiedAt: new Date(),
      },
      select: { id: true, phone: true, role: true },
    });
    const phoneMasked = maskPhone(user.phone);
    await deps.audit.record(
      {
        action: AuditAction.SYSTEM_SUPER_ADMIN_BOOTSTRAPPED,
        resourceType: 'user',
        resourceId: user.id,
        actorId: null,
        actorRole: null,
        newValue: { role: user.role, phoneMasked },
      },
      tx,
    );
    return { id: user.id, phoneMasked };
  });
}
