import type { Response } from 'supertest';
import { AuthKeys } from '../../src/auth/auth.constants.js';
import { DeferredWork } from '../../src/auth/deferred-work.js';
import { OtpStore } from '../../src/auth/otp.store.js';
import type { TestApp } from '../utils/app.js';
import { uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import { lastOtp } from '../utils/sms.js';

export const AUTH = '/api/v1/auth';
export const STRONG_PASSWORD = 'Yangi-parol-2026';
export const REFRESH_COOKIE = '__Secure-mf_rt';
export const CSRF_COOKIE = '__Host-mf_csrf';

export interface ParsedCookie {
  name: string;
  value: string;
  /** Lower-cased attribute names → values ('' for flags). */
  attributes: Record<string, string>;
}

export function setCookies(res: Response): ParsedCookie[] {
  const raw = res.headers['set-cookie'] as unknown;
  const list = Array.isArray(raw) ? (raw as string[]) : [];
  return list.map((line) => {
    const [pair, ...attrs] = line.split(';').map((part) => part.trim());
    const index = pair.indexOf('=');
    return {
      name: pair.slice(0, index),
      value: decodeURIComponent(pair.slice(index + 1)),
      attributes: Object.fromEntries(
        attrs.map((attr) => {
          const eq = attr.indexOf('=');
          return eq === -1
            ? [attr.toLowerCase(), '']
            : [attr.slice(0, eq).toLowerCase(), attr.slice(eq + 1)];
        }),
      ),
    };
  });
}

export function cookieValue(res: Response, name: string): string | undefined {
  return setCookies(res).find((cookie) => cookie.name === name)?.value;
}

/** Web session cookies from a login response, ready for `.set('Cookie')`. */
export function webCookies(res: Response): {
  refresh: string;
  csrf: string;
  header: string;
} {
  const refresh = cookieValue(res, REFRESH_COOKIE);
  const csrf = cookieValue(res, CSRF_COOKIE);
  if (!refresh || !csrf) throw new Error('login did not set web cookies');
  return {
    refresh,
    csrf,
    header: `${REFRESH_COOKIE}=${refresh}; ${CSRF_COOKIE}=${csrf}`,
  };
}

/**
 * Waits for the account work that register / forgot / resend run after
 * responding (DB rows, audit, SMS). Call before asserting on any of them.
 */
export function settle(testApp: TestApp): Promise<void> {
  return testApp.app.get(DeferredWork).drain();
}

/** The last OTP texted to `phone`, after deferred auth work has finished. */
export async function otpFor(
  testApp: TestApp,
  phone: string,
): Promise<string | undefined> {
  await settle(testApp);
  return lastOtp(testApp.sms, phone);
}

/** Lets the next /otp/resend through the cooldown (Redis and DB). */
export async function skipResendCooldown(
  testApp: TestApp,
  verificationId: string,
): Promise<void> {
  await settle(testApp);
  await testApp.redis.del(AuthKeys.otpResendCooldown(verificationId));
  const row = await testApp.prisma.otpCode.findUnique({
    where: { id: verificationId },
    select: { phone: true },
  });
  if (row) await testApp.redis.del(OtpStore.phoneCooldownKey(row.phone));
  await testApp.prisma.otpCode.updateMany({
    where: { id: verificationId },
    data: { lastSentAt: new Date(Date.now() - 3600_000) },
  });
}

export async function register(
  testApp: TestApp,
  options: { phone?: string; password?: string; ip?: string } = {},
) {
  const phone = options.phone ?? (await uniquePhone());
  const password = options.password ?? STRONG_PASSWORD;
  const res = await testApp
    .http()
    .post(`${AUTH}/register`)
    .set('X-Forwarded-For', options.ip ?? uniqueIp())
    .send({ phone, fullName: 'Ali Valiyev', password })
    .expect(202);
  await settle(testApp);
  const body = res.body as { verificationId: string; expiresIn: number };
  return { phone, password, verificationId: body.verificationId, res };
}

/** Registers through the API and verifies the phone with the SMS code. */
export async function registerVerified(
  testApp: TestApp,
  options: { phone?: string; password?: string } = {},
) {
  const registered = await register(testApp, options);
  const code = await otpFor(testApp, registered.phone);
  if (!code) throw new Error('no OTP delivered');
  await testApp
    .http()
    .post(`${AUTH}/verify-phone`)
    .set('X-Forwarded-For', uniqueIp())
    .send({ verificationId: registered.verificationId, code })
    .expect(200);
  const user = await testApp.prisma.user.findUniqueOrThrow({
    where: { phone: registered.phone },
  });
  return { ...registered, user };
}

export function login(
  testApp: TestApp,
  phone: string,
  password: string,
  options: { ip?: string; mobile?: boolean } = {},
) {
  const req = testApp
    .http()
    .post(`${AUTH}/login`)
    .set('X-Forwarded-For', options.ip ?? uniqueIp());
  if (options.mobile) req.set('X-Client-Type', 'mobile');
  return req.send({ phone, password });
}

/** Every key and string value of a JSON document, recursively. */
export function deepEntries(value: unknown): {
  keys: string[];
  strings: string[];
} {
  const keys: string[] = [];
  const strings: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') strings.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        keys.push(key);
        walk(child);
      }
    }
  };
  walk(value);
  return { keys, strings };
}
