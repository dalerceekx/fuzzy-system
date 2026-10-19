const UZ_PHONE = /^\+998\d{9}$/;

/**
 * Normalizes Uzbek phone input to E.164 ('+998XXXXXXXXX'), mirroring the
 * backend's normalizePhone: '+998 90 123-45-67', '998901234567' and
 * '901234567' are accepted. Returns null for anything else.
 */
export function normalizeUzPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  let candidate: string;
  if (/^\+998\d{9}$/.test(digits)) candidate = digits;
  else if (/^998\d{9}$/.test(digits)) candidate = `+${digits}`;
  else if (/^\d{9}$/.test(digits)) candidate = `+998${digits}`;
  else return null;
  return UZ_PHONE.test(candidate) ? candidate : null;
}

/** '+998901234567' → '+998 90 123 45 67' (display only). */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const match = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+998 ${match[1]} ${match[2]} ${match[3]} ${match[4]}` : phone;
}
