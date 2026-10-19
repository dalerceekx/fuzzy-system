import { DEMO_PHONE_PREFIX, normalizePhone } from '../../src/common/phone.js';
import { UserRole } from '../../src/generated/prisma/enums.js';

// Pure (no I/O) so it can be unit-tested: turns the seed's environment into
// the list of demo accounts, or a list of human-readable errors.

export const DEMO_PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface DemoAccount {
  key: string;
  role: UserRole;
  fullName: string;
  phone: string;
  email: string | null;
  password: string;
}

export interface DemoConfig {
  accounts: DemoAccount[];
  /** Env-driven accounts left out because their phone is not configured. */
  skipped: string[];
}

export type DemoConfigResult =
  { ok: true; config: DemoConfig } | { ok: false; errors: string[] };

// Staff/second-farmer accounts live in the reserved DEMO_PHONE_PREFIX range,
// which no real subscriber can own, so these numbers may be fixed in code.
const STAFF_ACCOUNTS = [
  { key: 'ADMIN', role: UserRole.ADMIN, fullName: 'Demo Admin', n: 1 },
  { key: 'SUPPORT', role: UserRole.SUPPORT, fullName: 'Demo Support', n: 2 },
  { key: 'VET', role: UserRole.VET, fullName: 'Demo Veterinar', n: 3 },
  { key: 'FARMER_2', role: UserRole.FARMER, fullName: 'Demo Fermer 2', n: 4 },
] as const;

// The two main demo logins are configured entirely through env (user
// decision): phone, email and password are never hard-coded.
const ENV_ACCOUNTS = [
  {
    key: 'SUPER_ADMIN',
    role: UserRole.SUPER_ADMIN,
    fullName: 'Demo Super Admin',
  },
  { key: 'FARMER', role: UserRole.FARMER, fullName: 'Demo Fermer' },
] as const;

export function demoStaffPhone(n: number): string {
  return `${DEMO_PHONE_PREFIX}${String(n).padStart(3, '0')}`;
}

function passwordErrors(
  name: string,
  password: string,
  phone: string,
): string[] {
  const errors: string[] = [];
  if (
    password.length < DEMO_PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    errors.push(
      `${name} ${DEMO_PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} belgi bo‘lishi kerak`,
    );
  }
  if (!/\p{L}/u.test(password) || !/\p{Nd}/u.test(password)) {
    errors.push(`${name} kamida bitta harf va bitta raqamdan iborat bo‘lsin`);
  }
  if (password.replace(/\D/g, '').includes(phone.slice(-9))) {
    errors.push(`${name} telefon raqamini o‘z ichiga olmasin`);
  }
  return errors;
}

export function resolveDemoConfig(
  env: Record<string, string | undefined>,
): DemoConfigResult {
  const errors: string[] = [];
  const accounts: DemoAccount[] = [];
  const skipped: string[] = [];
  const sharedPassword = env.DEMO_PASSWORD;

  if (!sharedPassword) {
    // No default password anywhere, on purpose.
    return { ok: false, errors: ['DEMO_PASSWORD berilmagan'] };
  }

  for (const account of ENV_ACCOUNTS) {
    const prefix = `DEMO_${account.key}`;
    const rawPhone = env[`${prefix}_PHONE`];
    if (!rawPhone) {
      skipped.push(`${prefix}_PHONE`);
      continue;
    }
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      errors.push(`${prefix}_PHONE noto‘g‘ri (+998XXXXXXXXX)`);
      continue;
    }
    const rawEmail = env[`${prefix}_EMAIL`]?.trim().toLowerCase();
    if (rawEmail && (rawEmail.length > 254 || !EMAIL.test(rawEmail))) {
      errors.push(`${prefix}_EMAIL noto‘g‘ri`);
      continue;
    }
    const passwordName = env[`${prefix}_PASSWORD`]
      ? `${prefix}_PASSWORD`
      : 'DEMO_PASSWORD';
    const password = env[`${prefix}_PASSWORD`] ?? sharedPassword;
    errors.push(...passwordErrors(passwordName, password, phone));
    accounts.push({
      key: account.key,
      role: account.role,
      fullName: account.fullName,
      phone,
      email: rawEmail || null,
      password,
    });
  }

  for (const account of STAFF_ACCOUNTS) {
    const phone = demoStaffPhone(account.n);
    errors.push(...passwordErrors('DEMO_PASSWORD', sharedPassword, phone));
    accounts.push({
      key: account.key,
      role: account.role,
      fullName: account.fullName,
      phone,
      email: null,
      password: sharedPassword,
    });
  }

  const phones = new Set(accounts.map((a) => a.phone));
  if (phones.size !== accounts.length) {
    errors.push('Demo akkauntlarning telefon raqamlari takrorlanmasin');
  }
  const emails = accounts.flatMap((a) => (a.email ? [a.email] : []));
  if (new Set(emails).size !== emails.length) {
    errors.push('Demo akkauntlarning email manzillari takrorlanmasin');
  }

  const unique = [...new Set(errors)];
  return unique.length > 0
    ? { ok: false, errors: unique }
    : { ok: true, config: { accounts, skipped } };
}
