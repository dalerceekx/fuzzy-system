import type { Response } from 'supertest';
import { vi } from 'vitest';
import { UserStatus } from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser, uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { OtpService } from '../../src/auth/otp.service.js';
import {
  AUTH,
  register,
  settle,
  skipResendCooldown,
  STRONG_PASSWORD,
} from './helpers.js';

/** Status + body shape with per-request values (ids, request ids) masked. */
function shape(res: Response) {
  const mask = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(mask);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          key === 'verificationId' || key === 'requestId'
            ? typeof child
            : mask(child),
        ]),
      );
    }
    return value;
  };
  return {
    status: res.status,
    body: mask(res.body),
    retryAfter: res.headers['retry-after'] !== undefined,
  };
}

/**
 * The anonymous endpoints never reveal whether a phone (or verification id)
 * exists: existing and unknown inputs give identical status and body shape.
 */
describe('Auth: uniform responses for existing vs unknown accounts', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const post = (path: string, body: object) =>
    testApp
      .http()
      .post(`${AUTH}/${path}`)
      .set('X-Forwarded-For', uniqueIp())
      .send(body);

  it('POST /register', async () => {
    const existing = (await createUser(testApp.prisma)).user.phone;
    const blocked = (
      await createUser(testApp.prisma, { status: UserStatus.BLOCKED })
    ).user.phone;
    const unknown = await uniquePhone();
    const results = [];
    for (const phone of [unknown, existing, blocked]) {
      results.push(
        shape(
          await post('register', {
            phone,
            fullName: 'Ali Valiyev',
            password: STRONG_PASSWORD,
          }),
        ),
      );
    }
    expect(results[0].status).toBe(202);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('POST /password/forgot', async () => {
    const existing = (await createUser(testApp.prisma)).user.phone;
    const unknown = await uniquePhone();
    const a = shape(await post('password/forgot', { phone: existing }));
    const b = shape(await post('password/forgot', { phone: unknown }));
    expect(a.status).toBe(202);
    expect(b).toEqual(a);
  });

  it('POST /otp/resend (real vs unknown id: 429 during cooldown, then 202)', async () => {
    const real = (await register(testApp)).verificationId;
    const decoy = (
      await post('register', {
        phone: (await createUser(testApp.prisma)).user.phone,
        fullName: 'Ali Valiyev',
        password: STRONG_PASSWORD,
      })
    ).body.verificationId as string;

    // Both are in the cooldown that started at registration.
    const coolingReal = shape(
      await post('otp/resend', { verificationId: real }),
    );
    const coolingDecoy = shape(
      await post('otp/resend', { verificationId: decoy }),
    );
    expect(coolingReal.status).toBe(429);
    expect(coolingDecoy).toEqual(coolingReal);

    // A never-issued id behaves like a decoy.
    const never = shape(
      await post('otp/resend', { verificationId: crypto.randomUUID() }),
    );
    expect(never.status).toBe(202);
    for (const id of [real, decoy]) {
      await skipResendCooldown(testApp, id);
    }
    await testApp.prisma.otpCode.updateMany({
      where: { id: real },
      data: { lastSentAt: new Date(Date.now() - 3600_000) },
    });
    const okReal = shape(await post('otp/resend', { verificationId: real }));
    const okDecoy = shape(await post('otp/resend', { verificationId: decoy }));
    expect(okReal).toEqual(never);
    expect(okDecoy).toEqual(never);
  });

  it('POST /login (wrong password vs unknown phone)', async () => {
    const existing = (await createUser(testApp.prisma)).user.phone;
    const unknown = await uniquePhone();
    const a = shape(
      await post('login', { phone: existing, password: 'Wrong-pass-1' }),
    );
    const b = shape(
      await post('login', { phone: unknown, password: 'Wrong-pass-1' }),
    );
    expect(a).toEqual({
      status: 401,
      retryAfter: false,
      body: {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Telefon yoki parol noto‘g‘ri',
        requestId: 'string',
      },
    });
    expect(b).toEqual(a);
  });

  it('register + login cannot tell a new phone from a registered one', async () => {
    // Anyone can register any phone with a password of their choice; the
    // follow-up login must not reveal whether that password was stored.
    const active = (await createUser(testApp.prisma)).user.phone;
    const unknown = await uniquePhone();
    const results = [];
    for (const phone of [active, unknown]) {
      const reg = await post('register', {
        phone,
        fullName: 'Hujumchi',
        password: 'Attacker-pass-77',
      });
      await settle(testApp);
      const res = await post('login', { phone, password: 'Attacker-pass-77' });
      results.push({ register: shape(reg), login: shape(res) });
    }
    expect(results[0].register.status).toBe(202);
    expect(results[0].login.body).toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(results[1]).toEqual(results[0]);
  });

  /**
   * Timing: the request path must not depend on the account. Account work
   * is blocked here; every endpoint still answers, so none of it (lookup,
   * OTP writes, audit, SMS) is awaited before the response.
   */
  it('register / forgot / resend answer before any account-dependent work', async () => {
    const existing = (await createUser(testApp.prisma)).user.phone;
    const resetPhone = (await createUser(testApp.prisma)).user.phone;
    const real = (await register(testApp)).verificationId;
    await skipResendCooldown(testApp, real);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const auth = testApp.app.get(AuthService) as unknown as Record<
      string,
      () => Promise<unknown>
    >;
    const otp = testApp.app.get(OtpService) as unknown as Record<
      string,
      () => Promise<unknown>
    >;
    const spies = [
      vi.spyOn(auth, 'registerAccount').mockReturnValue(gate),
      vi.spyOn(auth, 'issueResetCode').mockReturnValue(gate),
      vi.spyOn(otp, 'regenerate').mockReturnValue(gate),
    ];
    try {
      const responses = await Promise.race([
        Promise.all([
          post('register', {
            phone: existing,
            fullName: 'Ali Valiyev',
            password: STRONG_PASSWORD,
          }),
          post('password/forgot', { phone: resetPhone }),
          post('otp/resend', { verificationId: real }),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('response awaited work')), 5000),
        ),
      ]);
      expect(responses.map((res) => res.status)).toEqual([202, 202, 202]);
      for (const spy of spies) expect(spy).toHaveBeenCalled();
    } finally {
      release();
      await settle(testApp);
      for (const spy of spies) spy.mockRestore();
    }
  });
});
