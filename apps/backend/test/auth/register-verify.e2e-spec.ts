import { AuditAction } from '../../src/audit/audit-actions.js';
import {
  OtpPurpose,
  UserRole,
  UserStatus,
} from '../../src/generated/prisma/enums.js';
import { hmacSha256Hex } from '../../src/security/crypto.js';
import { verifyPassword } from '../../src/security/password.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser, uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import {
  AUTH,
  otpFor,
  settle,
  register,
  registerVerified,
  skipResendCooldown,
  STRONG_PASSWORD,
} from './helpers.js';

describe('Auth: register, verify-phone, otp/resend', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const verify = (verificationId: string, code: string) =>
    testApp
      .http()
      .post(`${AUTH}/verify-phone`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ verificationId, code });

  it('registers a FARMER in PENDING_VERIFICATION with a hashed password and OTP', async () => {
    const { phone, verificationId, res } = await register(testApp, {
      phone: (await uniquePhone()).replace('+998', '998 '),
    });
    const normalized = phone.replace('998 ', '+998');
    expect(res.body).toEqual({
      verificationId,
      expiresIn: 300,
      resendAfter: 60,
      message: 'Agar raqam to‘g‘ri bo‘lsa, tasdiqlash kodi yuboriladi',
    });

    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { phone: normalized },
    });
    expect(user).toMatchObject({
      role: UserRole.FARMER,
      status: UserStatus.PENDING_VERIFICATION,
      isDemo: false,
      phoneVerifiedAt: null,
      fullName: 'Ali Valiyev',
    });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(await verifyPassword(STRONG_PASSWORD, user.passwordHash)).toBe(true);

    const otp = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    const code = await otpFor(testApp, normalized);
    expect(code).toMatch(/^\d{6}$/);
    // Only the peppered HMAC of id:code is stored.
    expect(otp).toMatchObject({
      userId: user.id,
      purpose: OtpPurpose.PHONE_VERIFICATION,
      attempts: 0,
      maxAttempts: 5,
      consumedAt: null,
    });
    expect(otp.codeHash).toBe(
      hmacSha256Hex(process.env.OTP_PEPPER ?? '', `${verificationId}:${code}`),
    );
    expect(JSON.stringify(otp)).not.toContain(code);

    const audit = await testApp.prisma.auditLog.findFirst({
      where: { action: AuditAction.AUTH_REGISTER, resourceId: user.id },
    });
    expect(audit).toMatchObject({ actorId: null, resourceType: 'user' });
    expect(JSON.stringify(audit?.newValue)).not.toContain(normalized);
  });

  it('verify-phone activates the account once; the user can log in afterwards', async () => {
    const { phone, verificationId } = await register(testApp);
    const code = (await otpFor(testApp, phone)) ?? '';

    const res = await verify(verificationId, code).expect(200);
    expect(res.body).toEqual({ message: expect.any(String) });
    expect(res.body).not.toHaveProperty('accessToken');

    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { phone },
    });
    expect(user.status).toBe(UserStatus.ACTIVE);
    expect(user.phoneVerifiedAt).toBeInstanceOf(Date);
    const otp = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    expect(otp.consumedAt).toBeInstanceOf(Date);
    expect(
      await testApp.prisma.auditLog.count({
        where: {
          action: AuditAction.AUTH_PHONE_VERIFIED,
          resourceId: user.id,
        },
      }),
    ).toBe(1);

    await testApp
      .http()
      .post(`${AUTH}/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, password: STRONG_PASSWORD })
      .expect(200);
  });

  it('pending users cannot log in: a correct password looks like a wrong one (401)', async () => {
    const { phone, verificationId } = await register(testApp);
    const attempt = (password: string) =>
      testApp
        .http()
        .post(`${AUTH}/login`)
        .set('X-Forwarded-For', uniqueIp())
        .send({ phone, password })
        .expect(401);
    const ok = await attempt(STRONG_PASSWORD);
    const wrong = await attempt('Wrong-password-1');
    expect({ ...ok.body, requestId: null }).toEqual({
      ...wrong.body,
      requestId: null,
    });
    expect(ok.body.code).toBe('INVALID_CREDENTIALS');

    // Pending attempts count toward the lockout like any failure …
    for (let i = 0; i < 3; i++) await attempt(STRONG_PASSWORD);
    await testApp
      .http()
      .post(`${AUTH}/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, password: STRONG_PASSWORD })
      .expect(429);
    // … and verifying the phone lifts it for the owner.
    await verify(verificationId, (await otpFor(testApp, phone)) ?? '').expect(
      200,
    );
    await testApp
      .http()
      .post(`${AUTH}/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, password: STRONG_PASSWORD })
      .expect(200);
  });

  it('re-registering a pending phone: latest registration wins and binds the code to the new id', async () => {
    const first = await register(testApp, { password: 'Birinchi-parol-1' });
    const firstCode = (await otpFor(testApp, first.phone)) ?? '';
    await skipResendCooldown(testApp, first.verificationId);
    const second = await register(testApp, {
      phone: first.phone,
      password: 'Ikkinchi-parol-2',
    });
    const secondCode = (await otpFor(testApp, first.phone)) ?? '';
    expect(second.verificationId).not.toBe(first.verificationId);

    // The first registration's id is dead, even with its own code …
    await verify(first.verificationId, firstCode).expect(400);
    // … and the new code only works with the new id.
    await verify(first.verificationId, secondCode).expect(400);
    await verify(second.verificationId, secondCode).expect(200);

    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { phone: first.phone },
    });
    expect(await verifyPassword('Ikkinchi-parol-2', user.passwordHash)).toBe(
      true,
    );
    expect(
      await testApp.prisma.user.count({ where: { phone: first.phone } }),
    ).toBe(1);
  });

  it('an existing ACTIVE account is never modified and gets no SMS (same 202)', async () => {
    const { user } = await createUser(testApp.prisma);
    testApp.sms.clear();
    const res = await testApp
      .http()
      .post(`${AUTH}/register`)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        phone: user.phone,
        fullName: 'Hujumchi',
        password: STRONG_PASSWORD,
      })
      .expect(202);
    await settle(testApp);
    expect(Object.keys(res.body).sort()).toEqual([
      'expiresIn',
      'message',
      'resendAfter',
      'verificationId',
    ]);
    expect(testApp.sms.lastTo(user.phone)).toBeUndefined();
    const after = await testApp.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.passwordHash).toBe(user.passwordHash);
    expect(after.fullName).toBe(user.fullName);
    expect(
      await testApp.prisma.otpCode.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(
      await testApp.prisma.otpCode.findUnique({
        where: { id: res.body.verificationId as string },
      }),
    ).toBeNull();
  });

  it('validates input: phone format, demo prefix, password policy, name length', async () => {
    const phone = await uniquePhone();
    const cases: Array<Record<string, unknown>> = [
      { phone: '12345', fullName: 'Ali Valiyev', password: STRONG_PASSWORD },
      {
        phone: '+998000000123',
        fullName: 'Ali Valiyev',
        password: STRONG_PASSWORD,
      },
      { phone, fullName: 'Ali Valiyev', password: 'short1' },
      { phone, fullName: 'Ali Valiyev', password: 'onlyletters' },
      { phone, fullName: 'Ali Valiyev', password: '1234567890' },
      { phone, fullName: 'A', password: STRONG_PASSWORD },
      { phone, fullName: 'x'.repeat(101), password: STRONG_PASSWORD },
      { phone, fullName: null, password: STRONG_PASSWORD },
    ];
    for (const body of cases) {
      await testApp
        .http()
        .post(`${AUTH}/register`)
        .set('X-Forwarded-For', uniqueIp())
        .send(body)
        .expect(400);
    }
    const weak = await testApp
      .http()
      .post(`${AUTH}/register`)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        phone,
        fullName: 'Ali Valiyev',
        password: `p${phone.slice(4)}`,
      })
      .expect(400);
    expect(weak.body.code).toBe('PASSWORD_WEAK');
    expect(await testApp.prisma.user.count({ where: { phone } })).toBe(0);
  });

  it('verify-phone failures are uniform 400 OTP_INVALID', async () => {
    const { phone, verificationId } = await register(testApp);
    const code = (await otpFor(testApp, phone)) ?? '';
    const wrong = code === '000000' ? '111111' : '000000';
    const bodies = [
      (await verify(verificationId, wrong).expect(400)).body,
      (await verify(crypto.randomUUID(), code).expect(400)).body,
    ];
    for (const body of bodies) {
      expect(body).toMatchObject({
        code: 'OTP_INVALID',
        message: 'Kod noto‘g‘ri yoki muddati o‘tgan',
      });
    }
    await verify('not-a-uuid', code).expect(400);
    await verify(verificationId, '12ab56').expect(400);
  });

  it('otp/resend issues a new code for the same id, resets attempts and counts sends', async () => {
    const { phone, verificationId } = await register(testApp);
    const oldCode = (await otpFor(testApp, phone)) ?? '';
    await verify(
      verificationId,
      oldCode === '000000' ? '111111' : '000000',
    ).expect(400);

    await skipResendCooldown(testApp, verificationId);
    const res = await testApp
      .http()
      .post(`${AUTH}/otp/resend`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ verificationId })
      .expect(202);
    expect(res.body).toEqual({
      verificationId,
      expiresIn: 300,
      resendAfter: 60,
      message: 'Agar raqam to‘g‘ri bo‘lsa, tasdiqlash kodi yuboriladi',
    });
    await settle(testApp);
    const row = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    expect(row).toMatchObject({ attempts: 0, sendCount: 2 });
    const newCode = (await otpFor(testApp, phone)) ?? '';
    if (newCode !== oldCode) await verify(verificationId, oldCode).expect(400);
    await verify(verificationId, newCode).expect(200);
  });

  it('otp/resend stops after OTP_MAX_SENDS sends', async () => {
    const { verificationId } = await register(testApp);
    // The registration was send #1; four resends reach the default max (5).
    for (let i = 0; i < 4; i++) {
      await skipResendCooldown(testApp, verificationId);
      await testApp
        .http()
        .post(`${AUTH}/otp/resend`)
        .set('X-Forwarded-For', uniqueIp())
        .send({ verificationId })
        .expect(202);
    }
    await skipResendCooldown(testApp, verificationId);
    const res = await testApp
      .http()
      .post(`${AUTH}/otp/resend`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ verificationId })
      .expect(429);
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
    await settle(testApp);
    const row = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    expect(row.sendCount).toBe(5);
  });

  it('registers and verifies end to end through the helper', async () => {
    const { user } = await registerVerified(testApp);
    expect(user.status).toBe(UserStatus.ACTIVE);
  });
});
