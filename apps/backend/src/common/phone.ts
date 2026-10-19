// Demo accounts use +998000000NNN: "00" is not a real Uzbek operator code,
// so a demo number can never belong to a real person.
export const DEMO_PHONE_PREFIX = '+998000000';

const E164_UZ = /^\+998\d{9}$/;
const MAX_INPUT_LENGTH = 32;

/**
 * '+998 90 123-45-67' | '998901234567' | '901234567' → '+998901234567'.
 * Only Uzbekistan numbers (+998 + 9 digits); anything else → null.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) {
    return null;
  }
  const trimmed = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  let normalized: string | null = null;
  if (hasPlus) {
    normalized = digits.length === 12 ? `+${digits}` : null;
  } else if (digits.length === 12) {
    normalized = `+${digits}`;
  } else if (digits.length === 9) {
    normalized = `+998${digits}`;
  }
  return normalized && E164_UZ.test(normalized) ? normalized : null;
}

export function isDemoPhone(phone: string): boolean {
  return phone.startsWith(DEMO_PHONE_PREFIX);
}

/** '+998901234567' → '+99890*****67'. Never returns the full number. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '***';
  if (phone.length < 9) return '*'.repeat(Math.max(3, phone.length));
  return `${phone.slice(0, 6)}${'*'.repeat(phone.length - 8)}${phone.slice(-2)}`;
}
