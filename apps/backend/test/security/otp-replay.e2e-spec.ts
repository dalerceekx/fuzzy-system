import { OtpPurpose, UserStatus } from '../../src/generated/prisma/enums.js';
import { AUTH, otpFor, register, skipResendCooldown } from '../auth/helpers.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';

/**
 * OTP codes are single-use, short-lived, attempt-limited, rate-limited on
 * resend, and a newer code always invalidates the older one.
 */
describe('Security: OTP replay and guessing', () => {
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

  const resend = (verificationId: string) =>
    testApp
      .http()
      .post(`${AUTH}/otp/resend`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ verificationId });

  const otherCode = (code: string) => (code === '000000' ? '111111' : '000000');

  async function pending() {
    const { phone, verificationId } = await register(testApp);
    return {
      phone,
      verificationId,
      code: (await otpFor(testApp, phone)) ?? '',
    };
  }

  it('a consumed code cannot be used again', async () => {
    const { verificationId, code } = await pending();
    await verify(verificationId, code).expect(200);
    const replay = await verify(verificationId, code).expect(400);
    expect(replay.body.code).toBe('OTP_INVALID');
  });

  it('parallel submissions of the same code: exactly one succeeds', async () => {
    const { phone, verificationId, code } = await pending();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => verify(verificationId, code)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { phone },
    });
    expect(user.status).toBe(UserStatus.ACTIVE);
  });

  it('wrong guesses exhaust the code: after OTP_MAX_ATTEMPTS even the right code fails', async () => {
    const { phone, verificationId, code } = await pending();
    for (let i = 0; i < 5; i++) {
      await verify(verificationId, otherCode(code)).expect(400);
    }
    const res = await verify(verificationId, code).expect(400);
    expect(res.body.code).toBe('OTP_INVALID');
    const row = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    expect(row.attempts).toBe(5);
    expect(row.consumedAt).toBeNull();
    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { phone },
    });
    expect(user.status).toBe(UserStatus.PENDING_VERIFICATION);
  });

  it('parallel guessing cannot exceed max attempts', async () => {
    const { verificationId, code } = await pending();
    await Promise.all(
      Array.from({ length: 12 }, () => verify(verificationId, otherCode(code))),
    );
    const row = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    expect(row.attempts).toBe(5);
    await verify(verificationId, code).expect(400);
  });

  it('an expired code fails', async () => {
    const { verificationId, code } = await pending();
    await testApp.prisma.otpCode.update({
      where: { id: verificationId },
      data: {
        createdAt: new Date(Date.now() - 600_000),
        lastSentAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    await verify(verificationId, code).expect(400);
  });

  it('resend inside the cooldown → 429 with Retry-After, no new SMS', async () => {
    const { phone, verificationId } = await pending();
    const before = testApp.sms.messages().filter((m) => m.to === phone).length;
    const res = await resend(verificationId).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(testApp.sms.messages().filter((m) => m.to === phone).length).toBe(
      before,
    );
  });

  it('a resent code invalidates the previous one', async () => {
    const { phone, verificationId, code: oldCode } = await pending();
    await skipResendCooldown(testApp, verificationId);
    await resend(verificationId).expect(202);
    const newCode = (await otpFor(testApp, phone)) ?? '';
    if (newCode !== oldCode) {
      await verify(verificationId, oldCode).expect(400);
    }
    await verify(verificationId, newCode).expect(200);
  });

  it('a new registration invalidates the old code row', async () => {
    const first = await pending();
    await skipResendCooldown(testApp, first.verificationId);
    const second = await register(testApp, { phone: first.phone });
    const old = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: first.verificationId },
    });
    expect(old.invalidatedAt).toBeInstanceOf(Date);
    await verify(first.verificationId, first.code).expect(400);
    expect(
      await testApp.prisma.otpCode.count({
        where: {
          phone: first.phone,
          consumedAt: null,
          invalidatedAt: null,
        },
      }),
    ).toBe(1);
    await verify(
      second.verificationId,
      (await otpFor(testApp, first.phone)) ?? '',
    ).expect(200);
  });

  it('a used password-reset code cannot be replayed', async () => {
    const { user } = await createUser(testApp.prisma);
    const forgot = await testApp
      .http()
      .post(`${AUTH}/password/forgot`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone: user.phone })
      .expect(202);
    const body = {
      verificationId: forgot.body.verificationId as string,
      code: await otpFor(testApp, user.phone),
      newPassword: 'Yangi-parol-2026',
    };
    await testApp
      .http()
      .post(`${AUTH}/password/reset`)
      .set('X-Forwarded-For', uniqueIp())
      .send(body)
      .expect(200);
    const replay = await testApp
      .http()
      .post(`${AUTH}/password/reset`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ ...body, newPassword: 'Hujumchi-parol-1' })
      .expect(400);
    expect(replay.body.code).toBe('OTP_INVALID');
    const otp = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: body.verificationId },
    });
    expect(otp).toMatchObject({ purpose: OtpPurpose.PASSWORD_RESET });
    expect(otp.consumedAt).toBeInstanceOf(Date);
  });

  it('verification is limited per IP', async () => {
    const ip = uniqueIp();
    let last = 0;
    for (let i = 0; i < 31; i++) {
      const res = await testApp
        .http()
        .post(`${AUTH}/verify-phone`)
        .set('X-Forwarded-For', ip)
        .send({ verificationId: crypto.randomUUID(), code: '123456' });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
