import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(key: string, input: string): string {
  return createHmac('sha256', key).update(input).digest('hex');
}

/**
 * Constant-time string comparison that is also safe for different lengths:
 * both sides are hashed to fixed-size digests before comparing.
 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/** URL-safe random token (base64url), 32 bytes by default. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Uniformly random numeric code, zero-padded (default 6 digits). */
export function generateNumericCode(digits = 6): string {
  if (!Number.isInteger(digits) || digits < 1 || digits > 12) {
    throw new RangeError('digits must be an integer between 1 and 12');
  }
  return randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0');
}

/** Stable pseudonymous id for Redis keys (never put raw phones in keys). */
export function hashIdentifier(value: string): string {
  return sha256Hex(value).slice(0, 32);
}

/** Key id of a secret: first 8 hex chars of sha256(secret). */
export function keyId(secret: string | Buffer): string {
  return sha256Hex(secret).slice(0, 8);
}
