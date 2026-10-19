import { AuthKeys } from '../../src/auth/auth.constants.js';
import { AuditAction } from '../../src/audit/audit-actions.js';
import {
  OtpPurpose,
  SessionRevokeReason,
  UserStatus,
} from '../../src/generated/prisma/enums.js';
import { verifyPassword } from '../../src/security/password.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser, uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import {
  AUTH,
  otpFor,
  settle,
  skipResendCooldown,
  login,
  STRONG_PASSWORD,
} from './helpers.js';

describe('Auth: password forgot / reset / change', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const forgot = (phone: string) =>
    testApp
      .http()
      .post(`${AUTH}/password/forgot`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone });

  const reset = (body: object) =>
    testApp
      .http()
      .post(`${AUTH}/password/reset`)
      .set('X-Forwarded-For', uniqueIp())
      .send(body);

  it('forgot → reset: new password works, old fails, every session revoked, audited', async () => {
    const { user, password } = await createUser(testApp.prisma);
    const a = await loginAs(testApp, user);
    const b = await loginAs(testApp, user);

    const res = await forgot(user.phone).expect(202);
    expect(res.body).toEqual({
      verificationId: expect.any(String),
      expiresIn: 300,
      resendAfter: 60,
      message: 'Agar raqam to‘g‘ri bo‘lsa, tasdiqlash kodi yuboriladi',
    });
    const verificationId = res.body.verificationId as string;
    await settle(testApp);
    const otp = await testApp.prisma.otpCode.findUniqueOrThrow({
      where: { id: verificationId },
    });
    expect(otp).toMatchObject({
      userId: user.id,
      purpose: OtpPurpose.PASSWORD_RESET,
    });
    expect(
      await testApp.prisma.auditLog.count({
        where: {
          action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
          resourceId: user.id,
        },
      }),
    ).toBe(1);

    const code = (await otpFor(testApp, user.phone)) ?? '';
    await reset({ verificationId, code, newPassword: STRONG_PASSWORD }).expect(
      200,
    );

    for (const session of [a, b]) {
      await testApp
        .http()
        .get(`${AUTH}/me`)
        .set(session.authHeader)
        .expect(401);
    }
    const sessions = await testApp.prisma.session.findMany({
      where: { id: { in: [a.sessionId, b.sessionId] } },
    });
    expect(sessions.map((s) => s.revokedReason)).toEqual([
      SessionRevokeReason.PASSWORD_RESET,
      SessionRevokeReason.PASSWORD_RESET,
    ]);
    const row = await testApp.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(row.passwordChangedAt).toBeInstanceOf(Date);
    expect(await verifyPassword(STRONG_PASSWORD, row.passwordHash)).toBe(true);
    const audit = await testApp.prisma.auditLog.findFirstOrThrow({
      where: { action: AuditAction.AUTH_PASSWORD_RESET, resourceId: user.id },
    });
    expect(audit.newValue).toEqual({ sessionsRevoked: 2 });

    await login(testApp, user.phone, password).expect(401);
    await login(testApp, user.phone, STRONG_PASSWORD).expect(200);
    // The code is single-use.
    await reset({
      verificationId,
      code,
      newPassword: 'Boshqa-parol-3',
    }).expect(400);
  });

  it('reset clears an active login lockout for the account', async () => {
    const { user } = await createUser(testApp.prisma);
    for (let i = 0; i < 5; i++) {
      await login(testApp, user.phone, 'Wrong-pass-1').expect(401);
    }
    await login(testApp, user.phone, 'Wrong-pass-1').expect(429);

    const { body } = await forgot(user.phone).expect(202);
    await reset({
      verificationId: body.verificationId,
      code: await otpFor(testApp, user.phone),
      newPassword: STRONG_PASSWORD,
    }).expect(200);
    expect(await testApp.redis.exists(AuthKeys.loginLock(user.phone))).toBe(0);
    await login(testApp, user.phone, STRONG_PASSWORD).expect(200);
  });

  it('a new reset request invalidates the previous code', async () => {
    const { user } = await createUser(testApp.prisma);
    const first = await forgot(user.phone).expect(202);
    const firstCode = (await otpFor(testApp, user.phone)) ?? '';
    await skipResendCooldown(testApp, first.body.verificationId as string);
    const second = await forgot(user.phone).expect(202);
    await settle(testApp);
    await reset({
      verificationId: first.body.verificationId,
      code: firstCode,
      newPassword: STRONG_PASSWORD,
    }).expect(400);
    await reset({
      verificationId: second.body.verificationId,
      code: await otpFor(testApp, user.phone),
      newPassword: STRONG_PASSWORD,
    }).expect(200);
  });

  it('PHONE_VERIFICATION codes cannot reset a password (purpose bound)', async () => {
    const phone = await uniquePhone();
    const reg = await testApp
      .http()
      .post(`${AUTH}/register`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, fullName: 'Ali Valiyev', password: STRONG_PASSWORD })
      .expect(202);
    const res = await reset({
      verificationId: reg.body.verificationId,
      code: await otpFor(testApp, phone),
      newPassword: 'Boshqa-parol-3',
    }).expect(400);
    expect(res.body.code).toBe('OTP_INVALID');
  });

  it('no code is sent to unknown, pending, blocked, archived or demo accounts (same 202)', async () => {
    const targets = [
      await uniquePhone(),
      ...(await Promise.all(
        [
          { status: UserStatus.PENDING_VERIFICATION },
          { status: UserStatus.BLOCKED },
          { status: UserStatus.ARCHIVED },
          { isDemo: true },
        ].map(
          async (options) =>
            (await createUser(testApp.prisma, options)).user.phone,
        ),
      )),
    ];
    testApp.sms.clear();
    for (const phone of targets) {
      const res = await forgot(phone).expect(202);
      await settle(testApp);
      expect(Object.keys(res.body as object).sort()).toEqual([
        'expiresIn',
        'message',
        'resendAfter',
        'verificationId',
      ]);
      expect(
        await testApp.prisma.otpCode.findUnique({
          where: { id: res.body.verificationId as string },
        }),
      ).toBeNull();
      expect(testApp.sms.lastTo(phone)).toBeUndefined();
    }
  });

  it('rejects a new password that fails the policy or contains the phone', async () => {
    const { user } = await createUser(testApp.prisma);
    const { body } = await forgot(user.phone).expect(202);
    const code = await otpFor(testApp, user.phone);
    await reset({
      verificationId: body.verificationId,
      code,
      newPassword: 'short',
    }).expect(400);
    const weak = await reset({
      verificationId: body.verificationId,
      code,
      newPassword: `x${user.phone.slice(4)}`,
    }).expect(400);
    expect(weak.body.code).toBe('PASSWORD_WEAK');
  });

  describe('POST /password/change', () => {
    it('verifies the current password, keeps this session, revokes the others', async () => {
      const { user, password } = await createUser(testApp.prisma);
      const current = await loginAs(testApp, user);
      const other = await loginAs(testApp, user);
      await testApp
        .http()
        .post(`${AUTH}/password/change`)
        .set(current.authHeader)
        .send({ currentPassword: password, newPassword: STRONG_PASSWORD })
        .expect(204);

      await testApp
        .http()
        .get(`${AUTH}/me`)
        .set(current.authHeader)
        .expect(200);
      await testApp.http().get(`${AUTH}/me`).set(other.authHeader).expect(401);
      const revoked = await testApp.prisma.session.findUniqueOrThrow({
        where: { id: other.sessionId },
      });
      expect(revoked.revokedReason).toBe(SessionRevokeReason.PASSWORD_CHANGED);
      expect(
        await testApp.prisma.auditLog.count({
          where: {
            action: AuditAction.AUTH_PASSWORD_CHANGED,
            resourceId: user.id,
            actorId: user.id,
          },
        }),
      ).toBe(1);
      await login(testApp, user.phone, STRONG_PASSWORD).expect(200);
    });

    it('wrong current password → 401 INVALID_CREDENTIALS, nothing changes; then 429', async () => {
      const { user } = await createUser(testApp.prisma);
      const session = await loginAs(testApp, user);
      for (let i = 0; i < 5; i++) {
        const res = await testApp
          .http()
          .post(`${AUTH}/password/change`)
          .set(session.authHeader)
          .send({
            currentPassword: 'Wrong-pass-1',
            newPassword: STRONG_PASSWORD,
          })
          .expect(401);
        expect(res.body.code).toBe('INVALID_CREDENTIALS');
      }
      await testApp
        .http()
        .post(`${AUTH}/password/change`)
        .set(session.authHeader)
        .send({ currentPassword: 'Wrong-pass-1', newPassword: STRONG_PASSWORD })
        .expect(429);
      const row = await testApp.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.passwordHash).toBe(user.passwordHash);
      // A 401 here must not end the session.
      await testApp
        .http()
        .get(`${AUTH}/me`)
        .set(session.authHeader)
        .expect(200);
    });

    it('a parallel burst cannot try more than 5 current passwords', async () => {
      const { user, password } = await createUser(testApp.prisma);
      const session = await loginAs(testApp, user);
      const change = (currentPassword: string) =>
        testApp
          .http()
          .post(`${AUTH}/password/change`)
          .set(session.authHeader)
          .send({ currentPassword, newPassword: STRONG_PASSWORD });
      const burst = await Promise.all(
        Array.from({ length: 20 }, (_, i) => change(`Wrong-pass-${i}`)),
      );
      const statuses = burst.map((res) => res.status);
      expect(statuses.filter((status) => status === 401)).toHaveLength(5);
      expect(statuses.filter((status) => status === 429)).toHaveLength(15);
      // The limit holds even for the right password afterwards.
      await change(password).expect(429);
      const row = await testApp.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.passwordHash).toBe(user.passwordHash);
    });

    it('requires authentication and a policy-compliant new password', async () => {
      await testApp
        .http()
        .post(`${AUTH}/password/change`)
        .send({ currentPassword: 'x', newPassword: STRONG_PASSWORD })
        .expect(401);
      const { user, password } = await createUser(testApp.prisma);
      const session = await loginAs(testApp, user);
      await testApp
        .http()
        .post(`${AUTH}/password/change`)
        .set(session.authHeader)
        .send({ currentPassword: password, newPassword: 'nodigits' })
        .expect(400);
    });
  });
});
