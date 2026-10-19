import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from '../../security/crypto.js';

// RFC 6238 TOTP (built on RFC 4226 HOTP). Authenticator apps use SHA-1,
// 6 digits and a 30 s period; the other algorithms exist for the RFC test
// vectors.
export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SECRET_BYTES = 20;
/** Accepted clock drift, in steps on each side of the current one. */
export const TOTP_WINDOW = 1;

export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** RFC 4226 HOTP value for a counter. */
export function hotp(
  secret: Uint8Array,
  counter: number,
  digits: number = TOTP_DIGITS,
  algorithm: TotpAlgorithm = 'sha1',
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * Returns the time step `code` matches within ±TOTP_WINDOW of now, or null.
 * Steps ≤ `afterStep` are never accepted (replay protection: the caller
 * stores the returned step and passes it back as `afterStep` next time).
 */
export function matchTotp(
  secret: Uint8Array,
  code: string,
  options: { nowMs?: number; afterStep?: number | null } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(options.nowMs);
  const after = options.afterStep ?? -1;
  let matched: number | null = null;
  // Every candidate is computed and compared, so timing does not reveal
  // which step matched.
  for (
    let step = current - TOTP_WINDOW;
    step <= current + TOTP_WINDOW;
    step++
  ) {
    const equal = safeEqual(hotp(secret, step), code);
    if (equal && step > after && matched === null) matched = step;
  }
  return matched;
}

/** otpauth:// URI for QR codes (Key Uri Format). */
export function otpauthUrl(params: {
  issuer: string;
  account: string;
  secretBase32: string;
}): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`;
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
