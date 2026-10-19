import { rateLimitIpKey } from '../common/context/client-ip.js';
import { Errors } from '../common/errors/app.exception.js';
import { hashIdentifier } from '../security/crypto.js';
import type { RateLimitService } from '../security/rate-limit.service.js';

export const AuthMessages = {
  verificationSent: 'Agar raqam to‘g‘ri bo‘lsa, tasdiqlash kodi yuboriladi',
  phoneVerified: 'Telefon raqami tasdiqlandi. Endi tizimga kiring',
  passwordReset: 'Parol yangilandi. Tizimga qayta kiring',
  otpInvalid: 'Kod noto‘g‘ri yoki muddati o‘tgan',
  invalidCredentials: 'Telefon yoki parol noto‘g‘ri',
  wrongCurrentPassword: 'Joriy parol noto‘g‘ri',
  accountLocked: 'Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring',
  accountBlocked: 'Akkaunt bloklangan',
  mfaInvalid: 'Tasdiqlash kodi noto‘g‘ri',
  csrfFailed: 'So‘rov tasdiqlanmadi. Sahifani yangilab qayta urinib ko‘ring',
  passwordContainsPhone: 'Parol telefon raqamidan iborat bo‘lmasin',
} as const;

export const otpInvalid = () =>
  Errors.badRequest('OTP_INVALID', AuthMessages.otpInvalid);

export const invalidCredentials = () =>
  Errors.unauthorized(AuthMessages.invalidCredentials, 'INVALID_CREDENTIALS');

export const mfaInvalid = () =>
  Errors.unauthorized(AuthMessages.mfaInvalid, 'MFA_INVALID');

export const passwordContainsPhoneError = () =>
  Errors.badRequest('PASSWORD_WEAK', AuthMessages.passwordContainsPhone);

/** Per-IP limits of the anonymous endpoints (login uses env settings). */
export const IpLimits = {
  register: { name: 'register', limit: 10, windowSeconds: 3600 },
  verifyPhone: { name: 'verify-phone', limit: 30, windowSeconds: 900 },
  otpResend: { name: 'otp-resend', limit: 20, windowSeconds: 3600 },
  passwordForgot: { name: 'password-forgot', limit: 10, windowSeconds: 3600 },
  passwordReset: { name: 'password-reset', limit: 30, windowSeconds: 900 },
} as const;

export type IpLimit = (typeof IpLimits)[keyof typeof IpLimits];

/** /password/change attempts per user and window (the counter resets on success). */
export const PASSWORD_CHANGE_LIMIT = { limit: 5, windowSeconds: 900 };

// Redis keys. Phones and verification ids are hashed (never stored raw).
export const AuthKeys = {
  ipLimit: (name: string, ip: string | undefined) =>
    `rl:${name}:ip:${rateLimitIpKey(ip)}`,
  loginIp: (ip: string | undefined) => `rl:login:ip:${rateLimitIpKey(ip)}`,
  loginFailures: (phone: string) => `rl:login:fail:${hashIdentifier(phone)}`,
  loginLock: (phone: string) => `rl:login:lock:${hashIdentifier(phone)}`,
  otpResendCooldown: (verificationId: string) =>
    `rl:otp:cooldown:${hashIdentifier(verificationId)}`,
  otpResendCount: (verificationId: string) =>
    `rl:otp:sends:${hashIdentifier(verificationId)}`,
  mfaTokenAttempts: (jti: string) => `rl:mfa:jti:${jti}`,
  mfaUserFailures: (userId: string) => `rl:mfa:fail:${userId}`,
  mfaTokenUsed: (jti: string) => `auth:mfa:used:${jti}`,
  passwordChange: (userId: string) => `rl:password-change:user:${userId}`,
};

/** Counts one request against a fixed-window limit; 429 when exceeded. */
export async function enforceLimit(
  rateLimit: RateLimitService,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await rateLimit.hit(key, limit, windowSeconds);
  if (!result.allowed) throw Errors.tooManyRequests(result.retryAfterSeconds);
}

export function enforceIpLimit(
  rateLimit: RateLimitService,
  spec: IpLimit,
  ip: string | undefined,
): Promise<void> {
  return enforceLimit(
    rateLimit,
    AuthKeys.ipLimit(spec.name, ip),
    spec.limit,
    spec.windowSeconds,
  );
}
