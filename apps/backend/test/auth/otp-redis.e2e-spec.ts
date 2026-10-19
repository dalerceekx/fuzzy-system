import { vi } from 'vitest';
import { OtpService } from '../../src/auth/otp.service.js';
import { OtpStore } from '../../src/auth/otp.store.js';
import { OtpPurpose, UserStatus } from '../../src/generated/prisma/enums.js';
import * as crypto from '../../src/security/crypto.js';
import { SmsProviderError } from '../../src/sms/sms.types.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import {
  AUTH,
  otpFor,
  register,
  settle,
  skipResendCooldown,
  STRONG_PASSWORD,
} from './helpers.js';

describe('Auth: Redis OTP generation, atomic consumption and send reservations', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  afterEach(() => vi.restoreAllMocks());

  const verify = (verificationId: string, code: string) =>
    testApp
      .http()
      .post(`${AUTH}/otp/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ verificationId, code });

  const resend = (verificationId: string) =>
    testApp
      .http()
      .post(`${AUTH}/otp/resend`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ verificationId });

  async function pending() {
    const registered = await register(testApp);
    const code = await otpFor(testApp, registered.phone);
    if (!code) throw new Error('No mock OTP was delivered');
    return { ...registered, code };
  }

  it('stores only a TTL-bound HMAC verifier and consumes it exactly once', async () => {
    const { phone, verificationId, code } = await pending();
    const key = OtpStore.key(verificationId);
    const row = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    const verifier = await testApp.redis.hgetall(key);
    expect(verifier).toEqual({
      digest: row.codeHash,
      attempts: '0',
      maxAttempts: '5',
    });
    expect(verifier.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(verifier)).not.toContain(code);
    expect(JSON.stringify(verifier)).not.toContain(phone);
    expect(await testApp.redis.pttl(key)).toBeGreaterThan(0);
    expect(await testApp.redis.pttl(key)).toBeLessThanOrEqual(300_000);

    await verify(verificationId, code).expect(200);
    expect(await testApp.redis.exists(key)).toBe(0);
    await verify(verificationId, code).expect(400);
  });

  it('rejects a Redis-expired verifier even when the database row is live', async () => {
    const { phone, verificationId, code } = await pending();
    await testApp.redis.pexpire(OtpStore.key(verificationId), 0);
    const response = await verify(verificationId, code).expect(400);
    expect(response.body.code).toBe('OTP_INVALID');
    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { phone },
    });
    expect(user.status).toBe(UserStatus.PENDING_VERIFICATION);
    expect(user.phoneVerifiedAt).toBeNull();
  });

  it('reports unavailable Redis safely and leaves the account unverified', async () => {
    const { phone, verificationId, code } = await pending();
    vi.spyOn(testApp.redis, 'eval').mockRejectedValueOnce(
      new Error('simulated Redis outage with sensitive connection details'),
    );
    const response = await verify(verificationId, code).expect(503);
    expect(response.body.code).toBe('OTP_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { phone },
    });
    expect(user.phoneVerifiedAt).toBeNull();
    expect(user.status).toBe(UserStatus.PENDING_VERIFICATION);
    // A transient cache failure does not silently verify or consume the code.
    await verify(verificationId, code).expect(200);
  });

  it('accepts only one concurrent resend and sends one replacement code', async () => {
    const { phone, verificationId, code: oldCode } = await pending();
    await skipResendCooldown(testApp, verificationId);
    const before = testApp.sms
      .messages()
      .filter((message) => message.to === phone).length;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => resend(verificationId)),
    );
    expect(results.filter((response) => response.status === 202)).toHaveLength(
      1,
    );
    expect(results.filter((response) => response.status === 429)).toHaveLength(
      5,
    );
    await settle(testApp);
    expect(
      testApp.sms.messages().filter((message) => message.to === phone),
    ).toHaveLength(before + 1);
    const newCode = await otpFor(testApp, phone);
    expect(newCode).toMatch(/^\d{6}$/);
    expect(newCode).not.toBe(oldCode);
    await verify(verificationId, oldCode).expect(400);
    await verify(verificationId, newCode ?? '').expect(200);
  });

  it('cannot consume a checked generation after a resend replaces its digest', async () => {
    const { phone, verificationId, code } = await pending();
    const otp = testApp.app.get(OtpService);
    const checked = await otp.check(
      verificationId,
      code,
      OtpPurpose.PHONE_VERIFICATION,
    );
    await skipResendCooldown(testApp, verificationId);
    await resend(verificationId).expect(202);
    await settle(testApp);

    await expect(
      testApp.prisma.$transaction((tx) => otp.consume(tx, checked)),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    const row = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    expect(row.consumedAt).toBeNull();
    expect(row.codeHash).not.toBe(checked.codeHash);
    await verify(verificationId, (await otpFor(testApp, phone)) ?? '').expect(
      200,
    );
  });

  it('limits one phone across registration and password recovery routes', async () => {
    const { phone } = await pending();
    const response = await testApp
      .http()
      .post(`${AUTH}/password/forgot`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone })
      .expect(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('draws again if a new registration randomly repeats the previous code', async () => {
    const first = await pending();
    await skipResendCooldown(testApp, first.verificationId);
    const replacement = first.code === '654321' ? '654322' : '654321';
    const generate = vi
      .spyOn(crypto, 'generateNumericCode')
      .mockReturnValueOnce(first.code)
      .mockReturnValueOnce(replacement);
    const second = await register(testApp, { phone: first.phone });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await otpFor(testApp, first.phone)).toBe(replacement);
    await verify(second.verificationId, first.code).expect(400);
    await verify(second.verificationId, replacement).expect(200);
  });

  it('enforces the hourly quota across different verification IDs for one phone', async () => {
    const phone = await uniquePhone();
    const store = testApp.app.get(OtpStore);
    for (let i = 0; i < 5; i++) {
      await store.reserveSend(phone, uniqueIp());
      await testApp.redis.del(OtpStore.phoneCooldownKey(phone));
    }
    await expect(store.reserveSend(phone, uniqueIp())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('enforces the hourly quota across different phones for one IP', async () => {
    const ip = uniqueIp();
    const store = testApp.app.get(OtpStore);
    for (let i = 0; i < 5; i++)
      await store.reserveSend(await uniquePhone(), ip);
    await expect(
      store.reserveSend(await uniquePhone(), ip),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('keeps a registration pending when the SMS provider rejects the message', async () => {
    vi.spyOn(testApp.sms, 'send').mockRejectedValueOnce(
      new SmsProviderError('ESKIZ_AUTH_FAILED', false),
    );
    const { phone, verificationId } = await register(testApp);
    expect(testApp.sms.lastTo(phone)).toBeUndefined();
    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { phone },
    });
    expect(user.status).toBe(UserStatus.PENDING_VERIFICATION);
    expect(user.phoneVerifiedAt).toBeNull();
    const row = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    expect(row.consumedAt).toBeNull();
  });

  it('supports the send alias through registration, verification and login', async () => {
    const phone = await uniquePhone();
    const sent = await testApp
      .http()
      .post(`${AUTH}/otp/send`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, fullName: 'Ali Valiyev', password: STRONG_PASSWORD })
      .expect(202);
    expect(sent.body).toMatchObject({ expiresIn: 300, resendAfter: 60 });
    await verify(
      sent.body.verificationId as string,
      (await otpFor(testApp, phone)) ?? '',
    ).expect(200);
    await testApp
      .http()
      .post(`${AUTH}/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, password: STRONG_PASSWORD })
      .expect(200);
  });

  it('validates the phone and registration binding on the send alias', async () => {
    await testApp
      .http()
      .post(`${AUTH}/otp/send`)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        phone: '12345',
        fullName: 'Ali Valiyev',
        password: STRONG_PASSWORD,
      })
      .expect(400);
    await testApp
      .http()
      .post(`${AUTH}/otp/send`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone: await uniquePhone() })
      .expect(400);
  });
});
